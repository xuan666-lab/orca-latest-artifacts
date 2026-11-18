import fs from "node:fs";
import path from "node:path";
const EXT =
  /\.(html?|png|jpe?g|webp|gif|pdf|mp4|mov|webm|m4v|md|markdown|xlsx?|csv)$/i;
/** File-like tokens an answer shows the user: inline code, link targets, code-block words. */
export function mentionTokens(text) {
  if (typeof text !== "string" || text.length > 262144) return [];
  const raw = [];
  for (const b of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    for (const l of b[1].split("\n")) raw.push(l.trim(), ...l.split(/\s+/));
  for (const m of text.matchAll(/\[[^\]]*\]\(<?([^)>]+)>?\)/g)) raw.push(m[1]);
  for (const m of text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)) raw.push(m[1].trim(), ...m[1].split(/\s+/));
  return [...new Set(raw
    .map((t) => t.replace(/^["'(]+|["'),.;:]+$/g, "").replace(/^\.\//, ""))
    .filter((t) => t && t.length <= 512 && !t.includes("\0") && !t.split("/").includes("..") && EXT.test(t)))];
}
/** A written file counts as handed over when the answer names it (absolute, or by a path suffix). */
export const mentionsFile = (tokens, file) =>
  tokens.some((t) => file === t || file.endsWith(path.sep + t));
const EXCLUDED = ["node_modules", "warehouse", "venv", "cache", "__pycache__"];
/** Project file a token names, or null when it leaves the project or hits an excluded folder. */
export function inScope(token, project) {
  const file = path.resolve(project, token),
    relative = path.relative(project, file);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    return null;
  if (relative.split(path.sep).some((n) => n.startsWith(".") || EXCLUDED.includes(n))) return null;
  return file;
}
/**
 * Files an answer names that were created or modified since its turn began.
 * No wording rules: a referenced file that this turn did not touch is not a deliverable.
 */
export function changedMentions(tokens, project, since) {
  if (!Number.isFinite(since)) return [];
  return [...new Set(tokens.map((t) => inScope(t, project)).filter(Boolean))].filter((file) => {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() && stat.mtimeMs >= since - 2000; // 2 s: coarse filesystem clocks
    } catch {
      return false;
    }
  });
}
const time = (v) => (typeof v === "number" ? v : Date.parse(v));
export function finalTurnDelivery(db, generation, turnId, through, project, written = []) {
  if (typeof turnId !== "string") return [];
  const turn = db
    .prepare(
      "SELECT deleted,format,json_extract(value_json,'$.body.kind') kind,json_extract(value_json,'$.body.state') state,json_extract(value_json,'$.body.outcome') outcome FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq<=? ORDER BY seq DESC LIMIT 1",
    )
    .get(generation, JSON.stringify(turnId), through);
  if (
    !turn ||
    turn.deleted ||
    turn.format !== 3 ||
    turn.kind !== "turn" ||
    turn.state !== "completed" ||
    turn.outcome !== "success"
  )
    return [];
  const row = db
    .prepare(
      `SELECT current.deleted,current.format,current.seq,h.entry_key,
    CASE WHEN length(current.value_json)<=524288 AND json_extract(current.value_json,'$.body.kind')='message' AND json_extract(current.value_json,'$.body.role')='assistant' THEN current.value_json END value_json
    FROM journal_outcomes h JOIN journal_outcomes current ON current.generation=h.generation AND current.field=h.field AND current.entry_key=h.entry_key
    WHERE h.generation=? AND h.field='items' AND h.seq<=?
    AND json_extract(h.value_json,'$.body.kind')='message' AND json_extract(h.value_json,'$.body.role')='assistant'
    AND json_extract(h.value_json,'$.turnScope.turnItemId')=? AND json_extract(h.value_json,'$.agentId') IS NULL AND json_extract(h.value_json,'$.producerKind') IS NULL
    AND h.seq=(SELECT MAX(j.seq) FROM journal_outcomes j WHERE j.generation=h.generation AND j.field=h.field AND j.entry_key=h.entry_key AND j.seq<=? AND json_extract(j.value_json,'$.body.kind')='message')
    AND current.seq=(SELECT MAX(k.seq) FROM journal_outcomes k WHERE k.generation=h.generation AND k.field=h.field AND k.entry_key=h.entry_key AND k.seq<=?)
    ORDER BY COALESCE(json_extract(h.value_json,'$.sequence'),h.seq) DESC,h.seq DESC LIMIT 1`,
    )
    .get(generation, through, turnId, through, through);
  if (
    !row ||
    row.deleted ||
    row.format !== 3 ||
    !row.value_json ||
    row.value_json.length > 524288
  )
    return [];
  const started = db
    .prepare("SELECT MIN(json_extract(value_json,'$.observedAt')) t FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq<=?")
    .get(generation, JSON.stringify(turnId), through)?.t;
  return messageDelivery(JSON.parse(row.value_json), turnId, started, project, written, row.seq);
}
/** Files the turn's final assistant message hands over; `value` is an Orca item payload. */
export function messageDelivery(value, turnId, started, project, written = [], fallbackSequence) {
  if (value.agentId || value.producerKind || value.body?.truncated) return [];
  const blocks = value.body?.blocks;
  if (
    !Array.isArray(blocks) ||
    blocks.some((b) => b.truncated || b.text?.truncated)
  )
    return [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  const tokens = mentionTokens(text);
  return [...new Set([
    ...changedMentions(tokens, project, time(started)),
    ...written.filter((file) => mentionsFile(tokens, file)),
  ])].map((file) => ({
    path: file,
    evidence: {
      kind: "session-delivery",
      relation: "delivered",
      itemId: value.itemId,
      turnItemId: turnId,
      sequence: value.sequence ?? fallbackSequence,
      observedAt: value.observedAt,
    },
  }));
}
