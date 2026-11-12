import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inventory } from "../../src/shelf/core.mjs";
import {
  createThumbnailCache,
  renderThumbnail,
  startPreviewServer,
} from "../../src/shelf/thumbnails.mjs";

const fixtureRoot = path.resolve(import.meta.dirname, "../fixtures");
test("real image, PDF, video and isolated HTML render scaled JPEGs", async () => {
  for (const [name, kind] of [
    ["image.png", "图片"],
    ["report.pdf", "PDF"],
    ["video.mp4", "视频"],
    ["report.html", "HTML"],
    ["session-note.md", "Markdown"],
  ]) {
    const result = await renderThumbnail(
      path.join(fixtureRoot, name),
      fixtureRoot,
      kind,
    );
    assert.ok(result.startsWith("data:image/jpeg;base64,"));
    const bytes = Buffer.from(result.split(",")[1], "base64");
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.ok(bytes.length < 192 * 1024);
  }
});

test("thumbnail cache deduplicates, persists, invalidates and limits concurrent renders", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-cache-")),
  );
  const values = new Map();
  const storage = {
    get: async (k) => values.get(k),
    set: async (k, v) => values.set(k, v),
    delete: async (k) => values.delete(k),
  };
  let renders = 0,
    active = 0,
    max = 0;
  const render = async () => {
    renders++;
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return "data:image/jpeg;base64,/9j/";
  };
  let cache = createThumbnailCache(storage, { render });
  try {
    for (let i = 0; i < 5; i++)
      await fs.writeFile(path.join(root, i + ".png"), "image");
    let files = Object.values(await inventory([root]));
    await Promise.all(
      [...files, files[0], files[0]].map((f) =>
        cache.get(f, [root], f.signature),
      ),
    );
    assert.equal(renders, 5);
    assert.equal(max, 2);
    cache.dispose();
    cache = createThumbnailCache(storage, { render });
    await cache.get(files[0], [root], files[0].signature);
    assert.equal(renders, 5);
    await fs.writeFile(files[0].path, "changed");
    assert.equal(
      (await cache.get(files[0], [root], files[0].signature)).preview,
      null,
    );
    files = Object.values(await inventory([root]));
    await cache.get(files[0], [root], files[0].signature);
    assert.equal(renders, 6);
  } finally {
    cache.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("HTML preview server enforces token, scope, symlink and script/network CSP", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-html-")),
  );
  let server;
  try {
    const p = path.join(root, "中文 空格.html");
    await fs.writeFile(
      p,
      '<h1>static</h1><script>document.body.innerHTML="EXECUTED"</script>',
    );
    await fs.symlink("/etc/hosts", path.join(root, "escape.css"));
    server = await startPreviewServer(p, root);
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy"),
      /script-src 'none'/,
    );
    assert.match(
      response.headers.get("content-security-policy"),
      /connect-src 'none'/,
    );
    assert.equal((await fetch(new URL("escape.css", server.url))).status, 403);
    assert.equal((await fetch(new URL("/bad/file", server.url))).status, 403);
    assert.equal(
      (await fetch(new URL("..%2F..%2Fetc%2Fhosts", server.url))).status,
      403,
    );
  } finally {
    await server?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
