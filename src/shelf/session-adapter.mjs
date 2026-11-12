import { finalTurnDelivery } from "./native-delivery.mjs";
/** Version-gated, read-only adapter. It never returns or persists conversation text. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ID = /^[A-Za-z0-9_-]{1,160}$/;
const MAX_ITEMS = 2000;
const PROFILE_TABLES = {
  profile_state_documents: ["domain", "payload", "domain_version"],
};
const JOURNAL_TABLES = {
  agent_session_records: ["session_id", "record_json"],
  agent_session_tabs: ["tab_id", "session_id"],
  journal_outcome_epochs: [
    "session_id",
    "epoch",
    "generation",
    "format",
    "through_seq",
    "prefix_seq",
  ],
  journal_outcomes: [
    "generation",
    "seq",
    "field",
    "entry_key",
    "format",
    "value_json",
    "deleted",
  ],
};

export async function profilePaths(
  base = process.env.ORCA_ARTIFACT_ORCA_HOME ||
    path.join(os.homedir(), "Library/Application Support/orca"),
) {
  const indexFile = path.join(base, "orca-profile-index.json");
  if ((await fs.realpath(indexFile)) !== indexFile)
    throw Error("拒绝符号链接 profile index");
  const stat = await fs.stat(indexFile);
  if (stat.size > 1024 * 1024) throw Error("profile index 超限");
  const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
  if (index.schemaVersion !== 1 || !ID.test(index.activeProfileId || ""))
    throw Error("不支持的 Orca profile index");
  return {
    profileId: index.activeProfileId,
    profile: path.join(
      base,
      "profiles",
      index.activeProfileId,
      "profile-state.db",
    ),
    journal: path.join(base, "agent-session-journal.db"),
  };
}

async function database(file, version, tables, fn) {
  if ((await fs.realpath(file)) !== file || !(await fs.stat(file)).isFile())
    throw Error("拒绝非普通文件或符号链接数据库");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true, timeout: 100 });
  try {
    if (db.prepare("PRAGMA user_version").get().user_version !== version)
      throw Error("Orca 数据库版本不匹配，自动关联已关闭");
    for (const [table, columns] of Object.entries(tables)) {
      const actual = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
      if (!columns.every((c) => actual.includes(c)))
        throw Error("Orca 数据库结构不匹配：" + table);
    }
    db.exec("BEGIN");
    try {
      const result = fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function currentCandidate(paths) {
  return database(paths.profile, 3, PROFILE_TABLES, (db) => {
    const splitTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('profile_state_document_parts_meta','profile_state_document_parts')",
      )
      .all();
    if (splitTables.length === 1)
      throw Error("不完整的 workspaceSession 分片结构");
    if (splitTables.length === 2) {
      for (const [table, fields] of [
        [
          "profile_state_document_parts_meta",
          ["domain", "domain_version", "revision"],
        ],
        ["profile_state_document_parts", ["domain", "part_key", "payload"]],
      ]) {
        const columns = db
          .prepare("PRAGMA table_info(" + table + ")")
          .all()
          .map((c) => c.name);
        if (!fields.every((f) => columns.includes(f)))
          throw Error("不支持的分片结构");
      }
    }
    const meta =
      splitTables.length === 2
        ? db
            .prepare(
              "SELECT domain_version,revision FROM profile_state_document_parts_meta WHERE domain='workspaceSession'",
            )
            .get()
        : null;
    let get, has;
    if (meta) {
      if (meta.domain_version !== 1)
        throw Error("不支持的 workspaceSession 分片版本");
      const statement = db.prepare(
        "SELECT payload FROM profile_state_document_parts WHERE domain='workspaceSession' AND part_key=? AND length(payload)<=1048576",
      );
      get = (parts) => {
        const row = statement.get(JSON.stringify(parts));
        return row ? JSON.parse(row.payload) : null;
      };
      const present = db.prepare(
        "SELECT 1 FROM profile_state_document_parts WHERE domain='workspaceSession' AND part_key=?",
      );
      has = (parts) => !!present.get(JSON.stringify(parts));
    } else {
      const legacy = db
        .prepare(
          "SELECT domain_version FROM profile_state_documents WHERE domain='workspaceSession'",
        )
        .get();
      if (legacy?.domain_version !== 1)
        throw Error("无法确认 workspaceSession 文档版本");
      const statement = db.prepare(
        "SELECT json_quote(json_extract(payload,?)) payload FROM profile_state_documents WHERE domain='workspaceSession'",
      );
      get = (parts) =>
        JSON.parse(
          statement.get(
            "$" + parts.map((p) => "." + JSON.stringify(p)).join(""),
          )?.payload || "null",
        );
      const present = db.prepare(
        "SELECT json_type(payload,?) kind FROM profile_state_documents WHERE domain='workspaceSession'",
      );
      has = (parts) => present.get(
        "$" + parts.map((p) => "." + JSON.stringify(p)).join(""),
      )?.kind != null;
    }
    if (get(["activeWorkspaceExecutionHostId"]) !== "local")
      return { status: "unavailable", reason: "当前不是可验证的本机会话" };
    const workspace = get(["activeWorktreeId"]);
    const key = get(["activeWorkspaceKey"]);
    if (
      typeof workspace !== "string" ||
      (typeof key === "string" &&
        !["worktree:" + workspace, "folder:" + workspace].includes(key))
    )
      return { status: "unavailable", reason: "当前工作区身份不一致" };
    let type = get(["activeTabTypeByWorktree", workspace]);
    let tab = get(["activeTabIdByWorktree", workspace]);
    let sessionId;
    const groupId = get(["activeGroupIdByWorktree", workspace]);
    const groups = get(["tabGroups", workspace]);
    const unifiedKey = ["unifiedTabs", workspace];
    const hasUnified = has(unifiedKey);
    if (groupId !== null || groups !== null || hasUnified) {
      if (!Array.isArray(groups) || groups.length > 128)
        return { status: "unavailable", reason: "当前分组身份不可验证" };
      const matches = groups.filter((g) => g.id === groupId);
      const group = matches.length === 1 ? matches[0] : null;
      if (!group || group.worktreeId !== workspace)
        return { status: "unavailable", reason: "当前分组和会话标签不一致" };
      if (hasUnified) {
        // Current Orca keeps legacy activeTabId as a terminal selection even
        // while a structured Chat is focused. The active group's exact unified
        // row owns focus; do not compare it to that legacy terminal pointer.
        const unified = get(unifiedKey);
        const selected = Array.isArray(unified) && unified.length <= 10000
          ? unified.filter((t) => t.id === group.activeTabId)
          : [];
        const active = selected.length === 1 ? selected[0] : null;
        if (!active || active.groupId !== groupId || active.worktreeId !== workspace
          || (active.executionHostId != null && active.executionHostId !== "local"))
          return { status: "unavailable", reason: "当前统一标签身份不可验证" };
        type = active.contentType;
        tab = type === "terminal" ? active.entityId : active.id;
        sessionId = active.entityId;
      } else if (group.activeTabId !== tab) {
        return { status: "unavailable", reason: "当前分组和会话标签不一致" };
      }
    }
    if (type === "terminal" && typeof tab === "string" && tab.length > 0)
      return { status: "terminal", tabId: tab, workspaceId: workspace };
    if (
      type !== "agent-session" ||
      typeof tab !== "string" ||
      (!hasUnified && !tab.startsWith("structured-agent-session-"))
    )
      return {
        status: "unavailable",
        reason: "当前不是原生 Chat；保留已明确关联的会话",
      };
    const id = hasUnified ? sessionId : tab.slice("structured-agent-session-".length);
    if (typeof id !== "string" || !ID.test(id))
      return { status: "unavailable", reason: "当前会话标识不可验证" };

    return { status: "ok", id, tabId: tab, workspaceId: workspace };
  });
}

function sessionRecord(db, id, expected) {
  if (!ID.test(id || "")) throw Error("会话 ID 无效");
  const row = db
    .prepare(
      `SELECT json_extract(record_json,'$.schemaVersion') schemaVersion,
    json_extract(record_json,'$.sessionId') id,json_extract(record_json,'$.provider') provider,
    json_extract(record_json,'$.location.executionHostId') host,
    json_extract(record_json,'$.location.workspaceId') workspaceId,
    json_extract(record_json,'$.conversationName') name
    FROM agent_session_records WHERE session_id=?`,
    )
    .get(id);
  if (
    !row ||
    row.schemaVersion !== 2 ||
    row.id !== id ||
    row.host !== "local" ||
    !["codex", "claude"].includes(row.provider)
  )
    throw Error("暂不支持此会话身份/provider/record版本");
  if (expected && row.workspaceId !== expected.workspaceId)
    throw Error("会话与当前工作区不一致");
  const tab = expected?.tabId
    ? db
        .prepare("SELECT session_id FROM agent_session_tabs WHERE tab_id=?")
        .get(expected.tabId)
    : db
        .prepare(
          "SELECT session_id FROM agent_session_tabs WHERE session_id=? LIMIT 1",
        )
        .get(id);
  if (tab?.session_id !== id) throw Error("会话没有可验证的原生标签");
  return {
    id: row.id,
    provider: row.provider,
    workspaceId: row.workspaceId,
    name:
      typeof row.name === "string"
        ? row.name.slice(0, 200)
        : row.provider + " 会话",
  };
}

export async function verifySession(paths, id, workspaces, expected) {
  const session = await database(paths.journal, 4, JOURNAL_TABLES, (db) =>
    sessionRecord(db, id, expected),
  );
  const workspace = workspaces.find(
    (w) => w.id === session.workspaceId && (!w.hostId || w.hostId === "local"),
  );
  if (!workspace || !path.isAbsolute(workspace.path))
    throw Error("找不到会话对应的本机项目范围");
  if (
    (await fs.realpath(workspace.path)) !== workspace.path ||
    !(await fs.stat(workspace.path)).isDirectory()
  )
    throw Error("项目范围不是可验证的真实目录");
  return { ...session, projectPath: workspace.path };
}

const PROJECTION = `seq,format,deleted,
 json_extract(value_json,'$.itemId') itemId,json_extract(value_json,'$.revision') revision,
 json_extract(value_json,'$.sequence') sequence,json_extract(value_json,'$.observedAt') observedAt,
 json_extract(value_json,'$.body.kind') kind,json_extract(value_json,'$.body.role') role,json_extract(value_json,'$.agentId') agentId,json_extract(value_json,'$.producerKind') producerKind,json_extract(value_json,'$.turnScope.turnItemId') turnItemId,json_extract(value_json,'$.body.path') path,
 json_extract(value_json,'$.body.name') name,json_extract(value_json,'$.body.callId') callId,
 json_extract(value_json,'$.body.state') state,json_extract(value_json,'$.body.exitCode') exitCode,
 json_extract(value_json,'$.body.input.file_path') filePath,
 json_extract(value_json,'$.body.patch.truncated') patchTruncated,
 json_extract(value_json,'$.body.patch.byteLength') patchSize`;

function evidence(row, relation) {
  return {
    kind: "tool-write",
    ...(row.turnItemId ? { turnItemId: row.turnItemId } : {}),
    itemId: row.itemId,
    ...(row.callId ? { callId: row.callId } : {}),
    sequence: row.sequence ?? row.seq,
    observedAt: row.observedAt,
    relation,
  };
}

/** Strict path extraction from complete unified/apply_patch headers only; never shell text. */
export function patchPaths(patch) {
  if (typeof patch !== "string" || patch.length > 256 * 1024) return [];
  const result = [];
  let previousPath = null;
  for (const line of patch.split("\n")) {
    const apply = line.match(/^\*\*\* (Add|Update) File: (.+)$/);
    if (apply) {
      result.push({
        path: apply[2],
        relation: apply[1] === "Add" ? "created" : "modified",
      });
      continue;
    }
    if (line.startsWith("diff --git ")) previousPath = null;
    if (line.startsWith("--- ")) previousPath = line.slice(4).split("\t")[0];
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).split("\t")[0];
      if (previousPath === null || raw === "/dev/null" || raw.startsWith('"'))
        continue;
      result.push({
        path: raw.startsWith("b/") ? raw.slice(2) : raw,
        relation: previousPath === "/dev/null" ? "created" : "modified",
      });
      previousPath = null;
    }
  }
  return [...new Map(result.map((f) => [f.path, f])).values()];
}

