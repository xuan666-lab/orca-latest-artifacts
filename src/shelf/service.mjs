import { shelfView } from "./view.mjs";
import { exactWorkspace } from "./workspaces.mjs";
import { createSessionCatalog } from "./session-catalog.mjs";
import { watch } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createThumbnailCache } from "./thumbnails.mjs";
import { inventory, validateRoots, safe, reconcile, deliver } from "./core.mjs";
const exec = promisify(execFile);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export function createShelf(orca, options = {}) {
  let state = { tasks: [], active: null },
    initialized = false,
    initialization,
    queue = Promise.resolve(),
    writes = Promise.resolve();
  let watchers = [],
    debounce,
    fallback,
    focusTimer,
    focusChecking = false,
    lastFocus = null,
    disposed = false,
    backgroundQueued = false;
  const thumbnails = createThumbnailCache(orca.storage);
  const sessions = options.sessions
    ? createSessionCatalog(orca, options.sessionOptions)
    : null;
  const current = () =>
    state.mode === "session"
      ? state.sessionTask
      : state.tasks.find((t) => t.id === state.active);
  const snapshot = (query = {}) => shelfView(state, query);
  const save = ({ transient = false } = {}) => {
    const next = writes.then(async () => {
    if (disposed) return;
    state.revision = (state.revision || 0) + 1;
    let committedSession = false;
    try {
      if (!transient && current()?.sourceSession) {
        await orca.storage.set(
          current().storeKey || "session.task.v1." + current().sourceSession.id,
          current(),
        );
        committedSession = true;
      }
      // The session task already has its own key. Never persist a second copy
      // of its complete history in the shelf envelope.
      const { sessionTask, ...persisted } = state;
      await orca.storage.set("shelf", persisted);
    } catch (error) {
      if (!transient && !committedSession) throw error;
      state.sessionStatus = "部分产物缓存未能保存；当前列表仍可用，重启后会重新扫描";
    }
    orca.panels.post("shelf.changed", null);
    });
    writes = next.catch(() => {});
    return next;
  };
  const run = (fn) => {
    const next = queue.then(async () => {
      await init();
      return fn();
    });
    queue = next.catch(() => {});
    return next;
  };

  async function syncSession() {
    if (!sessions || disposed) return;
    const previous = JSON.stringify([
      state.sessionTask,
      state.sessionPinned,
      state.sessionStatus,
      state.sessionLoading,
    ]);
    const result = await sessions.refresh(state.sessionTask);
    state.sessionTask = result.task;
    state.sessionPinned = result.pinned;
    state.sessionStatus = result.status;
    state.sessionLoading = !!result.loading;
    state.terminalStatus = result.terminalStatus || null;
    if (
      previous !==
      JSON.stringify([
        state.sessionTask,
        state.sessionPinned,
        state.sessionStatus,
        state.sessionLoading,
      ])
    )
      await save({ transient: true });
  }
  async function scan(importAll = false) {
    if (disposed) return;
    if (state.mode === "session") return syncSession();
    const t = current();
    if (!t) return;
    const errors = [];
    const first = await inventory(t.roots, errors);
    await delay(options.stableMs ?? 700);
    const second = await inventory(t.roots, errors);
    for (const p of Object.keys(second)) {
      if (first[p]?.signature !== second[p].signature) {
        if (t.items[p]) second[p] = t.items[p];
        else delete second[p];
      }
    }
    const before = JSON.stringify(t);
    reconcile(t, second, importAll, errors);
    if (before !== JSON.stringify(t)) await save();
  }

  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(backgroundScan, 600);
  }
  function backgroundScan() {
    if (disposed || backgroundQueued) return;
    backgroundQueued = true;
    run(() => scan())
      .catch(report)
      .finally(() => {
        backgroundQueued = false;
      });
  }
  function report(e) {
    const t = current();
    if (t) {
      t.watchError = String(e.message || e);
      void save();
    }
    orca.log(String(e));
  }
  async function checkFocus() {
    if (disposed || !sessions || state.mode !== "session" || focusChecking) return;
    focusChecking = true;
    try {
      const identity = await sessions.focusIdentity();
      if (disposed || identity === lastFocus) return;
      await run(async () => {
        if (!disposed && state.mode === "session") await syncSession();
      });
      lastFocus = identity;
    } catch (error) {
      report(error);
    } finally {
      focusChecking = false;
    }
  }
  function listen() {
    watchers.forEach((w) => w.close());
    watchers = [];
    clearInterval(fallback);
    clearInterval(focusTimer);
    if (state.mode === "session" && !disposed) {
      fallback = setInterval(backgroundScan, 2000);
      fallback.unref?.();
      focusTimer = setInterval(checkFocus, 250);
      focusTimer.unref?.();
      return;
    }
    const t = current();
    if (!t || t.ended || disposed) return;
    for (const root of t.roots) {
      try {
        const w = watch(root, { recursive: true }, schedule);
        w.on("error", report);
        watchers.push(w);
      } catch (e) {
        report(e);
      }
    }
    // One scan at a time, at most once per 15 s when the native watcher misses events.
    fallback = setInterval(backgroundScan, 15000);
    fallback.unref?.();
  }
  async function init() {
    if (initialized) return;
    if (initialization) return initialization;
    initialization = (async () => {
      state = (await orca.storage.get("shelf")) || state;
      state.mode = state.mode || (sessions ? "session" : "directory");
      if (sessions && !state.sessionAdapterVersion) {
        state.mode = "session";
        state.sessionAdapterVersion = 1;
      }
      await scan();
      initialized = true;
      listen();
    })().finally(() => {
      initialization = null;
    });
    return initialization;
  }
  async function preview(p, taskId) {
    await init();
    const task = current(),
      file = task?.items[p];
    if (
      (taskId && task?.id !== taskId) ||
      !file ||
      file.missing ||
      file.unavailable
    )
      return { preview: null, reason: "产物已切换或不可用" };
    return thumbnails.get(file, task.roots, file.signature);
  }
  async function workspaceFor(task, artifactPath) {
    const { workspaces } = await orca.host.call("workspace.list", {});
    const local = workspaces.filter((w) => !w.hostId || w.hostId === "local");
    if (task.workspace?.id) {
      const selected = await exactWorkspace(task.workspace.id, local);
      if (!selected)
        throw Error("已关联的本机工作区不可用，请在任务设置重新关联");
      return selected;
    }
    const context = await orca.host.call("workspace.readContext", {});
    const candidates = local.filter((w) =>
      artifactPath.startsWith(w.path + "/"),
    );
    const focused = candidates.filter((w) => w.name === context?.displayName);
    const selected =
      focused.length === 1
        ? focused[0]
        : candidates.length === 1
          ? candidates[0]
          : null;
    if (!selected)
      throw Error("存在多个可能的工作区，请在任务设置中明确关联一次工作区");
    task.workspace = {
      id: selected.id,
      name: selected.name,
      path: selected.path,
    };
    await save();
    return selected;
  }
  async function dispatch(x = {}) {
    if (x.action === "preview") return preview(x.path, x.taskId);
    return run(async () => {
      const beforeMutation = ["start","switch","mode","end","associate","remove","deliver"].includes(x.action)
        ? structuredClone(state) : null;
      try {
      if (!x.action || x.action === "list") return snapshot(x);
      if (x.action === "mode") {
        if (!["session", "directory"].includes(x.mode)) throw Error("未知视图");
        if (x.mode === "session" && !sessions) throw Error("会话适配器未启用");
        state.mode = x.mode;
        await scan();
        listen();
        await save();
        return snapshot();
      }
      if (x.action === "version") return { revision: state.revision || 0 };
      if (x.action === "workspaces") {
        try {
          return await orca.host.call("workspace.list", {});
        } catch (e) {
          return { workspaces: [], error: String(e.message) };
        }
      }
      if (x.action === "start") {
        const roots = [
          ...new Set(
            String(x.roots)
              .split("\n")
              .map((r) => r.trim())
              .filter(Boolean)
              .map((r) => path.resolve(r)),
          ),
        ];
        if (!roots.length || !String(x.name).trim())
          throw Error("请输入任务名与输出目录");
        await validateRoots(roots);
        const errors = [],
          files = await inventory(roots, errors);
        const t = {
          id: crypto.randomUUID(),
          name: String(x.name),
          workspace: x.workspace || null,
          roots,
          started: Date.now(),
          baseline: Object.fromEntries(
            Object.entries(files).map(([p, f]) => [p, f.signature]),
          ),
          items: {},
          hidden: [],
          errors,
        };
        state.mode = "directory";
        state.tasks.push(t);
        state.active = t.id;
        listen();
        await save();
        return snapshot();
      }
      if (x.action === "switch") {
        if (!state.tasks.some((t) => t.id === x.id)) throw Error("任务不存在");
        state.active = x.id;
        listen();
        await scan();
        await save();
        return snapshot();
      }
      if (x.action === "refresh" && state.mode === "session") {
        await syncSession();
        return snapshot();
      }
      const t = current();
      if (!t) throw Error("请先开始收集");
      if (["remove", "deliver", "open", "reveal"].includes(x.action) &&
        (x.taskId !== t.id || x.revision !== (state.revision || 0)))
        throw Error("产物列表已更新，请在当前列表重新操作");
      if (x.action === "associate") {
        const { workspaces } = await orca.host.call("workspace.list", {});
        const w = workspaces.find(
          (w) => w.id === x.id && (!w.hostId || w.hostId === "local"),
        );
        if (!w) throw Error("请选择可用的本机工作区");
        t.workspace = { id: w.id, name: w.name, path: w.path };
        await save();
        return snapshot();
      }
      if (state.mode === "session" && x.action === "import")
        throw Error("当前是会话证据视图，请切换目录发现后导入");
      if (x.action === "refresh" || x.action === "import") {
        await scan(x.action === "import");
        return snapshot();
      }
      if (state.mode === "session" && ["end", "import"].includes(x.action))
        throw Error("当前是会话证据视图，请切换目录发现后操作");
      if (x.action === "end") {
        t.ended = true;
        listen();
        await save();
        return snapshot();
      }
      const f = t.items[x.path];
      if (!f) throw Error("产物不存在");
      if (x.action === "remove") {
        t.hidden.push(x.path);
        delete t.items[x.path];
        await save();
        return snapshot();
      }
      await safe(x.path, t.roots);
      if (x.action === "deliver") {
        await deliver(f, t.roots);
        await save();
      } else if (x.action === "open" || x.action === "reveal") {
        if (x.action === "reveal")
          await (options.open || exec)("/usr/bin/open", ["-R", x.path]);
        else {
          const workspace = await workspaceFor(t, x.path);
          const result = await (options.open || exec)(
            "orca",
            ["Markdown", "表格"].includes(f.kind)
              ? [
                  "file",
                  "open",
                  x.path,
                  "--worktree",
                  "id:" + workspace.id,
                  "--focus",
                  "--json",
                ]
              : [
                  "tab",
                  "create",
                  "--worktree",
                  "id:" + workspace.id,
                  "--url",
                  pathToFileURL(x.path).href,
                  "--json",
                ],
          );
          orca.log("Opened artifact " + x.path + " " + (result?.stdout || ""));
        }
      } else throw Error("未知操作");
      return snapshot();
      } catch (error) {
        if (beforeMutation) {
          state = beforeMutation;
          listen();
        }
        throw error;
      }
    });
  }
  const action = (input = {}) => dispatch(input || {});
  return {
    action,
    checkFocus,
    dispose() {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(fallback);
      clearInterval(focusTimer);
      watchers.forEach((w) => w.close());
      thumbnails.dispose();
      // Migration must wait for both operations and unqueued watcher writes.
      return queue.then(() => writes);
    },
  };
}
