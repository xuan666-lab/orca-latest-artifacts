import { test } from "node:test";
import assert from "node:assert/strict";
import { latestProductiveArtifacts } from "../src/shelf/latest-artifacts.mjs";
const item = (turn, extra = {}) => ({
  path: "/p/" + turn + ".md",
  sourceEvidence: { kind: "tool-write", turnItemId: turn },
  ...extra,
});
test("a nonproductive latest question retains the most recent productive completed turn; next productive turn replaces it", () => {
  const task = {
    turns: [
      { id: "A", sequence: 1, state: "completed", outcome: "success" },
      { id: "B", sequence: 2, state: "completed", outcome: "success" },
    ],
    items: { a: item("A") },
  };
  assert.deepEqual(Object.keys(latestProductiveArtifacts(task).items), ["a"]);
  task.turns.push({ id: "C", sequence: 3, state: "running" });
  task.items.c = item("C");
  assert.deepEqual(Object.keys(latestProductiveArtifacts(task).items), ["a"]);
  task.turns[2] = {
    id: "C",
    sequence: 3,
    state: "completed",
    outcome: "success",
  };
  assert.deepEqual(Object.keys(latestProductiveArtifacts(task).items), ["c"]);
  assert.equal(Object.keys(task.items).length, 2);
  task.items.c.missing = true;
  assert.equal(latestProductiveArtifacts(task).items.c.missing, true);
});
test("failed turns, unknown turn registrations and other sessions do not mix into the selected batch", () => {
  const a = {
    turns: [
      { id: "A", sequence: 1, state: "completed", outcome: "success" },
      { id: "failed", sequence: 2, state: "completed", outcome: "failure" },
    ],
    items: {
      a: item("A"),
      bad: item("failed"),
      unknown: { sourceEvidence: { kind: "session-registration" } },
    },
  };
  assert.deepEqual(Object.keys(latestProductiveArtifacts(a).items), ["a"]);
  assert.deepEqual(
    latestProductiveArtifacts({ turns: [], items: {} }).items,
    {},
  );
  assert.equal(
    latestProductiveArtifacts({ terminalSource: true, items: { a: item("A") } })
      .scope,
    "session-unconfirmed",
  );
});
