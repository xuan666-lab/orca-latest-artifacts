import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scopedArtifact } from "./registrations.mjs";
import { hash, signature } from "./core.mjs";
import { patchPaths } from "./session-adapter.mjs";
const exec = promisify(execFile);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const trackerRoot = () =>
  path.join(os.homedir(), ".orca-artifact-tools", "terminal-tracking");

async function privateDir(dir) {
  try {
    await fs.mkdir(dir, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  if ((await fs.realpath(dir)) !== dir || !(await fs.lstat(dir)).isDirectory())
    throw Error("终端追踪目录不安全");
  await fs.chmod(dir, 0o700);
}
async function prepare(root) {
  await privateDir(path.dirname(root));
  await privateDir(root);
  for (const name of ["launches", "panes", "sessions"])
    await privateDir(path.join(root, name));
}
async function read(file) {
  const s = await fs.lstat(file);
  if (
    s.isSymbolicLink() ||
    !s.isFile() ||
    s.size > 32768 ||
    (await fs.realpath(file)) !== file
  )
    throw Error("无效的终端追踪记录");
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function write(file, value) {
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
export async function liveTerminals(workspaceId, runner = exec) {
  const { stdout } = await runner(
    "orca",
    ["terminal", "list", "--worktree", "id:" + workspaceId, "--json"],
    { timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  const r = JSON.parse(stdout);
  if (!r.ok || r.result?.truncated) throw Error("无法完整核验活跃终端");
  return r.result.terminals;
}
function scope(env, live) {
  const pane = env.ORCA_PANE_KEY || env.ORCA_AGENT_PANE,
    tab = env.ORCA_TAB_ID,
    workspace = env.ORCA_WORKTREE_ID;
  const token = env.ORCA_AGENT_LAUNCH_TOKEN || env.ORCA_AGENT_LAUNCH;
  if (!pane || !tab || !workspace)
    throw Error("缺少 Orca 终端 pane 身份；请从本机 Orca 终端启动");
  const matches = live.filter(
    (t) =>
      t.tabId === tab &&
      pane === t.tabId + ":" + t.leafId &&
      t.worktreeId === workspace &&
      t.connected &&
      !t.orphaned &&
      t.executionHostId === "local",
  );
  if (matches.length !== 1) throw Error("终端身份不唯一或已失效");
  const t = matches[0];
  return {
    paneKey: pane,
    tabId: tab,
    workspaceId: workspace,
    handle: t.handle,
    incarnationId: t.incarnationId,
    projectPath: t.worktreePath,
    orcaLaunchHash: token ? digest(token) : null,
  };
}
export async function beginTrackedLaunch(
  provider,
  env,
  live,
  root = trackerRoot(),
) {
  if (!["claude", "codex"].includes(provider))
    throw Error("只支持 Claude/Codex 本机终端");
  const bound = scope(env, live);
  if ((await fs.realpath(bound.projectPath)) !== bound.projectPath)
    throw Error("项目路径不是规范目录");
  await prepare(root);
  const proof = randomBytes(32).toString("hex"),
    id = randomUUID();
  const record = {
    schemaVersion: 1,
    id,
    provider,
    ...bound,
    proofHash: digest(proof),
    launchIdentity: "plugin-tracked-process",
    active: true,
    sessionId: null,
    generation: 0,
    createdAt: Date.now(),
  };
  await write(path.join(root, "launches", id + ".json"), record);
  await write(path.join(root, "panes", digest(bound.paneKey) + ".json"), {
    launchId: id,
  });
  return { record, proof };
}
export async function validateTrackedLaunch(env, live, root = trackerRoot()) {
  const id = env.ARTIFACT_SHELF_LAUNCH_ID,
    proof = env.ARTIFACT_SHELF_BINDING_PROOF;
  if (!ID.test(id || "") || !proof) throw Error("终端未通过追踪启动器接入");
  const record = await read(path.join(root, "launches", id + ".json"));
  if (
    record.schemaVersion !== 1 ||
    !record.active ||
    record.proofHash !== digest(proof)
  )
    throw Error("终端追踪绑定已撤销或校验失败");
  const current = scope(env, live);
  for (const field of [
    "paneKey",
    "tabId",
    "workspaceId",
    "handle",
    "incarnationId",
    "orcaLaunchHash",
  ])
    if (record[field] !== current[field])
      throw Error("终端实例或启动身份已更换，拒绝旧绑定");
  const pointer = await read(
    path.join(root, "panes", digest(record.paneKey) + ".json"),
  );
  if (pointer.launchId !== id) throw Error("终端已由新的追踪启动接管");
  return record;
}
async function recordFile(record, file, evidence, root) {
  const artifact = await scopedArtifact(file, [record.projectPath]);
  if (artifact.missing) throw Error("产物已删除");
  const before = await fs.stat(artifact.path),
    contentHash = await hash(artifact.path),
    after = await fs.stat(artifact.path);
  if (signature(before) !== signature(after))
    throw Error("产物写入中，稍后登记");
  const sessionKey = digest(record.provider + ":" + record.sessionId),
    directory = path.join(root, "sessions", sessionKey);
  await privateDir(directory);
  const id = evidence.itemId
    ? digest(evidence.itemId + "\0" + artifact.path)
    : randomUUID();
  const value = {
    schemaVersion: 1,
    sourceSession: {
      id: record.sessionId,
      provider: record.provider,
      workspaceId: record.workspaceId,
      name: record.provider + " 终端 · " + record.sessionId.slice(0, 8),
    },
    sourceEvidence: evidence,
    artifact: { path: artifact.path, signature: signature(after), contentHash },
    binding: { launchId: record.id, incarnationId: record.incarnationId },
  };
  await write(path.join(directory, id + ".json"), value);
  return value;
}
export async function acceptTerminalHook(
  provider,
  payload,
  env,
  live,
  root = trackerRoot(),
) {
  const record = await validateTrackedLaunch(env, live, root);
  if (provider !== record.provider || !ID.test(payload.session_id || ""))
    throw Error("provider 会话身份不匹配");
  if (payload.agent_id) return { ignored: "subagent" };
  const event = payload.hook_event_name;
  if (event === "SessionStart") {
    if (
      !["startup", "resume", "clear", "compact", "fork"].includes(
        payload.source,
      )
    )
      throw Error("未知会话开始来源");
    record.sessionId = payload.session_id;
    record.generation++;
    record.sessionEnded = false;
    await write(path.join(root, "launches", record.id + ".json"), record);
    return { bound: true, sessionId: record.sessionId };
  }
  if (record.sessionId !== payload.session_id || record.sessionEnded)
    throw Error("会话已切换，拒绝旧会话事件");
  if (event === "SessionEnd") {
    record.sessionEnded = true;
    await write(path.join(root, "launches", record.id + ".json"), record);
    return { ended: true };
  }
  if (event !== "PostToolUse") return { ignored: "event" };
  const callId = payload.tool_use_id;
  if (typeof callId !== "string" || callId.length > 300)
    return { ignored: "unidentified call" };
  let files = [];
  if (
    provider === "claude" &&
    ["Write", "Edit", "MultiEdit"].includes(payload.tool_name) &&
    typeof payload.tool_input?.file_path === "string" &&
    !payload.tool_response?.is_error
  ) {
    files = [
      {
        path: payload.tool_input.file_path,
        relation:
          payload.tool_response?.type === "create" ? "created" : "modified",
      },
    ];
  }
  if (provider === "codex" && payload.tool_name === "apply_patch") {
    const output =
      typeof payload.tool_response === "string"
        ? payload.tool_response
        : payload.tool_response?.output;
    if (
      typeof output === "string" &&
      /^Success\. Updated the following files:/m.test(output)
    )
      files = patchPaths(payload.tool_input?.command);
  }
  let count = 0;
  for (const file of files.slice(0, 100)) {
    if (!path.isAbsolute(file.path)) {
      if (!path.isAbsolute(payload.cwd || "")) continue;
      file.path = path.resolve(payload.cwd, file.path);
    }
    try {
      await recordFile(
        record,
        file.path,
        {
          kind: "tool-write",
          itemId: callId,
          callId,
          relation: file.relation,
          observedAt: Date.now(),
        },
        root,
      );
      count++;
    } catch (error) {
      if (!/不支持|排除|超出/.test(error.message)) throw error;
    }
  }
  return { captured: count };
}
export async function registerTerminalFile(
  file,
  env,
  live,
  root = trackerRoot(),
) {
  const record = await validateTrackedLaunch(env, live, root);
  if (!record.sessionId || record.sessionEnded)
    throw Error("尚未收到真实 provider SessionStart，不能登记");
  return recordFile(
    record,
    file,
    {
      kind: "session-registration",
      itemId: randomUUID(),
      relation: "registered",
      observedAt: Date.now(),
    },
    root,
  );
}
export async function endTrackedLaunch(id, root = trackerRoot()) {
  if (!ID.test(id || "")) return;
  const file = path.join(root, "launches", id + ".json");
  const record = await read(file);
  record.active = false;
  record.endedAt = Date.now();
  await write(file, record);
}
export async function trackedTerminal(candidate, live, root = trackerRoot()) {
  const matches = live.filter(
    (t) =>
      t.worktreeId === candidate.workspaceId &&
      t.tabId === candidate.tabId &&
      t.connected &&
      !t.orphaned &&
      t.executionHostId === "local",
  );
  if (matches.length !== 1)
    return {
      status: "unavailable",
      reason: "终端未接入或拆分 pane 无法唯一确认",
    };
  const terminal = matches[0],
    paneKey = terminal.tabId + ":" + terminal.leafId;
  let record;
  try {
    const pointer = await read(
      path.join(root, "panes", digest(paneKey) + ".json"),
    );
    record = await read(
      path.join(root, "launches", pointer.launchId + ".json"),
    );
  } catch {
    return { status: "unavailable", reason: "终端未接入追踪" };
  }
  if (
    !record.active ||
    record.sessionEnded ||
    !record.sessionId ||
    record.handle !== terminal.handle ||
    record.incarnationId !== terminal.incarnationId
  )
    return { status: "unavailable", reason: "终端追踪未激活或实例已更换" };
  const session = {
    id: record.sessionId,
    provider: record.provider,
    workspaceId: record.workspaceId,
    name: record.provider + " 终端 · " + record.sessionId.slice(0, 8),
    projectPath: record.projectPath,
    surface: "terminal",
  };
  const directory = path.join(
    root,
    "sessions",
    digest(record.provider + ":" + record.sessionId),
  );
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (e) {
    if (e.code === "ENOENT") names = [];
    else throw e;
  }
  if (names.length > 2000) throw Error("终端登记记录过多，请归档旧任务");
  const evidence = [];
  for (const name of names) {
    if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
    const value = await read(path.join(directory, name));
    if (
      value.sourceSession?.id !== record.sessionId ||
      value.sourceSession?.provider !== record.provider ||
      value.sourceSession?.workspaceId !== record.workspaceId
    )
      continue;
    evidence.push({
      path: value.artifact.path,
      evidence: value.sourceEvidence,
      registeredHash: value.artifact.contentHash,
      registeredSignature: value.artifact.signature,
    });
  }
  return { status: "ok", session, evidence };
}
