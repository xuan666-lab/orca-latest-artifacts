import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const excluded = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "warehouse",
  "__pycache__",
  "cache",
  "dist",
  "build",
]);
const kinds = {
  html: "HTML",
  xlsx: "表格",
  xls: "表格",
  csv: "表格",
  md: "Markdown",
  markdown: "Markdown",
  htm: "HTML",
  png: "图片",
  jpg: "图片",
  jpeg: "图片",
  webp: "图片",
  gif: "图片",
  pdf: "PDF",
  mp4: "视频",
  mov: "视频",
  webm: "视频",
  m4v: "视频",
};
export const signature = (s) =>
  `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
export const metadata = (p, root, s) => ({
  path: p,
  root,
  relative: path.relative(root, p),
  kind: kinds[path.extname(p).slice(1).toLowerCase()],
  size: s.size,
  mtime: s.mtimeMs,
  signature: signature(s),
});

export async function validateRoots(roots) {
  for (const root of roots) {
    if (root === path.parse(root).root || root === process.env.HOME)
      throw Error("请选择限定输出子目录");
    if (
      (await fs.realpath(root)) !== root ||
      !(await fs.lstat(root)).isDirectory()
    )
      throw Error("输出路径必须是真实目录：" + root);
  }
}

export async function inventory(roots, diagnostics = [], limit = 10000) {
  let visited = 0;
  const out = {};
  async function walk(p, root) {
    try {
      if (++visited > limit) {
        if (!diagnostics.some((e) => e.code === "LIMIT" && e.path === root))
          diagnostics.push({
            path: root,
            code: "LIMIT",
            message: "目录超过 " + limit + " 项扫描上限，请缩小输出目录",
          });
        return;
      }
      const s = await fs.lstat(p);
      if (s.isSymbolicLink()) return;
      if (s.isDirectory()) {
        for (const n of await fs.readdir(p)) {
          if (!n.startsWith(".") && !excluded.has(n))
            await walk(path.join(p, n), root);
          if (visited > limit) break;
        }
      } else {
        const f = metadata(p, root, s);
        if (f.kind && s.isFile()) out[p] = f;
      }
    } catch (e) {
      diagnostics.push({
        path: p,
        code: e.code || "IO",
        message: String(e.message),
      });
    }
  }
  for (const root of roots) {
    try {
      await validateRoots([root]);
      await walk(root, root);
    } catch (e) {
      diagnostics.push({
        path: root,
        code: e.code || "ROOT",
        message: String(e.message),
      });
    }
  }
  return out;
}

export async function hash(p) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(p)) h.update(chunk);
  return h.digest("hex");
}

export async function safe(p, roots) {
  if (!roots.some((r) => p.startsWith(r + path.sep)))
    throw Error("超出收集范围");
  if ((await fs.realpath(p)) !== p) throw Error("拒绝符号链接");
  if (!(await fs.lstat(p)).isFile()) throw Error("不是普通文件");
  return p;
}

export async function deliver(file, roots, digest = hash) {
  await safe(file.path, roots);
  const before = await fs.stat(file.path);
  const contentHash = await digest(file.path);
  await safe(file.path, roots);
  const after = await fs.stat(file.path);
  if (signature(before) !== signature(after))
    throw Error("文件仍在写入，请稍后重试");
  Object.assign(file, metadata(file.path, file.root, after), {
    contentHash,
    delivered: contentHash,
    deliveredSignature: signature(after),
    changed: false,
    missing: false,
    unavailable: false,
  });
}

export function reconcile(task, files, importAll = false, diagnostics = []) {
  for (const [p, f] of Object.entries(files)) {
    if (task.hidden.includes(p)) continue;
    const old = task.items[p];
    if (old || importAll || (!task.ended && task.baseline[p] !== f.signature)) {
      task.items[p] = {
        ...old,
        ...f,
        contentHash: old?.signature === f.signature ? old?.contentHash : null,
        missing: false,
        unavailable: false,
        source: old?.source || (importAll ? "显式导入" : "目录发现"),
        changed:
          !!old?.delivered &&
          (old.deliveredSignature || old.signature) !== f.signature,
      };
    }
  }
  for (const [p, f] of Object.entries(task.items)) {
    if (files[p]) continue;
    const inaccessible = diagnostics.some(
      (e) =>
        e.code !== "ENOENT" &&
        (p === e.path || p.startsWith(e.path + path.sep)),
    );
    f.unavailable = inaccessible;
    f.missing = !inaccessible;
  }
  task.errors = diagnostics;
  return task;
}
