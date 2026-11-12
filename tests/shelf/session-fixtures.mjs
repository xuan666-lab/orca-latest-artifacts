import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";

export async function fixture() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-session-")),
  );
  const paths = {
    profile: path.join(root, "profile-state.db"),
    journal: path.join(root, "agent-session-journal.db"),
  };
  const profile = new DatabaseSync(paths.profile),
    journal = new DatabaseSync(paths.journal);
  profile.exec(`PRAGMA user_version=3;
    CREATE TABLE profile_state_documents(domain TEXT PRIMARY KEY,payload TEXT,domain_version INTEGER);
    CREATE TABLE profile_state_document_parts_meta(domain TEXT PRIMARY KEY,domain_version INTEGER,revision INTEGER);
    CREATE TABLE profile_state_document_parts(domain TEXT,part_key TEXT,payload TEXT,PRIMARY KEY(domain,part_key));
    INSERT INTO profile_state_document_parts_meta VALUES('workspaceSession',1,1);`);
  journal.exec(`PRAGMA user_version=4;
    CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT);
    CREATE TABLE agent_session_tabs(tab_id TEXT PRIMARY KEY,session_id TEXT);
    CREATE TABLE journal_outcome_epochs(session_id TEXT PRIMARY KEY,epoch TEXT,generation INTEGER,format INTEGER,through_seq INTEGER,prefix_seq INTEGER);
    CREATE TABLE journal_outcomes(generation INTEGER,seq INTEGER,field TEXT,entry_key TEXT,format INTEGER,value_json TEXT,deleted INTEGER,PRIMARY KEY(generation,seq,field,entry_key));
    CREATE INDEX latest ON journal_outcomes(generation,field,entry_key,seq DESC);`);
  const workspace = {
    id: "workspace",
    name: "Fixture",
    path: root,
    hostId: "local",
  };
  function session(
    id,
    provider = "codex",
    workspaceId = workspace.id,
    generation = id === "A" ? 1 : 2,
  ) {
    journal
      .prepare("INSERT OR REPLACE INTO agent_session_records VALUES(?,?)")
      .run(
        id,
        JSON.stringify({
          schemaVersion: 2,
          sessionId: id,
          provider,
          conversationName: "Session " + id,
          location: {
            executionHostId: "local",
            workspaceId,
            workspaceKind: "folder",
          },
        }),
      );
    journal
      .prepare("INSERT OR REPLACE INTO agent_session_tabs VALUES(?,?)")
      .run("structured-agent-session-" + id, id);
    journal
      .prepare(
        "INSERT OR REPLACE INTO journal_outcome_epochs VALUES(?,?,?,?,?,?)",
      )
      .run(id, "epoch-" + id, generation, 3, 0, 0);
  }
  function part(key, value) {
    profile
      .prepare(
        "INSERT OR REPLACE INTO profile_state_document_parts VALUES(?,?,?)",
      )
      .run("workspaceSession", JSON.stringify(key), JSON.stringify(value));
  }
  function current(id, workspaceId = workspace.id) {
    const epoch = journal
      .prepare(
        "SELECT generation FROM journal_outcome_epochs WHERE session_id=?",
      )
      .get(id);
    if (epoch)
      journal
        .prepare("INSERT OR IGNORE INTO journal_outcomes VALUES(?,?,?,?,?,?,?)")
        .run(
          epoch.generation,
          0,
          "items",
          JSON.stringify("base-turn-" + id),
          3,
          JSON.stringify({
            itemId: "base-turn-" + id,
            revision: 0,
            sequence: 0,
            observedAt: 0,
            body: { kind: "turn", state: "completed", outcome: "success" },
          }),
          0,
        );
    part(["activeWorkspaceExecutionHostId"], "local");
    part(["activeWorktreeId"], workspaceId);
    part(["activeWorkspaceKey"], "worktree:" + workspaceId);
    part(["activeTabTypeByWorktree", workspaceId], "agent-session");
    part(
      ["activeTabIdByWorktree", workspaceId],
      "structured-agent-session-" + id,
    );
    part(["activeGroupIdByWorktree", workspaceId], "g");
    part(
      ["tabGroups", workspaceId],
      [
        {
          id: "g",
          worktreeId: workspaceId,
          activeTabId: "structured-agent-session-" + id,
        },
      ],
    );
  }
  function item(
    id,
    key,
    seq,
    body,
    { deleted = 0, format = 3, itemId = key } = {},
  ) {
    const epoch = journal
      .prepare(
        "SELECT generation FROM journal_outcome_epochs WHERE session_id=?",
      )
      .get(id);
    journal.prepare("INSERT INTO journal_outcomes VALUES(?,?,?,?,?,?,?)").run(
      epoch.generation,
      seq,
      "items",
      key,
      format,
      JSON.stringify({
        itemId,
        revision: seq,
        sequence: seq,
        observedAt: 1700000000000 + seq,
        body,
        turnScope: { kind: "turn", turnItemId: "base-turn-" + id },
      }),
      deleted,
    );
    journal
      .prepare(
        "UPDATE journal_outcome_epochs SET through_seq=MAX(through_seq,?) WHERE session_id=?",
      )
      .run(seq, id);
  }
  async function close() {
    profile.close();
    journal.close();
    await fs.rm(root, { recursive: true, force: true });
  }
  return {
    root,
    paths,
    profile,
    journal,
    workspace,
    session,
    current,
    part,
    item,
    close,
  };
}
