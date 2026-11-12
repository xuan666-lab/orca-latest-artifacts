import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "./session-fixtures.mjs";
import {
  currentCandidate,
  verifySession,
  readEvidence,
} from "../../src/shelf/session-adapter.mjs";
import {
  registerArtifact,
  readRegistrations,
  scopedArtifact,
} from "../../src/shelf/registrations.mjs";

test("native current tab uses exact session, workspace and group; authoritative null never falls back", async () => {
  const f = await fixture();
  try {
    f.session("A");
    f.session("B");
    f.current("A");
    assert.equal((await currentCandidate(f.paths)).id, "A");
    f.current("B");
    assert.equal((await currentCandidate(f.paths)).id, "B");
    const b = await verifySession(
      f.paths,
      "B",
      [f.workspace],
      await currentCandidate(f.paths),
    );
    assert.equal(b.name, "Session B");
    f.part(
      ["tabGroups", f.workspace.id],
      [
        {
          id: "g",
          worktreeId: f.workspace.id,
          activeTabId: "structured-agent-session-A",
        },
      ],
    );
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    f.current("A");
    f.part(["activeTabIdByWorktree", f.workspace.id], null);
    f.profile.prepare("INSERT INTO profile_state_documents VALUES(?,?,1)").run(
      "workspaceSession",
      JSON.stringify({
        activeWorkspaceExecutionHostId: "local",
        activeWorktreeId: f.workspace.id,
        activeTabTypeByWorktree: { workspace: "agent-session" },
        activeTabIdByWorktree: { workspace: "structured-agent-session-A" },
      }),
    );
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    f.current("A");
    f.part(["activeTabTypeByWorktree", f.workspace.id], "browser");
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    await assert.rejects(
      verifySession(f.paths, "A", [f.workspace], {
        workspaceId: "wrong",
        tabId: "structured-agent-session-A",
      }),
      /不一致/,
    );
  } finally {
    await f.close();
  }
});

test("Codex latest revision, tombstone, multi-file proof and separate sessions sharing one path", async () => {
  const f = await fixture();
  try {
    f.session("A");
    f.session("B");
    const a = await verifySession(f.paths, "A", [f.workspace]),
      b = await verifySession(f.paths, "B", [f.workspace]);
    const p = path.join(f.root, "report.html"),
      q = path.join(f.root, "readme.md");
    f.item("A", "call", 1, {
      kind: "tool-call",
      name: "apply_patch",
      state: "running",
      callId: "c",
      input: {
        changes: [
          { path: p, kind: { type: "add" } },
          { path: q, kind: { type: "update" } },
        ],
      },
    });
    let result = await readEvidence(f.paths, a);
    assert.equal(result.evidence.length, 0);
    f.item("A", "call", 2, {
      kind: "diff",
      path: "2 files",
      patch: { head: "not needed", truncated: true },
    });
    result = await readEvidence(f.paths, a, result.cache);
    assert.equal(result.evidence.length, 2);
    assert.equal(
      result.evidence.find((e) => e.path === p).evidence.relation,
      "created",
    );
    f.item("B", "edit", 1, {
      kind: "diff",
      path: p,
      patch: { head: "patch", truncated: false },
    });
    const other = await readEvidence(f.paths, b);
    assert.equal(other.evidence[0].evidence.relation, "modified");
    f.item("A", "call", 3, null, { deleted: 1 });
    result = await readEvidence(f.paths, a, result.cache);
    assert.equal(result.evidence.length, 0);
    f.item("A", "shell", 4, {
      kind: "tool-call",
      name: "shell",
      state: "completed",
      exitCode: 0,
      input: { command: "cat " + p },
    });
    assert.equal(
      (await readEvidence(f.paths, a, result.cache)).evidence.length,
      0,
    );
    f.item("A", "unknown-multi", 5, {
      kind: "diff",
      path: "2 files",
      patch: { head: "truncated", truncated: true },
    });
    assert.equal((await readEvidence(f.paths, a)).evidence.length, 0);
    f.journal
      .prepare(
        "UPDATE journal_outcome_epochs SET prefix_seq=1 WHERE session_id=?",
      )
      .run("A");
    await assert.rejects(readEvidence(f.paths, a), /prefix/);
  } finally {
    await f.close();
  }
});

