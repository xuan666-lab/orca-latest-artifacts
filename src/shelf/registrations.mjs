import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { verifySession } from "./session-adapter.mjs";
import { safe, hash, signature, metadata } from "./core.mjs";

export const registrationRoot = () =>
  path.join(os.homedir(), ".orca-artifact-tools", "registrations");
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,40}$/;
export async function scopedArtifact(raw, roots) {
  if (typeof raw !== "string" || raw.includes("\0"))
    throw Error("产物路径无效");
  const p = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.resolve(roots[0], raw);
  const root = roots.find((r) => p.startsWith(r + path.sep));
  if (!root) throw Error("产物超出会话项目/授权输出范围");
  const relative = path.relative(root, p);
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
    throw Error("产物位于排除目录");
  const kind = metadata(p, root, {
    size: 0,
    mtimeMs: 0,
    ctimeMs: 0,
    dev: 0,
    ino: 0,
  }).kind;
  if (!kind) throw Error("不支持的产物类型");
  // Check all existing ancestors even when the final file has been deleted.
  const parts = relative.split(path.sep);
  let current = root;
  if ((await fs.realpath(root)) !== root) throw Error("拒绝符号链接根目录");
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (!stat) return { path: p, root, relative, kind, missing: true };
    if (stat.isSymbolicLink()) throw Error("拒绝符号链接产物");
  }
  await safe(p, roots);
  return { ...metadata(p, root, await fs.stat(p)), missing: false };
}
async function privateDir(directory) {
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  if (
    (await fs.realpath(directory)) !== directory ||
    !(await fs.lstat(directory)).isDirectory()
  )
    throw Error("登记目录不安全");
  await fs.chmod(directory, 0o700);
}
export async function registerArtifact({
  paths,
  sessionId,
  workspaces,
  file,
  directory = registrationRoot(),
}) {
  const session = await verifySession(paths, sessionId, workspaces);
  const artifact = await scopedArtifact(file, [session.projectPath]);
  if (artifact.missing) throw Error("文件不存在，不能登记");
  const before = await fs.stat(artifact.path),
    contentHash = await hash(artifact.path);
  await safe(artifact.path, [session.projectPath]);
  const after = await fs.stat(artifact.path);
  if (signature(before) !== signature(after))
    throw Error("文件正在写入，登记未保存");
  await privateDir(path.dirname(directory));
  await privateDir(directory);
  const target = path.join(directory, session.id);
  await privateDir(target);
  const id = randomUUID(),
    record = {
      schemaVersion: 1,
      id,
      sourceSession: {
        id: session.id,
        provider: session.provider,
        workspaceId: session.workspaceId,
        name: session.name,
      },
      artifact: {
        path: artifact.path,
        contentHash,
        signature: signature(after),
      },
      sourceEvidence: {
        kind: "session-registration",
        itemId: id,
        relation: "registered",
        observedAt: new Date().toISOString(),
      },
    };
  const temporary = path.join(target, id + ".tmp");
  try {
    await fs.writeFile(temporary, JSON.stringify(record), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, path.join(target, id + ".json"));
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return record;
}
export async function readRegistrations(
  session,
  roots,
  directory = registrationRoot(),
) {
  const target = path.join(directory, session.id);
  try {
    if ((await fs.realpath(target)) !== target)
      throw Error("拒绝符号链接登记目录");
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const names = (await fs.readdir(target)).filter(
    (n) => n.endsWith(".json") && UUID.test(n.slice(0, -5)),
  );
  if (names.length > 1000) throw Error("此会话登记数量超过上限");
  const results = [];
  for (const name of names) {
    const file = path.join(target, name),
      stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16384) continue;
    let record;
    try {
      record = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      continue;
    }
    if (
      record.schemaVersion !== 1 ||
      record.sourceSession?.id !== session.id ||
      record.sourceSession?.workspaceId !== session.workspaceId ||
      record.sourceEvidence?.kind !== "session-registration" ||
      record.sourceEvidence?.relation !== "registered" ||
      !/^([a-f0-9]{64})$/.test(record.artifact?.contentHash || "")
    )
      continue;
    try {
      await scopedArtifact(record.artifact.path, roots);
      results.push({
        path: record.artifact.path,
        evidence: record.sourceEvidence,
        registeredHash: record.artifact.contentHash,
        registeredSignature: record.artifact.signature,
      });
    } catch {
      /* Invalid/out-of-scope declarations are never promoted. */
    }
  }
  return results;
}
