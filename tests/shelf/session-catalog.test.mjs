import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./session-fixtures.mjs";
import { createShelf } from "../../src/shelf/service.mjs";

test("default session gallery follows A/B, clears on non-session focus, preserves deletion and never mixes directory artifacts", async () => {
  const f = await fixture(),
    values = new Map();
  const host = {
    storage: {
      get: async (k) => structuredClone(values.get(k)),
      set: async (k, v) => values.set(k, structuredClone(v)),
      delete: async (k) => values.delete(k),
    },
    host: { call: async () => ({ workspaces: [f.workspace] }) },
    panels: { post: () => {} },
    log: () => {},
  };
  const shelf = createShelf(host, {
    sessions: true,
    sessionOptions: {
      paths: f.paths,
      registrationDirectory: path.join(f.root, "registrations"),
    },
    stableMs: 1,
  });
  try {
    f.session("A");
    f.session("B");
    const p = path.join(f.root, "a.html"),
      q = path.join(f.root, "b.md");
    await fs.writeFile(p, "A");
    await fs.writeFile(q, "B");
    f.item("A", "Awrite", 1, {
      kind: "diff",
      path: p,
      patch: { head: "PRIVATE PATCH BODY", truncated: false },
    });
    f.item("B", "Bwrite", 1, {
      kind: "diff",
      path: q,
      patch: { head: "PRIVATE PATCH BODY", truncated: false },
    });
    f.current("A");
    let view = await shelf.action();
    assert.equal(view.mode, "session");
    assert.equal(view.tasks[0].sourceSession.id, "A");
    assert.deepEqual(Object.keys(view.tasks[0].items), [p]);
    f.current("B");
    view = await shelf.action({ action: "refresh" });
    assert.equal(view.tasks[0].sourceSession.id, "B");
    assert.deepEqual(Object.keys(view.tasks[0].items), [q]);
    f.part(["activeTabTypeByWorktree", "workspace"], "browser");
    await fs.unlink(q);
    view = await shelf.action({ action: "refresh" });
    assert.equal(view.sessionPinned, false);
    assert.deepEqual(view.tasks, []);
    f.current("B");
    view = await shelf.action({ action: "refresh" });
    assert.equal(view.tasks[0].items[q].missing, true);
    await assert.rejects(shelf.action({ action: "import" }), /会话证据/);
    view = await shelf.action({ action: "mode", mode: "directory" });
    assert.equal(view.tasks.length, 0);
    await shelf.action({ action: "start", name: "directory", roots: f.root });
    view = await shelf.action({ action: "import" });
    assert.equal(view.tasks[0].items[p].source, "显式导入");
    assert.equal(view.tasks[0].items[p].sourceEvidence, undefined);
    f.current("A");
    view = await shelf.action({ action: "mode", mode: "session" });
    assert.equal(view.tasks[0].sourceSession.id, "A");
    assert.equal(view.tasks[0].items[p].source, "工具成功写入");
    assert.equal(
      JSON.stringify([...values]).includes("PRIVATE PATCH BODY"),
      false,
    );
  } finally {
    shelf.dispose();
    await f.close();
  }
});

test("workspace switch with unresolved focus never pins the previous native or terminal session", async () => {
  const f = await fixture();
  const values = new Map();
  const other = { ...f.workspace, id: "same-path-other-workspace", name: "Other" };
  const host = {
    storage: {
      get: async (key) => structuredClone(values.get(key)),
      set: async (key, value) => values.set(key, structuredClone(value)),
      delete: async (key) => values.delete(key),
    },
    host: { call: async () => ({ workspaces: [f.workspace, other] }) },
    panels: { post: () => {} },
    log: () => {},
  };
  const shelf = createShelf(host, {
    sessions: true,
    sessionOptions: { paths: f.paths, registrationDirectory: path.join(f.root, "registrations") },
  });
  try {
    f.session("A");
    f.session("B", "codex", other.id);
    const a = path.join(f.root, "from-a.html"), b = path.join(f.root, "from-b.md");
    await fs.writeFile(a, "A");
    await fs.writeFile(b, "B");
    f.item("A", "write-a", 1, { kind: "diff", path: a });
    f.item("B", "write-b", 1, { kind: "diff", path: b });
    f.current("A");
    assert.equal((await shelf.action()).tasks[0].sourceSession.id, "A");
    f.current("B", other.id);
    f.part(["activeTabIdByWorktree", other.id], null);
    let view = await shelf.action({ action: "refresh" });
    assert.deepEqual(view.tasks, [], "transient identity must clear old A rows");
    assert.equal(view.sessionPinned, false);
    f.current("B", other.id);
    view = await shelf.action({ action: "refresh" });
    assert.equal(view.tasks[0].sourceSession.id, "B");
    assert.deepEqual(Object.keys(view.tasks[0].items), [b]);
    // The same rule applies to a previously displayed terminal task.
    const { createSessionCatalog } = await import("../../src/shelf/session-catalog.mjs");
    f.part(["activeWorkspaceExecutionHostId"], null);
    const catalog = createSessionCatalog(host, { paths: f.paths });
    const result = await catalog.refresh({ ...view.tasks[0], terminalSource: true });
    assert.equal(result.task, null);
    assert.equal(result.pinned, false);
    assert.ok(values.has("session.task.v1.A"), "clearing the view must retain history");
  } finally {
    shelf.dispose();
    await f.close();
  }
});

