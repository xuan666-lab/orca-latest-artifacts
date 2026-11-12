import { constants } from "node:fs";
/** Existing Claude terminal compatibility: exact pane + live process, bounded selected transcript. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { liveTerminals } from "./terminal-tracking.mjs";
import { scopedArtifact } from "./registrations.mjs";
const exec = promisify(execFile),
  sha = (b) => createHash("sha256").update(b).digest("hex");
// Track failed persistence for a stable in-memory cursor without retrying the
// same full cache on every refresh. A changed transcript retries the write.
const cacheFailures = new WeakMap();
const WINDOW = 8 * 1024 * 1024,
  MAX_LINES = 2000,
  MAX_LINE = 4 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const EXT =
  /\.(html?|png|jpe?g|webp|gif|pdf|mp4|mov|webm|m4v|md|markdown|xlsx?|csv)$/i;

async function hookIdentity(terminal, options = {}) {
  const dbFile =
    options.statusDb ||
    path.join(
      os.homedir(),
      "Library/Application Support/orca/agent-hooks/last-status.db",
    );
  if ((await fs.realpath(dbFile)) !== dbFile)
    throw Error("拒绝符号链接终端身份数据库");
  const { DatabaseSync } = await import("node:sqlite"),
    db = new DatabaseSync(dbFile, { readOnly: true, timeout: 100 });
  try {
    if (
      db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()
        ?.value !== "202"
    )
      throw Error("终端身份缓存版本未适配");
    const paneKey = terminal.tabId + ":" + terminal.leafId;
    const row = db
      .prepare(
        `SELECT seq,
      json_extract(value,'$.providerSession.id') sessionId,
      json_extract(value,'$.providerSession.key') sessionKey,
      json_extract(value,'$.providerSession.transcriptPath') transcript,
      json_extract(value,'$.providerSession.cwd') cwd,
      json_extract(value,'$.agentPresence.process.pid') pid,
      json_extract(value,'$.agentPresence.process.startTime') startTime,
      json_extract(value,'$.agentPresence.process.platform') platform,
      json_extract(value,'$.agentPresence.sessionOwner') sessionOwner,
      json_extract(value,'$.hostTurn.owner') owner,
      json_extract(value,'$.payload.agentType') provider,
      json_extract(value,'$.worktreeId') workspaceId,
      json_extract(value,'$.tabId') tabId,json_extract(value,'$.paneKey') paneKey,
      json_extract(value,'$.connectionId') connectionId
      FROM rows WHERE key=?`,
      )
      .get("entry\0" + paneKey);
    if (
      !row ||
      row.provider !== "claude" ||
      row.sessionKey !== "session_id" ||
      !ID.test(row.sessionId || "") ||
      row.sessionOwner !== 1 ||
      row.owner !== "claude:" + row.sessionId ||
      row.platform !== "darwin" ||
      !Number.isInteger(row.pid) ||
      row.pid <= 0
    )
      throw Error("没有可验证的终端 provider/process 绑定");
    if (
      row.workspaceId !== terminal.worktreeId ||
      row.tabId !== terminal.tabId ||
      row.paneKey !== paneKey ||
      row.connectionId !== null
    )
      throw Error("终端身份范围不一致");
    if (
      row.cwd !== terminal.worktreePath ||
      !path.isAbsolute(row.transcript || "") ||
      path.basename(row.transcript) !== row.sessionId + ".jsonl"
    )
      throw Error("终端会话路径与项目不一致");
    if (
      !options.allowFixturePaths &&
      !row.transcript.startsWith(os.homedir() + path.sep)
    )
      throw Error("终端会话记录不在本机用户范围");
    if ((await fs.realpath(row.transcript)) !== row.transcript)
      throw Error("拒绝符号链接会话记录");
    return row;
  } finally {
    db.close();
  }
}
async function processIdentity(identity, options) {
  const { stdout } = await (options.runner || exec)(
    "/bin/ps",
    ["-p", String(identity.pid), "-o", "lstart=,comm="],
    {
      env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
      timeout: 2000,
      maxBuffer: 4096,
    },
  );
  const line = stdout.trim().replace(/\s+/g, " "),
    start = String(identity.startTime).trim().replace(/\s+/g, " ");
  if (
    !line.startsWith(start + " ") ||
    path.basename(line.slice(start.length + 1)) !== "claude"
  )
    throw Error("终端进程已退出或启动时间不一致");
  return line;
}
function inProject(raw, project) {
  if (typeof raw !== "string" || raw.includes("\0") || !EXT.test(raw))
    return null;
  const file = path.resolve(project, raw),
    relative = path.relative(project, file);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
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
    return null;
  return file;
}
/** Explicit final delivery blocks/links, not generic path mentions or reference prose. */
export function deliveryPaths(text, project) {
  if (
    typeof text !== "string" ||
    text.length > MAX_LINE ||
    !/交付|产物|输出文件|生成结果|文件已|已(?:经)?(?:完成|生成|创建|写|输出|整理|保存)|\b(?:created|generated|saved|written|delivered)\b/i.test(
      text,
    ) ||
    /参考资料|参考文件|引用文件|示例路径|计划生成/.test(text)
  )
    return [];
  const candidates = [];
  for (const block of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    for (const line of block[1].split("\n")) candidates.push(line.trim());
  for (const link of text.matchAll(/\[[^\]]*\]\((<?[^)]+>?)\)/g))
    candidates.push(link[1].replace(/^<|>$/g, ""));
  for (const code of text
    .replace(/```[\s\S]*?```/g, "")
    .matchAll(/`([^`\n]+)`/g))
    candidates.push(code[1]);
  for (const line of text.split("\n"))
    if (/^\s*\//.test(line)) candidates.push(line.trim());
  return [
    ...new Set(
      candidates
        .filter((p) => p.startsWith("/") || p.startsWith("./"))
        .map((p) => inProject(p, project))
        .filter(Boolean),
    ),
  ];
}

export async function readClaudeTail(
  identity,
  project,
  previous,
  options = {},
) {
  const handle = await fs.open(
    identity.transcript,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat(),
      fileId = stat.dev + ":" + stat.ino;
    let cache =
      previous?.fileId === fileId && previous.offset <= stat.size
        ? structuredClone(previous)
        : null;
    if (cache && cache.offset > 0) {
      const length = Math.min(128, cache.offset),
        anchor = Buffer.alloc(length);
      await handle.read(anchor, 0, length, cache.offset - length);
      if (sha(anchor) !== cache.anchor) cache = null;
    }
    if (cache && cache.offset === stat.size && cache.mtime !== stat.mtimeMs)
      cache = null;
    if (!cache)
      cache = {
        fileId,
        offset: Math.max(0, stat.size - (options.window || WINDOW)),
        skipFirst: stat.size > (options.window || WINDOW),
        pending: {},
        evidence: {},
        startOffset: Math.max(0, stat.size - (options.window || WINDOW)),
      };
    const available = Math.min(
      options.window || WINDOW,
      stat.size - cache.offset,
    );
    const bytes = Buffer.alloc(available);
    if (available) await handle.read(bytes, 0, available, cache.offset);
    let start = 0,
      lines = 0,
      consumed = 0;
    if (cache.skipFirst) {
      const newline = bytes.indexOf(10);
      if (newline < 0) {
        cache.offset += bytes.length;
        cache.skipFirst = true;
        consumed = bytes.length;
      } else {
        start = newline + 1;
        consumed = start;
        cache.skipFirst = false;
      }
    }
    while (start < bytes.length && lines < MAX_LINES) {
      const end = bytes.indexOf(10, start);
      if (end < 0) break;
      const line = bytes.subarray(start, end);
      consumed = end + 1;
      start = end + 1;
      lines++;
      if (line.length > MAX_LINE) {
        cache.skippedLarge = (cache.skippedLarge || 0) + 1;
        continue;
      }
      let row;
      try {
        row = JSON.parse(line.toString("utf8"));
      } catch {
        continue;
      }
      if (row.sessionId !== identity.sessionId || row.isSidechain) continue;
      const parts = Array.isArray(row.message?.content)
        ? row.message.content
        : [];
      if (row.type === "assistant") {
        for (const part of parts) {
          if (
            part.type === "tool_use" &&
            ["Write", "Edit", "MultiEdit"].includes(part.name) &&
            typeof part.id === "string"
          ) {
            const file = inProject(part.input?.file_path, project);
            if (file) cache.pending[part.id] = { path: file, name: part.name };
          }
        }
        if (
          row.message?.stop_reason === "end_turn" &&
          !parts.some((p) => p.type === "tool_use") &&
          typeof row.uuid === "string"
        ) {
          for (const part of parts.filter((p) => p.type === "text"))
            for (const file of deliveryPaths(part.text, project)) {
              cache.evidence["delivery:" + row.uuid + ":" + file] = {
                path: file,
                evidence: {
                  kind: "session-delivery",
                  relation: "delivered",
                  itemId: row.uuid,
                  observedAt: row.timestamp,
                },
              };
            }
        }
      }
      if (row.type === "user")
        for (const part of parts) {
          if (
            part.type !== "tool_result" ||
            typeof part.tool_use_id !== "string"
          )
            continue;
          const pending = cache.pending[part.tool_use_id];
          delete cache.pending[part.tool_use_id];
          if (pending && part.is_error !== true)
            cache.evidence["tool:" + part.tool_use_id] = {
              path: pending.path,
              evidence: {
                kind: "tool-write",
                relation:
                  row.toolUseResult?.type === "create" ? "created" : "modified",
                itemId: part.tool_use_id,
                callId: part.tool_use_id,
                observedAt: row.timestamp,
              },
            };
        }
      const pending = Object.keys(cache.pending);
      if (pending.length > 128)
        for (const key of pending.slice(0, pending.length - 128))
          delete cache.pending[key];
    }
    if (
      consumed === 0 &&
      bytes.length > 0 &&
      bytes.length === (options.window || WINDOW)
    ) {
      cache.offset += bytes.length;
      cache.skipFirst = true;
      cache.skippedLarge = (cache.skippedLarge || 0) + 1;
    } else if (!cache.skipFirst) cache.offset += consumed;
    const currentFile = await fs.stat(identity.transcript);
    if (
      currentFile.dev + ":" + currentFile.ino !== fileId ||
      currentFile.size < cache.offset
    )
      throw Error("会话记录读取期间被替换");
    const anchorLength = Math.min(128, cache.offset),
      anchor = Buffer.alloc(anchorLength);
    if (anchorLength)
      await handle.read(anchor, 0, anchorLength, cache.offset - anchorLength);
    cache.anchor = sha(anchor);
    cache.mtime = stat.mtimeMs;
    return {
      cache,
      evidence: Object.values(cache.evidence),
      loading: cache.offset < stat.size,
      coverage: cache.startOffset > 0 ? "recent-tail" : "complete",
    };
  } finally {
    await handle.close();
  }
}

export async function existingClaudeTerminal(
  candidate,
  live,
  storage,
  options = {},
) {
  const matches = live.filter(
    (t) =>
      t.tabId === candidate.tabId &&
      t.worktreeId === candidate.workspaceId &&
      t.connected &&
      !t.orphaned &&
      t.executionHostId === "local" &&
      t.agentIdentity === "claude",
  );
  if (matches.length !== 1) return null;
  const terminal = matches[0];
  const identity = await hookIdentity(terminal, options);
  const processBefore = await processIdentity(identity, options);
  const key =
    "terminal.history.v1." +
    sha(
      identity.sessionId +
        ":" +
        terminal.incarnationId +
        ":" +
        identity.startTime,
    );
  let previous;
  try {
    previous = storage.getCache ? await storage.getCache(key) : await storage.get(key);
  } catch {
    // This is a derived cursor; the original transcript remains authoritative.
    previous = null;
  }
  const result = await readClaudeTail(
      identity,
      terminal.worktreePath,
      previous,
      options,
    );
  const after = await hookIdentity(terminal, options);
  if (
    JSON.stringify(identity) !== JSON.stringify(after) ||
    (await processIdentity(after, options)) !== processBefore
  )
    throw Error("读取期间终端会话身份变化，请重试");
  const refreshed = options.liveTerminals
    ? await options.liveTerminals(candidate.workspaceId)
    : await liveTerminals(candidate.workspaceId);
  if (
    !refreshed.some(
      (t) =>
        t.handle === terminal.handle &&
        t.incarnationId === terminal.incarnationId &&
        t.tabId === terminal.tabId &&
        t.worktreeId === terminal.worktreeId &&
        t.connected &&
        !t.orphaned,
    )
  )
    throw Error("终端实例读取期间已变化");
  const evidence = [];
  for (const proof of result.evidence) {
    try {
      const file = await scopedArtifact(proof.path, [terminal.worktreePath]);
      if (proof.evidence.kind !== "session-delivery" || !file.missing)
        evidence.push(proof);
    } catch {
      /* Only scoped, non-symlink artifacts are admitted. */
    }
  }
  if (JSON.stringify(previous) !== JSON.stringify(result.cache)) {
    let persisted = false;
    try {
      if (storage.setCache) persisted = (await storage.setCache(key, result.cache)).persisted;
      else { await storage.set(key, result.cache); persisted = true; }
    } catch { /* A cache write must not invalidate verified terminal evidence. */ }
    let failed = cacheFailures.get(storage);
    if (!failed) { failed = new Set(); cacheFailures.set(storage, failed); }
    if (persisted) failed.delete(key);
    else failed.add(key);
  }
  return {
    status: "ok",
    cacheWarning: !!cacheFailures.get(storage)?.has(key),
    session: {
      id: identity.sessionId,
      provider: "claude",
      workspaceId: terminal.worktreeId,
      projectPath: terminal.worktreePath,
      name: "claude 终端 · " + identity.sessionId.slice(0, 8),
      surface: "terminal",
    },
    evidence,
    loading: result.loading,
    coverage: result.coverage,
    binding: {
      handle: terminal.handle,
      incarnationId: terminal.incarnationId,
      processId: identity.pid,
      processStart: identity.startTime,
      checkedAt: Date.now(),
    },
  };
}
