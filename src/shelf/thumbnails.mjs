import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { safe, signature } from "./core.mjs";
import { thumbnailTools, thumbnailFailure } from "./runtime-support.mjs";

const exec = promisify(execFile);
// Base64 and the reply envelope must fit the host's 256 KiB JSON budget.
const MAX_THUMB_BYTES = 180 * 1024;
const MAX_PREVIEW_STRING_BYTES = 248 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const CSP =
  "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-same-origin";

/** Local, token-bound, read-only resource server for one explicit thumbnail job. */
export async function startPreviewServer(file, root) {
  const token = randomBytes(24).toString("hex");
  let requests = 0,
    bytes = 0;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "GET" || ++requests > 100)
        throw Error("request budget");
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.startsWith("/" + token + "/")) throw Error("token");
      const relative = decodeURIComponent(url.pathname.slice(token.length + 2));
      const target = path.resolve(root, relative);
      await safe(target, [root]);
      if (
        relative
          .split(/[\\/]/)
          .some(
            (part) =>
              part.startsWith(".") ||
              ["node_modules", "warehouse", "cache"].includes(part),
          )
      )
        throw Error("excluded");
      const extension = path.extname(target).toLowerCase();
      if (
        !MIME[extension] ||
        ((extension === ".html" || extension === ".htm") && target !== file)
      )
        throw Error("unsupported resource");
      const stat = await fs.stat(target);
      const limit =
        extension === ".html" || extension === ".css"
          ? 2 * 1024 * 1024
          : 8 * 1024 * 1024;
      if (stat.size > limit || bytes + stat.size > 32 * 1024 * 1024)
        throw Error("resource budget");
      const handle = await fs.open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let content;
      try {
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (
          signature(stat) !== signature(await handle.stat()) ||
          bytesRead !== stat.size
        )
          throw Error("resource changed");
        await safe(target, [root]);
        content = buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      bytes += content.length;
      res.writeHead(200, {
        "Content-Type": MIME[extension],
        "Content-Security-Policy": CSP,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
    } catch {
      res.writeHead(403, {
        "Content-Type": "text/plain",
        "Content-Security-Policy": CSP,
      });
      res.end("Resource outside preview scope or unavailable");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/${token}/${path.relative(root, file).split(path.sep).map(encodeURIComponent).join("/")}`;
  return {
    url,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function command(binary, args, timeout = 15000) {
  return exec(binary, args, {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
}

async function videoFrame(file, output, tools) {
  const { stdout } = await command(tools.ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const duration = Number(JSON.parse(stdout).format?.duration) || 1;
  // Sample a short interval after the start, then select a representative frame.
  const start = Math.min(duration * 0.15, 2);
  await command(tools.ffmpeg, [
    "-v",
    "error",
    "-ss",
    String(start),
    "-i",
    file,
    "-an",
    "-vf",
    "fps=4,scale=480:320:force_original_aspect_ratio=decrease,thumbnail=8",
    "-frames:v",
    "1",
    "-y",
    output,
  ]);
  if (!(await fs.stat(output).catch(() => null))?.size) {
    await command(tools.ffmpeg, [
      "-v",
      "error",
      "-ss",
      "0",
      "-i",
      file,
      "-an",
      "-vf",
      "scale=480:320:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-y",
      output,
    ]);
  }
}

export async function renderThumbnail(file, root, kind, options = {}) {
  await safe(file, [root]);
  const tools = await thumbnailTools(kind, options.runtime);
  const before = await fs.stat(file);
  if (kind === "图片" && before.size > 64 * 1024 * 1024)
    throw Error("图片超过 64 MiB 预览限制");
  if (["HTML", "Markdown"].includes(kind) && before.size > 2 * 1024 * 1024)
    throw Error("HTML 超过 2 MiB 预览限制");
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "artifact-thumbnail-")),
  );
  await fs.chmod(directory, 0o700);
  const raw = path.join(directory, "raw.png"),
    output = path.join(directory, "thumb.jpg");
  let preview;
  try {
    if (kind === "图片") {
      await command(tools.sips, [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "65",
        "-Z",
        "480",
        file,
        "--out",
        output,
      ]);
    } else {
      if (kind === "PDF") {
        await command(tools.pdftoppm, [
          "-f",
          "1",
          "-singlefile",
          "-scale-to",
          "480",
          "-png",
          file,
          path.join(directory, "raw"),
        ]);
      } else if (kind === "视频") {
        await videoFrame(file, raw, tools);
      } else if (kind === "HTML" || kind === "Markdown") {
        if (kind === "Markdown") {
          const text = (await fs.readFile(file, "utf8"))
            .slice(0, 65536)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
          const document = path.join(directory, "markdown.html");
          await fs.writeFile(
            document,
            '<!doctype html><meta charset="utf-8"><style>body{margin:32px;color:#20242b;background:#fff;font:17px/1.65 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><pre>' +
              text +
              "</pre>",
            { mode: 0o600 },
          );
          preview = await startPreviewServer(document, directory);
        } else preview = await startPreviewServer(file, root);
        await command(
          tools.chrome,
          [
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-networking",
            "--disable-sync",
            "--disable-extensions",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-features=Translate,MediaRouter,OptimizationHints",
            "--metrics-recording-only",
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
            "--hide-scrollbars",
            "--window-size=960,640",
            "--force-device-scale-factor=1",
            "--virtual-time-budget=1200",
            "--user-data-dir=" + path.join(directory, "profile"),
            "--screenshot=" + raw,
            preview.url,
          ],
          15000,
        );
      } else throw Error("不支持的缩略图类型");
      await command(tools.sips, [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "65",
        "-Z",
        "480",
        raw,
        "--out",
        output,
      ]);
    }
    await safe(file, [root]);
    if (signature(before) !== signature(await fs.stat(file)))
      throw Error("源文件写入中，请稍后重试");
    const content = await fs.readFile(output);
    if (content.length > MAX_THUMB_BYTES) throw Error("缩略图超过大小限制");
    return "data:image/jpeg;base64," + content.toString("base64");
  } finally {
    await preview?.close();
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

/** Two bounded render slots; unchanged previews hit private persistent storage. */
export function createThumbnailCache(storage, options = {}) {
  const memory = new Map(),
    inflight = new Map(),
    waiting = [];
  let active = 0,
    disposed = false,
    indexQueue = Promise.resolve();
  const render = options.render || renderThumbnail;
  function pump() {
    while (!disposed && active < 2 && waiting.length) {
      const job = waiting.shift();
      active++;
      job
        .run()
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }
  async function persist(key, value) {
    // Optional cache: keep its share of the host's 5 MiB store bounded. This
    // queue covers eviction and commit together, and recovers after any failure.
    const next = indexQueue.then(async () => {
      const keys = (await storage.get("thumbnail.keys.v1")) || [];
      const entries = [];
      let bytes = Buffer.byteLength(JSON.stringify(value));
      if (bytes > 1024 * 1024) return;
      for (const old of [...new Set(Array.isArray(keys) ? keys : [])]) {
        if (old === key || !/^thumbnail\.v1\.[a-f0-9]{64}$/.test(old)) continue;
        const cached = await storage.get(old).catch(() => null);
        if (typeof cached !== "string") continue;
        const size = Buffer.byteLength(JSON.stringify(cached));
        entries.push({ key: old, size });
        bytes += size;
      }
      while (entries.length >= 48 || bytes > 1024 * 1024) {
        const old = entries.shift();
        if (!old) break;
        bytes -= old.size;
        await storage.delete(old.key);
      }
      await storage.set(key, value);
      try {
        await storage.set("thumbnail.keys.v1", [...entries.map(e => e.key), key]);
      } catch (error) {
        // A failed index commit must not accumulate untracked thumbnail blobs.
        await storage.delete(key).catch(() => {});
        throw error;
      }
    });
    indexQueue = next.catch(() => {});
    // A thumbnail can be displayed even when the private store is full/offline.
    await indexQueue;
  }
  async function get(file, roots, expectedSignature) {
    if (disposed) return { preview: null, reason: "预览器已关闭" };
    await safe(file.path, roots);
    const stat = await fs.stat(file.path);
    if (file.kind === "图片" && stat.size > 64 * 1024 * 1024)
      return { preview: null, reason: "图片超过 64 MiB 预览限制" };
    const current = signature(stat);
    if (expectedSignature && expectedSignature !== current)
      return { preview: null, reason: "文件已更新，等待核对" };
    const key =
      "thumbnail.v1." +
      createHash("sha256")
        .update(file.path + "\0" + current)
        .digest("hex");
    if (memory.has(key)) return { preview: memory.get(key) };
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      const cached = await storage.get(key).catch(() => null);
      if (
        typeof cached === "string" &&
        cached.startsWith("data:image/jpeg;base64,") &&
        Buffer.byteLength(cached) <= MAX_PREVIEW_STRING_BYTES
      ) {
        memory.set(key, cached);
        return { preview: cached };
      }
      if (waiting.length >= 32)
        return { preview: null, reason: "预览队列繁忙，请重试" };
      const data = await new Promise((resolve, reject) => {
        waiting.push({
          resolve,
          reject,
          run: () => render(file.path, file.root, file.kind),
        });
        pump();
      });
      if (disposed) return { preview: null, reason: "预览器已关闭" };
      if (typeof data !== "string" || Buffer.byteLength(data) > MAX_PREVIEW_STRING_BYTES)
        throw Error("缩略图超过大小限制");
      memory.set(key, data);
      while (memory.size > 24) memory.delete(memory.keys().next().value);
      await persist(key, data);
      return { preview: data };
    })()
      .catch((e) => ({ preview: null, reason: thumbnailFailure(e, options.getLocale?.() || options.locale) }))
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }
  return {
    get,
    dispose() {
      disposed = true;
      memory.clear();
      while (waiting.length) waiting.shift().resolve(null);
    },
  };
}