test("an existing verified Claude terminal displays HTML and XLSX delivery without a tracked launcher", async () => {
  const f = await fixture();
  const { DatabaseSync } = await import("node:sqlite");
  const statusDb = path.join(f.root, "status.db"),
    db = new DatabaseSync(statusDb);
  const child = {
      ...f.workspace,
      id: "workspace:child",
      name: "Child workspace",
    },
    terminal = {
      handle: "existing",
      incarnationId: "inc",
      tabId: "terminal-tab",
      leafId: "leaf",
      worktreeId: child.id,
      worktreePath: f.root,
      connected: true,
      orphaned: false,
      executionHostId: "local",
      agentIdentity: "claude",
    };
  const transcript = path.join(f.root, "S.jsonl"),
    html = path.join(f.root, "报告.html"),
    xlsx = path.join(f.root, "数据清单.xlsx");
  db.exec(
    "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('schema_version','202');CREATE TABLE rows(key TEXT PRIMARY KEY,seq INTEGER,value TEXT)",
  );
  const identity = {
    providerSession: {
      id: "S",
      key: "session_id",
      transcriptPath: transcript,
      cwd: f.root,
    },
    agentPresence: {
      sessionOwner: true,
      process: {
        pid: 1,
        startTime: "Tue Nov 10 07:25:19 2026",
        platform: "darwin",
      },
    },
    hostTurn: { owner: "claude:S" },
    payload: { agentType: "claude" },
    worktreeId: child.id,
    tabId: "terminal-tab",
    paneKey: "terminal-tab:leaf",
    connectionId: null,
  };
  db.prepare("INSERT INTO rows VALUES(?,?,?)").run(
    "entry\0terminal-tab:leaf",
    1,
    JSON.stringify(identity),
  );
  const values = new Map(),
    host = {
      storage: {
        get: async (k) => values.get(k),
        set: async (k, v) => values.set(k, structuredClone(v)),
        delete: async (k) => values.delete(k),
      },
      host: { call: async () => ({ workspaces: [f.workspace, child] }) },
      panels: { post: () => {} },
      log: () => {},
    };
  const shelf = createShelf(host, {
    sessions: true,
    sessionOptions: {
      paths: f.paths,
      trackerDirectory: path.join(f.root, "tracking"),
      liveTerminals: async () => [terminal],
      existingTerminal: {
        statusDb,
        allowFixturePaths: true,
        runner: async () => ({ stdout: "Tue Nov 10 07:25:19 2026 claude" }),
      },
    },
  });
  try {
    await fs.writeFile(html, "<h1>报告</h1>");
    await fs.writeFile(xlsx, "opaque fixture, not read as spreadsheet");
    await fs.writeFile(
      transcript,
      JSON.stringify({
        type: "assistant",
        sessionId: "S",
        uuid: "delivery",
        timestamp: "2026-11-12T03:22:40.555Z",
        message: {
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text:
                "交付产物\n```text\n" +
                html +
                "\n```\n```text\n" +
                xlsx +
                "\n```",
            },
          ],
        },
      }) + "\n",
    );
    f.current("A", child.id);
    f.part(["activeTabTypeByWorktree", child.id], "terminal");
    f.part(["activeTabIdByWorktree", child.id], "terminal-tab");
    f.part(
      ["tabGroups", child.id],
      [{ id: "g", worktreeId: child.id, activeTabId: "terminal-tab" }],
    );
    const view = await shelf.action();
    assert.equal(view.terminalStatus, "connected");
    assert.equal(view.tasks[0].sourceSession.id, "S");
    assert.equal(view.tasks[0].workspace.id, child.id);
    assert.equal(Object.keys(view.tasks[0].items).length, 2);
    assert.equal(view.tasks[0].items[xlsx].kind, "表格");
    assert.equal(view.tasks[0].items[html].source, "会话交付");
  } finally {
    shelf.dispose();
    db.close();
    await f.close();
  }
});

test('focus probe refreshes a switched session immediately without rereading unchanged evidence', async () => {
  const f = await fixture(), values = new Map();
  let hostReads = 0;
  const shelf = createShelf({
    storage: {get: async k => values.get(k), set: async(k,v) => values.set(k,v)},
    host: {call: async () => {hostReads++; return {workspaces:[f.workspace]};}},
    panels: {post() {}}, log() {},
  }, {sessions:true, sessionOptions:{paths:f.paths, registrationDirectory:path.join(f.root,'registrations')}});
  try {
    f.session('A'); f.session('B'); f.current('A');
    await shelf.action();
    await shelf.checkFocus();
    const before = hostReads;
    await shelf.checkFocus();
    assert.equal(hostReads, before);
    f.current('B');
    await shelf.checkFocus();
    assert.equal((await shelf.action()).tasks[0].sourceSession.id, 'B');
    f.part(['activeTabTypeByWorktree','workspace'], 'browser');
    await shelf.checkFocus();
    assert.deepEqual((await shelf.action()).tasks, []);
  } finally { await shelf.dispose(); await f.close(); }
});

test('switching during evidence verification never publishes the old session', async () => {
  const f = await fixture(), values = new Map(); let switchDuringRead = false;
  const shelf = createShelf({storage:{get:async k=>values.get(k),set:async(k,v)=>values.set(k,v)},
    host:{call:async()=>{if(switchDuringRead){switchDuringRead=false;f.current('B');}return{workspaces:[f.workspace]};}},
    panels:{post(){}},log(){}}, {sessions:true,sessionOptions:{paths:f.paths,registrationDirectory:path.join(f.root,'registrations')}});
  try {
    f.session('A');f.session('B');f.current('A');await shelf.action();
    switchDuringRead=true;
    const view=await shelf.action({action:'refresh'});
    assert.deepEqual(view.tasks,[]);
    await shelf.checkFocus();
    assert.equal((await shelf.action()).tasks[0].sourceSession.id,'B');
  }finally{await shelf.dispose();await f.close();}
});
