/** Select by verified turn identities, never by file mtime or a recent-session guess. */
export function latestProductiveArtifacts(task) {
  if (!task) return { items: {}, turn: null, scope: "no-session" };
  if (task.terminalSource || !Array.isArray(task.turns))
    return {
      items: task.items || {},
      turn: null,
      scope: "session-unconfirmed",
    };
  const byTurn = new Map();
  for (const [file, item] of Object.entries(task.items || {}))
    for (const evidence of [
      ...(item.evidence || []),
      item.sourceEvidence,
    ].filter(Boolean)) {
      if (
        !evidence.turnItemId ||
        !["tool-write", "session-registration", "session-delivery"].includes(
          evidence.kind,
        )
      )
        continue;
      if (!byTurn.has(evidence.turnItemId))
        byTurn.set(evidence.turnItemId, new Set());
      byTurn.get(evidence.turnItemId).add(file);
    }
  const turn = task.turns
    .filter(
      (t) =>
        t.state === "completed" && t.outcome === "success" && byTurn.has(t.id),
    )
    .sort((a, b) => b.sequence - a.sequence)[0];
  if (!turn) return { items: {}, turn: null, scope: "latest-productive" };
  return {
    items: Object.fromEntries(
      [...byTurn.get(turn.id)].map((p) => [p, task.items[p]]),
    ),
    turn,
    scope: "latest-productive",
  };
}
