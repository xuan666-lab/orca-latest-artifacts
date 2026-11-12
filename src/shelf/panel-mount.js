import { ui, t, localizedError } from "../i18n.mjs";
export function mount(root, api, host) {
  const nativeDocument = globalThis.document;
  const document = {
    getElementById: (id) => root.getElementById(id),
    createElement: (tag) => nativeDocument.createElement(tag),
    get hidden() {
      return nativeDocument.hidden || host.hidden;
    },
    addEventListener: (name, fn) => {
      nativeDocument.addEventListener(name, fn);
      host.addEventListener(name, fn);
    },
    removeEventListener: (name, fn) => {
      nativeDocument.removeEventListener(name, fn);
      host.removeEventListener(name, fn);
    },
  };
  const orca = api;
  let state = { tasks: [] };
  let lastState = "";
  let version = -1;
  let polling;
  let pending = false;
  let refreshQueued = false;
  let disposed = false;
  let pageGeneration = 0;
  let loadingPage = false;
  let searchTimer;
  const pageSize = 100;
  const previewCache = new Map();
  let previewObserver;
  const $ = (id) => document.getElementById(id);

  function query() {
    return { search: $("search").value.trim(), kind: $("filter").value || "全部" };
  }
  function pageControls() {
    const pagination = state.pagination;
    const loaded = Object.keys(state.tasks.find(task => task.id === state.active)?.items || {}).length;
    $("load-more").hidden = !pagination?.hasMore;
    $("load-more").disabled = loadingPage;
    $("load-more").textContent = t(loadingPage ? "loadingMoreArtifacts" : "loadMoreArtifacts", orca.locale);
    $("page-count").hidden = !pagination || !pagination.total;
    $("page-count").textContent = pagination
      ? t("artifactPageCount", orca.locale, { loaded, total: pagination.total }) : "";
  }
  async function loadPage(append = false) {
    if (disposed || (append && (loadingPage || !state.pagination?.hasMore))) return;
    const generation = append ? pageGeneration : ++pageGeneration;
    const previousTask = state.tasks.find(task => task.id === state.active);
    const offset = append ? state.pagination.nextOffset : 0;
    loadingPage = true;
    pageControls();
    try {
      $("error").textContent = "";
      const result = await orca.plugin.request("shelf", {
        action: "list", offset, limit: pageSize, ...query(),
        ...(append ? { expectedTaskId: state.active, expectedRevision: version } : {}),
      });
      if (disposed || generation !== pageGeneration || !result.tasks) return result;
      const nextTask = result.tasks.find(task => task.id === result.active);
      const canAppend = append && !result.pagination?.reset &&
        result.active === state.active && result.revision === version &&
        result.pagination?.offset === offset;
      if (canAppend && previousTask && nextTask) {
        nextTask.items = { ...previousTask.items, ...nextTask.items };
      } else if (append && result.pagination?.offset > 0) {
        // A new task/revision must be fetched from the beginning, never merged.
        return loadPage();
      }
      const serialized = JSON.stringify(result);
      state = result;
      version = result.revision || 0;
      if (serialized !== lastState) {
        lastState = serialized;
        render();
      }
      return result;
    } catch (error) {
      if (!disposed && generation === pageGeneration)
        $("error").textContent = localizedError(error, orca.locale);
    } finally {
      if (generation === pageGeneration) {
        loadingPage = false;
        if (!disposed) pageControls();
      }
    }
  }
  async function call(input = {}) {
    if (!input.action || input.action === "list") return loadPage();
    try {
      $("error").textContent = "";
      const result = await orca.plugin.request("shelf", input);
      if (result.tasks && !disposed) await loadPage();
      return result;
    } catch (error) {
      if (!disposed) $("error").textContent = localizedError(error, orca.locale);
    }
  }
  function filterChanged(debounce = false) {
    clearTimeout(searchTimer);
    pageGeneration++;
    loadingPage = false;
    // Drop results from the old query immediately while the new first page loads.
    state = { ...state, pagination: null, tasks: state.tasks.map(task => ({ ...task, items: {} })) };
    lastState = "";
    render();
    if (debounce) searchTimer = setTimeout(() => void loadPage(), 150);
    else void loadPage();
  }

  function actionButton(label, action, file, disabled = false, context = {}) {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = async () => {
      b.disabled = true;
      await call({ action, path: file.path, ...context });
      b.disabled = disabled;
    };
    return b;
  }

  function cardFor(file, task, duplicateName = false) {
    const context = { taskId: task.id, revision: version };
    const unavailable = file.missing || file.unavailable;
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.path = file.path;
    const main = actionButton("", "open", file, unavailable, context);
    main.className = "main";
    main.title =
      file.path +
      (task.sourceSession ? ui(" · 打开当前磁盘版本", orca.locale) : "");
    main.setAttribute(
      "aria-label",
      ui("在 Orca 打开 ", orca.locale) + file.relative,
    );
    const preview = document.createElement("div");
    preview.className = "preview";
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder";
    placeholder.textContent =
      file.kind === "视频"
        ? "▶"
        : file.kind === "Markdown"
          ? "MD"
          : file.kind === "表格" ? (file.path.split(".").at(-1) || "XLS").toUpperCase() : ui(file.kind, orca.locale);
    preview.append(placeholder);
    if (!unavailable && file.kind !== "表格") {
      const key = file.path + file.signature;
      const load = () => {
        if (!previewCache.has(key)) {
          if (previewCache.size >= 48)
            previewCache.delete(previewCache.keys().next().value);
          previewCache.set(
            key,
            orca.plugin.request("shelf", {
              action: "preview",
              path: file.path,
              taskId: task.id,
            }),
          );
        }
        previewCache
          .get(key)
          .then((result) => {
            if (result.preview) {
              const img = document.createElement("img");
              img.alt = file.relative;
              img.src = result.preview;
              preview.replaceChildren(img);
            } else {
              preview.title =
                result.reason ||
                t("previewTemporarilyUnavailable", orca.locale);
              previewCache.delete(key);
            }
          })
          .catch((error) => {
            previewCache.delete(key);
            preview.title = localizedError(error, orca.locale);
          });
      };
      preview._load = load;
      if (previewObserver) previewObserver.observe(preview);
      else load();
    }
    const name = document.createElement("span");
    name.className = "filename";
    name.textContent = file.path.split(/[\\/]/).at(-1);
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent =
      ui(file.kind, orca.locale) +
      " · " +
      (file.sourceEvidence
        ? file.sourceEvidence.kind === "session-delivery"
          ? ui("会话交付", orca.locale)
          : file.sourceEvidence.kind === "session-registration"
            ? ui("会话登记", orca.locale)
            : ui("工具写入", orca.locale)
        : new Date(file.mtime).toLocaleDateString());
    meta.title =
      (file.sourceEvidence?.kind === "session-delivery"
        ? ui("助手在该会话明确列为交付文件，未核实工具写入。", orca.locale)
        : "") +
      ui("打开当前磁盘版本；更新于 ", orca.locale) +
      new Date(file.mtime).toLocaleString();
    main.append(preview, name);
    if (duplicateName) {
      const location = document.createElement("span");
      location.className = "location";
      location.textContent = file.relative;
      main.append(location);
    }
    main.append(meta);
    card.append(main);
    if (unavailable || file.changed || file.delivered) {
      const status = document.createElement("div");
      status.className =
        "status" + (unavailable || file.changed ? " warning" : "");
      status.textContent = file.missing
        ? ui("已移动或删除", orca.locale)
        : file.unavailable
          ? ui("暂时无法访问", orca.locale)
          : file.changed
            ? ui("交付后有更新", orca.locale)
            : ui("✓ 已交付", orca.locale);
      card.append(status);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const menu = document.createElement("details");
    menu.className = "filemenu";
    const summary = document.createElement("summary");
    summary.textContent = "⋯";
    summary.setAttribute(
      "aria-label",
      file.relative + ui(" 更多操作", orca.locale),
    );
    const options = document.createElement("div");
    options.className = "menu";
    options.append(
      actionButton(ui("标为交付", orca.locale), "deliver", file, unavailable, context),
      actionButton(ui("定位文件", orca.locale), "reveal", file, unavailable, context),
      actionButton(ui("移出任务", orca.locale), "remove", file, false, context),
    );
    const copy = document.createElement("button");
    copy.textContent = ui("复制路径", orca.locale);
    copy.onclick = () =>
      navigator.clipboard
        .writeText(file.path)
        .catch((e) => ($("error").textContent = String(e)));
    options.append(copy);
    const retry = document.createElement("button");
    retry.textContent = ui("重试缩略图", orca.locale);
    retry.onclick = () => {
      previewCache.delete(file.path + file.signature);
      render();
    };
    options.append(retry);
    const detail = document.createElement("button");
    detail.textContent = ui("文件详情", orca.locale);
    detail.onclick = () => {
      $("error").textContent = t("fileDetails", orca.locale, {
        path: file.path,
        size: file.size,
        source: ui(file.source, orca.locale),
        date: new Date(file.mtime).toLocaleString(orca.locale || "en"),
      });
    };
    options.append(detail);
    menu.append(summary, options);
    actions.append(menu);
    card.append(actions);
    return card;
  }

  function render() {
    previewObserver?.disconnect();
    previewObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries)
                if (entry.isIntersecting) {
                  entry.target._load?.();
                  previewObserver.unobserve(entry.target);
                }
            },
            { rootMargin: "200px" },
          );
    const task = state.tasks.find((t) => t.id === state.active);
    $("view-caption").textContent = t(
      state.mode !== "session" ? "directoryCaption" : !task ? "waitingSession"
        : state.viewScope === "latest-productive" ? "latestProductive" : "unknownRound",
      orca.locale,
    );
    $("tasks").replaceChildren(
      ...state.tasks.map((t) => {
        const option = document.createElement("option");
        option.value = t.id;
        option.textContent =
          t.name +
          (state.mode === "session" && state.sessionPinned
            ? ui(" · 已固定", orca.locale)
            : state.sessionLoading
              ? ui(" · 加载中", orca.locale)
              : "");
        return option;
      }),
    );
    $("tasks").value = state.active || "";
    $("tasks").title = state.sessionStatus || "";
    $("directory-config").hidden = state.mode === "session";
    $("import").hidden = state.mode === "session";
    $("end").hidden = state.mode === "session";
    $("scope").textContent = task
      ? `${task.ended ? ui("已结束自动收集", orca.locale) : ui("正在收集", orca.locale)}\n${task.roots.join("\n")}\n${task.workspace?.name || ui("未关联工作区", orca.locale)}`
      : ui("请选择限定输出目录", orca.locale);
    $("warnings").textContent = [
      ...(task?.errors || []).map((e) => e.message),
      task?.watchError,
      state.sessionPinned || state.terminalStatus === "untracked"
        ? null
        : state.sessionStatus,
    ]
      .filter(Boolean)
      .join("\n");
    for (const id of ["refresh", "import", "end"])
      $(id).disabled = !task || (id === "end" && task.ended);
    const items = state.pagination ? Object.values(task?.items || {}) : Object.values(task?.items || {})
      .filter(
        (f) =>
          f.path.toLowerCase().includes($("search").value.toLowerCase()) &&
          ($("filter").value === "全部" || f.kind === $("filter").value),
      )
      .sort(
        (a, b) =>
          Number(!!b.delivered) - Number(!!a.delivered) || b.mtime - a.mtime,
      );
    const nameCounts = new Map();
    for (const file of Object.values(task?.items || {})) {
      const basename = file.path.split(/[\\/]/).at(-1);
      nameCounts.set(basename, (nameCounts.get(basename) || 0) + 1);
    }
    $("cards").replaceChildren(
      ...items.map((f) =>
        cardFor(f, task, nameCounts.get(f.path.split(/[\\/]/).at(-1)) > 1),
      ),
    );
    pageControls();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent =
        (query().search || query().kind !== "全部")
          ? t("noMatchingArtifacts", orca.locale)
          : state.mode === "session"
          ? state.terminalStatus === "untracked"
            ? ui("此终端尚未接入产物追踪", orca.locale)
            : t(task && state.viewScope === "latest-productive" ? "noProductive" : "emptySession", orca.locale)
          : task
            ? ui("暂无产物", orca.locale)
            : ui("把这次任务的产物放在一起", orca.locale);
      const b = document.createElement("button");
      b.textContent =
        state.mode === "session"
          ? ui("刷新会话产物", orca.locale)
          : task
            ? ui("导入已有产物", orca.locale)
            : ui("开始收集", orca.locale);
      b.onclick = () =>
        state.mode === "session"
          ? call({ action: "refresh" })
          : task
            ? call({ action: "import" })
            : ($("settings").open = true);
      empty.append(b);
      $("cards").append(empty);
    }
  }

  $("start").onclick = async () => {
    const option = $("workspace").selectedOptions[0];
    const result = await call({
      action: "start",
      name: $("name").value,
      roots: $("roots").value,
      workspace: option?.value
        ? {
            id: option.value,
            name: option.textContent,
            path: option.dataset.path,
          }
        : null,
    });
    if (result) $("settings").open = false;
  };
  for (const id of ["refresh", "import", "end"])
    $(id).onclick = () => call({ action: id });
  $("follow").onclick = () => call({ action: "mode", mode: "session" });
  $("directory").onclick = () => call({ action: "mode", mode: "directory" });
  $("tasks").onchange = () => call({ action: "switch", id: $("tasks").value });
  $("search").oninput = () => filterChanged(true);
  $("filter").onchange = () => filterChanged();
  $("load-more").onclick = () => loadPage(true);
  $("layout").onclick = () => {
    $("layout").textContent = $("cards").classList.toggle("list")
      ? ui("切换画廊", orca.locale)
      : ui("切换列表", orca.locale);
  };
  $("associate").onclick = () =>
    call({ action: "associate", id: $("workspace").value });
  $("workspace").onchange = () => {
    const option = $("workspace").selectedOptions[0];
    if (option?.dataset.path) $("roots").value = option.dataset.path;
  };
  async function refreshChanged() {
    if (disposed || document.hidden) return;
    if (pending) {
      refreshQueued = true;
      return;
    }
    pending = true;
    try {
      do {
        refreshQueued = false;
        const response = await orca.plugin.request("shelf", {
          action: "version",
        });
        if (disposed || document.hidden) return;
        if (response.revision !== version) await call();
      } while (refreshQueued && !disposed && !document.hidden);
    } catch (error) {
      $("error").textContent =
        "暂时无法连接产物架：" + String(error.message || error);
    } finally {
      pending = false;
    }
  }
  const subscription = orca.plugin.on("shelf.changed", () => {
    void refreshChanged();
  });
  function visibility() {
    clearInterval(polling);
    if (!disposed && !document.hidden) {
      void refreshChanged();
      polling = setInterval(refreshChanged, 5000);
    }
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener(
    "pagehide",
    () => {
      disposed = true;
      refreshQueued = false;
      pageGeneration++;
      clearTimeout(searchTimer);
      clearInterval(polling);
      document.removeEventListener("visibilitychange", visibility);
      if (typeof subscription === "function") subscription();
      else subscription?.dispose?.();
      previewObserver?.disconnect();
      previewCache.clear();
    },
    { once: true },
  );
  call().then(visibility);
  call({ action: "workspaces" }).then((result) => {
    for (const w of result?.workspaces || []) {
      if (w.hostId && w.hostId !== "local") continue;
      const option = document.createElement("option");
      option.value = w.id;
      option.textContent = w.name;
      option.dataset.path = w.path;
      $("workspace").append(option);
    }
  });
}
