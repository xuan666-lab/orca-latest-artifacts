import path from "node:path";
const EXT =
  /\.(html?|png|jpe?g|webp|gif|pdf|mp4|mov|webm|m4v|md|markdown|xlsx?|csv)$/i;
export function declaredPaths(text, project) {
  if (
    typeof text !== "string" ||
    text.length > 262144 ||
    !/交付|产物|输出文件|生成结果|(?:文件|文档|报告)已|已(?:经)?(?:完成|生成|创建|写|输出|整理|保存|实现|提交|更新|补充|修复|合并)|\b(?:created|generated|saved|written|delivered)\b/i.test(
      text,
    ) ||
    /参考资料|参考文件|引用文件|示例路径|计划生成|没有(?:生成|创建|输出|交付)|未(?:生成|创建|输出|交付)/.test(
      text,
    )
  )
    return [];
  if ((text.match(/```/g) || []).length % 2) return [];
  const candidates = [];
  for (const b of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    candidates.push(...b[1].split("\n").map((x) => x.trim()));
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g))
    candidates.push(m[1].replace(/^<|>$/g, ""));
  for (const m of text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g))
    candidates.push(m[1]);
  return [
    ...new Set(
      candidates.flatMap((raw) => {
        if (/^[a-z][\w+.-]*:/i.test(raw) || !EXT.test(raw)) return [];
        const file = path.resolve(project, raw),
          relative = path.relative(project, file);
        if (
          !relative ||
          relative === ".." ||
          relative.startsWith(".." + path.sep) ||
          path.isAbsolute(relative) ||
          relative
            .split(path.sep)
            .some(
              (n) =>
                n.startsWith(".") ||
                [
                  "node_modules",
                  "warehouse",
                  "venv",
                  "cache",
                  "__pycache__",
                ].includes(n),
            )
        )
          return [];
        return [file];
      }),
    ),
  ];
}
export function finalTurnDelivery(db, generation, turnId, through, project) {
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
  const value = JSON.parse(row.value_json);
  if (value.agentId || value.producerKind || value.body.truncated) return [];
  const blocks = value.body.blocks;
  if (
    !Array.isArray(blocks) ||
    blocks.some((b) => b.truncated || b.text?.truncated)
  )
    return [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  return declaredPaths(text, project).map((file) => ({
    path: file,
    evidence: {
      kind: "session-delivery",
      relation: "delivered",
      itemId: value.itemId,
      turnItemId: turnId,
      sequence: value.sequence ?? row.seq,
      observedAt: value.observedAt,
    },
  }));
}