test("Claude completed Write/Edit/MultiEdit only, never reads, failures or running calls", async () => {
  const f = await fixture();
  try {
    f.session("A", "claude");
    const a = await verifySession(f.paths, "A", [f.workspace]);
    const p = path.join(f.root, "made.html");
    f.item("A", "write", 1, {
      kind: "tool-call",
      name: "Write",
      state: "completed",
      callId: "w",
      input: { file_path: p },
      output: { head: "File created successfully at: " + p },
    });
    f.item("A", "edit", 2, {
      kind: "tool-call",
      name: "Edit",
      state: "completed",
      input: { file_path: p },
    });
    f.item("A", "multi", 3, {
      kind: "tool-call",
      name: "MultiEdit",
      state: "completed",
      input: { file_path: p },
    });
    for (const [i, name, state] of [
      [4, "Read", "completed"],
      [5, "Write", "failed"],
      [6, "Edit", "running"],
    ])
      f.item("A", "skip" + i, i, {
        kind: "tool-call",
        name,
        state,
        input: { file_path: p },
      });
    const result = await readEvidence(f.paths, a);
    assert.equal(result.evidence.length, 3);
    assert.equal(result.evidence[0].evidence.kind, "tool-write");
    assert.ok(result.evidence.some((e) => e.evidence.relation === "created"));
  } finally {
    await f.close();
  }
});

test("schema mismatch and busy database fail closed and release connections", async () => {
  const f = await fixture();
  try {
    f.session("A");
    f.current("A");
    f.profile.exec("PRAGMA user_version=99");
    await assert.rejects(currentCandidate(f.paths), /版本/);
    f.profile.exec("PRAGMA user_version=3");
    f.profile.exec("BEGIN EXCLUSIVE");
    const start = Date.now();
    await assert.rejects(currentCandidate(f.paths));
    assert.ok(Date.now() - start < 1000);
    f.profile.exec("ROLLBACK");
    assert.equal((await currentCandidate(f.paths)).id, "A");
  } finally {
    await f.close();
  }
});

test("registration validates identity, project scope, hash and deleted/symlink paths", async () => {
  const f = await fixture();
  try {
    f.session("A");
    const p = path.join(f.root, "report.md");
    await fs.writeFile(p, "# Report");
    const directory = path.join(f.root, "private", "registrations");
    await fs.mkdir(path.dirname(directory));
    await assert.rejects(
      registerArtifact({
        paths: f.paths,
        sessionId: "missing",
        workspaces: [f.workspace],
        file: p,
        directory,
      }),
    );
    const record = await registerArtifact({
      paths: f.paths,
      sessionId: "A",
      workspaces: [f.workspace],
      file: p,
      directory,
    });
    assert.equal(record.sourceEvidence.kind, "session-registration");
    assert.match(record.artifact.contentHash, /^[a-f0-9]{64}$/);
    const session = await verifySession(f.paths, "A", [f.workspace]);
    assert.equal(
      (await readRegistrations(session, [f.root], directory)).length,
      1,
    );
    await fs.unlink(p);
    assert.equal((await scopedArtifact(p, [f.root])).missing, true);
    assert.equal(
      (await readRegistrations(session, [f.root], directory)).length,
      1,
    );
    await fs.symlink("/etc/hosts", p);
    await assert.rejects(scopedArtifact(p, [f.root]), /符号链接/);
    assert.equal(
      (await readRegistrations(session, [f.root], directory)).length,
      0,
    );
    await assert.rejects(scopedArtifact("/etc/hosts", [f.root]), /超出/);
  } finally {
    await f.close();
  }
});