function extract(db, generation, key, row, provider) {
  if (
    row.deleted ||
    row.format !== 3 ||
    row.agentId ||
    row.producerKind ||
    typeof row.itemId !== "string"
  )
    return [];
  const queryChanges = (seq) =>
    db
      .prepare(
        `SELECT json_extract(j.value,'$.path') path,
    COALESCE(json_extract(j.value,'$.kind.type'),json_extract(j.value,'$.kind')) changeKind
    FROM journal_outcomes o,json_each(o.value_json,'$.body.input.changes') j
    WHERE o.generation=? AND o.field='items' AND o.entry_key=? AND o.seq=? LIMIT 101`,
      )
      .all(generation, key, seq);
  if (
    provider === "claude" &&
    row.kind === "tool-call" &&
    row.state === "completed" &&
    (row.exitCode === null || row.exitCode === 0) &&
    ["Write", "Edit", "MultiEdit"].includes(row.name) &&
    typeof row.filePath === "string"
  ) {
    // Write can overwrite an existing file. Claim creation only with Claude's explicit result.
    let relation = "modified";
    if (row.name === "Write") {
      const result = db
        .prepare(
          "SELECT substr(json_extract(value_json,'$.body.output.head'),1,8192) head FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq=?",
        )
        .get(generation, key, row.seq);
      if (
        typeof result?.head === "string" &&
        result.head.trim() === `File created successfully at: ${row.filePath}`
      )
        relation = "created";
    }
    return [{ path: row.filePath, evidence: evidence(row, relation) }];
  }
  if (provider !== "codex") return [];
  if (
    row.kind === "tool-call" &&
    row.name === "apply_patch" &&
    row.state === "completed"
  ) {
    const changes = queryChanges(row.seq);
    if (changes.length > 100) return [];
    return changes
      .filter((c) => typeof c.path === "string" && c.changeKind !== "delete")
      .map((c) => ({
        path: c.path,
        evidence: evidence(
          row,
          c.changeKind === "add" ? "created" : "modified",
        ),
      }));
  }
  if (row.kind !== "diff" || typeof row.path !== "string") return [];
  const multiple = row.path.match(/^(\d+) files$/);
  const previous = db
    .prepare(
      `SELECT seq,json_extract(value_json,'$.itemId') itemId,json_extract(value_json,'$.body.callId') callId
    FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq<?
    AND json_extract(value_json,'$.body.kind')='tool-call' AND json_extract(value_json,'$.body.name')='apply_patch' ORDER BY seq DESC LIMIT 1`,
    )
    .get(generation, key, row.seq);
  let changes = [];
  if (previous?.itemId === row.itemId) {
    changes = queryChanges(previous.seq);
    row.callId = previous.callId;
  }
  if (changes.length > 100) return [];
  if (multiple) {
    if (changes.length !== Number(multiple[1])) {
      if (row.patchTruncated || row.patchSize > 256 * 1024) return [];
      const result = db
        .prepare(
          "SELECT json_extract(value_json,'$.body.patch.head') patch FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq=?",
        )
        .get(generation, key, row.seq);
      const parsed = patchPaths(result?.patch);
      if (parsed.length !== Number(multiple[1])) return [];
      return parsed.map((c) => ({
        path: c.path,
        evidence: evidence(row, c.relation),
      }));
    }
    return changes
      .filter((c) => typeof c.path === "string" && c.changeKind !== "delete")
      .map((c) => ({
        path: c.path,
        evidence: evidence(
          row,
          c.changeKind === "add" ? "created" : "modified",
        ),
      }));
  }
  const matching = changes.find((c) => c.path === row.path);
  return [
    {
      path: row.path,
      evidence: evidence(
        row,
        matching?.changeKind === "add" ? "created" : "modified",
      ),
    },
  ];
}

