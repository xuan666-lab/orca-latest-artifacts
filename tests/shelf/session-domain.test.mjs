import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./session-fixtures.mjs";
import { verifySession, readEvidence } from "../../src/shelf/session-adapter.mjs";

// Orca 1.4.261+ moved Chat sessions to agent-session-domain.db (journal_items).
function domainDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version=2;
    CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT NOT NULL);
    CREATE TABLE agent_session_tabs(tab_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,position INTEGER NOT NULL);
    CREATE TABLE journal_chat_state(session_id TEXT PRIMARY KEY,workspace_id TEXT,epoch TEXT,last_sequence INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE journal_items(session_id TEXT,epoch TEXT,item_id TEXT,ordinal INTEGER,sequence INTEGER,sequence_index INTEGER,
      hidden INTEGER DEFAULT 0,kind TEXT,message_role TEXT,turn_item_id TEXT,producer_agent_id TEXT,payload_json TEXT,
      PRIMARY KEY(session_id,epoch,item_id));`);
  return db;
}

test("sessions in the new domain DB are read; others still fall back to the old journal", async () => {
  const f = await fixture();
  const domain = path.join(path.dirname(f.paths.journal), "agent-session-domain.db");
  const paths = { ...f.paths, domain };
  const db = domainDb(domain);
  try {
    const id = "codex_new";
    db.prepare("INSERT INTO agent_session_records VALUES(?,?)").run(id, JSON.stringify({
      schemaVersion: 2, sessionId: id, provider: "codex", conversationName: "New",
      location: { executionHostId: "local", workspaceId: f.workspace.id },
    }));
    db.prepare("INSERT INTO agent_session_tabs VALUES(?,?,0)").run("tab-new", id);
    db.prepare("INSERT INTO journal_chat_state VALUES(?,?,?,?)").run(id, f.workspace.id, "e1", 4);
    await fs.writeFile(path.join(f.root, "report.md"), "# r");
    await fs.writeFile(path.join(f.root, "notes.md"), "# n");
    const item = (itemId, seq, kind, turn, body, extra = {}) =>
      db.prepare("INSERT INTO journal_items VALUES(?,?,?,?,?,0,0,?,?,?,?,?)").run(
        id, "e1", itemId, seq, seq, kind, extra.role ?? null, turn, extra.agent ?? null,
        JSON.stringify({ itemId, sequence: seq, observedAt: Date.now() - 1000, body: { kind, ...body } }));
    item("t1", 1, "turn", null, { state: "completed", outcome: "success", startedAt: Date.now() - 1000 });
    item("d1", 2, "diff", "t1", { path: path.join(f.root, "report.md"), patch: { head: "@@", truncated: false } });
    item("d2", 3, "diff", "t1", { path: path.join(f.root, "notes.md") }, { agent: "child" });
    item("m1", 4, "message", "t1", { role: "assistant", blocks: [{ type: "text", text: "见 `report.md`" }] }, { role: "assistant" });

    const session = await verifySession(paths, id, [f.workspace], { workspaceId: f.workspace.id, tabId: "tab-new" });
    const result = await readEvidence(paths, session, null);
    assert.deepEqual(result.turns, [{ id: "t1", sequence: 1, state: "completed", outcome: "success" }]);
    const found = result.evidence.map((e) => [e.evidence.kind, path.basename(e.path), e.evidence.turnItemId]);
    // The subagent's write (notes.md) is not the session's own work.
    assert.deepEqual(found, [["tool-write", "report.md", "t1"], ["session-delivery", "report.md", "t1"]]);
    // Unchanged last_sequence reuses the cache.
    assert.equal((await readEvidence(paths, session, result.cache)).cache, result.cache);

    // A session only the old journal knows still resolves there.
    f.session("A");
    assert.equal((await verifySession(paths, "A", [f.workspace])).id, "A");
    await assert.rejects(verifySession(paths, "missing", [f.workspace]), /找不到这个会话记录/);
  } finally {
    db.close();
    await f.close();
  }
});