test("long sessions load in bounded pages and include exact dist/build output evidence", async () => {
  const f = await fixture();
  try {
    f.session("A");
    const session = await verifySession(f.paths, "A", [f.workspace]);
    f.journal.exec("BEGIN");
    for (let i = 0; i < 2003; i++)
      f.item("A", "key-" + String(i).padStart(4, "0"), i + 1, {
        kind: "diff",
        path: path.join(
          f.root,
          i === 0
            ? "dist/report.html"
            : i === 1
              ? "build/manual.md"
              : `out/${i}.html`,
        ),
        patch: { head: "", truncated: false },
      });
    f.journal.exec("COMMIT");
    let result = await readEvidence(f.paths, session);
    assert.equal(result.status, "loading");
    assert.equal(result.evidence.length, 2000);
    assert.equal(result.cache.through, -1);
    result = await readEvidence(f.paths, session, result.cache);
    assert.equal(result.status, "ok");
    assert.equal(result.evidence.length, 2003);
    assert.equal(result.cache.through, 2003);
    f.item("A", "key-0000", 2004, null, { deleted: 1 });
    result = await readEvidence(f.paths, session, result.cache);
    assert.equal(result.evidence.length, 2002);
    assert.ok(result.evidence.some((e) => e.path.endsWith("/build/manual.md")));
    await fs.mkdir(path.join(f.root, "dist"));
    const output = path.join(f.root, "dist/real.html");
    await fs.writeFile(output, "real");
    assert.equal((await scopedArtifact(output, [f.root])).missing, false);
  } finally {
    await f.close();
  }
});

test("legacy profile fallback is allowed only with no authoritative split metadata", async () => {
  const f = await fixture();
  try {
    f.session("A");
    f.profile.exec(
      "DROP TABLE profile_state_document_parts;DROP TABLE profile_state_document_parts_meta",
    );
    const doc = {
      activeWorkspaceExecutionHostId: "local",
      activeWorktreeId: f.workspace.id,
      activeWorkspaceKey: "worktree:" + f.workspace.id,
      activeTabTypeByWorktree: { workspace: "agent-session" },
      activeTabIdByWorktree: { workspace: "structured-agent-session-A" },
    };
    f.profile
      .prepare("INSERT INTO profile_state_documents VALUES(?,?,1)")
      .run("workspaceSession", JSON.stringify(doc));
    assert.equal((await currentCandidate(f.paths)).id, "A");
  } finally {
    await f.close();
  }
});

test("unified group focus wins over stale legacy tab fields on rapid native/terminal/browser switches", async () => {
  const f = await fixture();
  try {
    f.session("A"); f.session("B"); f.current("A");
    const rows = [
      {id:"structured-agent-session-A",entityId:"A",contentType:"agent-session",groupId:"g",worktreeId:"workspace",executionHostId:"local"},
      {id:"structured-agent-session-B",entityId:"B",contentType:"agent-session",groupId:"g",worktreeId:"workspace",executionHostId:"local"},
      {id:"terminal-view",entityId:"terminal-entity",contentType:"terminal",groupId:"g",worktreeId:"workspace"},
      {id:"browser-view",entityId:"browser-entity",contentType:"browser",groupId:"g",worktreeId:"workspace"},
    ];
    f.part(["unifiedTabs", "workspace"], rows);
    // Captured Orca 1.4.257 shape: legacy type says Chat but legacy tab still
    // points to the terminal previously focused in this workspace.
    f.part(["activeTabIdByWorktree", "workspace"], "old-terminal");
    const focus = id => f.part(["tabGroups", "workspace"], [{id:"g",worktreeId:"workspace",activeTabId:id}]);
    for (const id of ["A", "B", "A", "B"]) {
      focus("structured-agent-session-" + id);
      const candidate = await currentCandidate(f.paths);
      assert.equal(candidate.id, id);
      assert.equal((await verifySession(f.paths, id, [f.workspace], candidate)).id, id);
    }
    focus("terminal-view");
    assert.deepEqual(await currentCandidate(f.paths), {status:"terminal",tabId:"terminal-entity",workspaceId:"workspace"});
    focus("browser-view");
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    // No recent-tab or legacy fallback when authoritative focus cannot resolve.
    focus("missing-view");
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    focus("structured-agent-session-A");
    for (const invalid of [null, [], [ {...rows[0], entityId:null} ], [ {...rows[0], entityId:undefined} ], [ {...rows[0], groupId:"another-group"} ], [ {...rows[0],worktreeId:"another-workspace"} ], [ {...rows[0],executionHostId:"remote"} ], [rows[0], rows[0]]]) {
      f.part(["unifiedTabs", "workspace"], invalid);
      assert.equal((await currentCandidate(f.paths)).status, "unavailable");
    }
    f.part(["unifiedTabs", "workspace"], [{ ...rows[0], label:"x".repeat(1048576) }]);
    assert.equal((await currentCandidate(f.paths)).status, "unavailable");
  } finally { await f.close(); }
});