export async function readEvidence(paths, session, previous) {
  return database(paths.journal, 4, JOURNAL_TABLES, (db) => {
    sessionRecord(db, session.id, { workspaceId: session.workspaceId });
    const epoch = db
      .prepare(
        "SELECT epoch,generation,format,through_seq,prefix_seq FROM journal_outcome_epochs WHERE session_id=?",
      )
      .get(session.id);
    if (!epoch)
      return {
        status: "ok",
        cache: { entries: {}, through: 0, generation: null },
        evidence: [],
      };
    if (epoch.format !== 3 || epoch.prefix_seq !== 0)
      throw Error("此会话 outcome/prefix 格式未适配，自动归属已关闭");
    const reusable =
      previous?.readerVersion === 4 &&
      previous?.generation === epoch.generation &&
      previous?.epoch === epoch.epoch &&
      previous.through <= epoch.through_seq;
    const cursor = reusable ? previous.through : -1;
    if (reusable && !previous.scan && cursor === epoch.through_seq)
      return {
        status: "ok",
        cache: previous,
        turns: previous.turns || [],
        evidence: [
          ...Object.values(previous.entries).flat(),
          ...Object.values(previous.deliveryTurns || {}).flat(),
        ],
      };
    const progress =
      reusable &&
      previous.scan &&
      previous.scan.targetThrough <= epoch.through_seq
        ? previous.scan
        : { targetThrough: epoch.through_seq, afterKey: "" };
    const keys = db
      .prepare(
        "SELECT DISTINCT entry_key FROM journal_outcomes WHERE generation=? AND field='items' AND seq>? AND seq<=? AND entry_key>? ORDER BY entry_key LIMIT ?",
      )
      .all(
        epoch.generation,
        cursor,
        progress.targetThrough,
        progress.afterKey,
        MAX_ITEMS + 1,
      );
    const more = keys.length > MAX_ITEMS;
    const batch = keys.slice(0, MAX_ITEMS);
    const entries = reusable ? { ...previous.entries } : {};
    const entryTurns = reusable ? { ...previous.entryTurns } : {};
    const deliveryTurns = reusable ? { ...previous.deliveryTurns } : {};
    const affectedTurns = new Set();
    const latest = db.prepare(
      "SELECT " +
        PROJECTION +
        " FROM journal_outcomes WHERE generation=? AND field='items' AND entry_key=? AND seq<=? ORDER BY seq DESC LIMIT 1",
    );
    for (const { entry_key: key } of batch) {
      const row = latest.get(epoch.generation, key, progress.targetThrough);
      if (row?.format !== 3) throw Error("不支持的 outcome item format");
      if (entryTurns[key]) affectedTurns.add(entryTurns[key]);
      delete entryTurns[key];
      if (!row.deleted && !row.agentId && !row.producerKind) {
        const turnId = row.kind === "turn" ? row.itemId : row.turnItemId;
        if (turnId) {
          entryTurns[key] = turnId;
          affectedTurns.add(turnId);
        }
      }
      delete entries[key];
      if (row && !row.deleted) {
        const found = extract(db, epoch.generation, key, row, session.provider);
        const scoped = found.flatMap((proof) => {
          if (
            typeof proof.path !== "string" ||
            !path.isAbsolute(session.projectPath || "")
          )
            return [];
          const file = path.resolve(session.projectPath, proof.path),
            relative = path.relative(session.projectPath, file);
          if (
            !relative ||
            relative.startsWith(".." + path.sep) ||
            relative === ".." ||
            path.isAbsolute(relative)
          )
            return [];
          if (
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
          if (
            !/\.(html?|png|jpe?g|webp|gif|pdf|mp4|mov|webm|m4v|md|markdown|xlsx?|csv)$/i.test(
              file,
            )
          )
            return [];
          return [{ ...proof, path: file }];
        });
        if (scoped.length) entries[key] = scoped;
      }
    }
    for (const turnId of affectedTurns) {
      const proof = finalTurnDelivery(
        db,
        epoch.generation,
        turnId,
        progress.targetThrough,
        session.projectPath,
      );
      if (proof.length) deliveryTurns[turnId] = proof;
      else delete deliveryTurns[turnId];
    }
    const turns = db
      .prepare(
        `SELECT json_extract(o.value_json,'$.itemId') id,COALESCE(json_extract(o.value_json,'$.sequence'),o.seq) sequence,json_extract(o.value_json,'$.body.state') state,json_extract(o.value_json,'$.body.outcome') outcome FROM journal_outcomes o WHERE o.generation=? AND o.field='items' AND o.seq<=? AND o.deleted=0 AND json_extract(o.value_json,'$.body.kind')='turn' AND json_extract(o.value_json,'$.agentId') IS NULL AND json_extract(o.value_json,'$.producerKind') IS NULL AND o.seq=(SELECT MAX(j.seq) FROM journal_outcomes j WHERE j.generation=o.generation AND j.field=o.field AND j.entry_key=o.entry_key AND j.seq<=?)`,
      )
      .all(epoch.generation, progress.targetThrough, progress.targetThrough);
    const cache = {
      turns,
      readerVersion: 4,
      entryTurns,
      deliveryTurns,
      generation: epoch.generation,
      epoch: epoch.epoch,
      through: more ? cursor : progress.targetThrough,
      entries,
      ...(more
        ? {
            scan: {
              targetThrough: progress.targetThrough,
              afterKey: batch.at(-1).entry_key,
            },
          }
        : {}),
    };
    return {
      status: more ? "loading" : "ok",
      turns,
      cache,
      evidence: [
        ...Object.values(entries).flat(),
        ...Object.values(deliveryTurns).flat(),
      ],
    };
  });
}

export async function sessionMetadata(paths, id) {
  return database(paths.journal, 4, JOURNAL_TABLES, (db) =>
    sessionRecord(db, id),
  );
}
