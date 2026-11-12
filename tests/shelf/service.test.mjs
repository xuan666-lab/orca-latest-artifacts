import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createShelf } from "../../src/shelf/service.mjs";
import { deliver, inventory, validateRoots } from "../../src/shelf/core.mjs";

test("worker state, stable delivery race, ended reconciliation, restore, missing root, preview no writes", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-worker-")),
  );
  let stored = null,
    writes = 0;
  const posts = [];
  const host = {
    storage: {
      get: async () => structuredClone(stored),
      set: async (k, v) => {
        stored = structuredClone(v);
        writes++;
      },
    },
    panels: { post: (...args) => posts.push(args) },
    log: () => {},
  };
  let shelf = createShelf(host, { stableMs: 1, open: async () => {} });
  try {
    const p = path.join(root, "report.html");
    await fs.writeFile(p, "baseline");
    await shelf.action({ action: "start", name: "test", roots: root });
    assert.equal(Object.keys(stored.tasks[0].items).length, 0);
    await shelf.action({ action: "import" });
    await fs.writeFile(p, "changed before delivery without scan");
    const cardContext = await shelf.action();
    await shelf.action({ action: "deliver", path: p, taskId: cardContext.active, revision: cardContext.revision });
    const delivered = stored.tasks[0].items[p].delivered;
    await shelf.action({ action: "refresh" });
    assert.equal(stored.tasks[0].items[p].changed, false);
    const f = stored.tasks[0].items[p];
    await assert.rejects(
      deliver(f, [root], async () => {
        await fs.writeFile(p, "racing write");
        return "fake";
      }),
      /仍在写入/,
    );
    assert.equal(f.delivered, delivered);
    await shelf.action({ action: "refresh" });
    assert.equal(stored.tasks[0].items[p].changed, true);
    await shelf.action({ action: "end" });
    await fs.writeFile(path.join(root, "new.pdf"), "pdf");
    await fs.unlink(p);
    await shelf.action({ action: "refresh" });
    assert.equal(stored.tasks[0].items[p].missing, true);
    assert.equal(Object.keys(stored.tasks[0].items).length, 1);
    await shelf.action({ action: "import" });
    assert.equal(Object.keys(stored.tasks[0].items).length, 2);
    shelf.dispose();
    shelf = createShelf(host, { stableMs: 1 });
    const restored = await shelf.action();
    assert.equal(restored.tasks[0].items[p].delivered, delivered);
    const before = writes;
    await shelf.action();
    await shelf.action({ action: "preview", path: p });
    assert.equal(writes, before);
    await fs.rm(root, { recursive: true });
    await shelf.action({ action: "refresh" });
    assert.ok(stored.tasks[0].errors.length);
    assert.equal(
      stored.tasks[0].items[path.join(root, "new.pdf")].missing,
      true,
    );
    assert.ok(posts.length);
  } finally {
    shelf.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("invalid root and sibling failure remain bounded", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-errors-")),
  );
  try {
    const p = path.join(root, "file.html");
    await fs.writeFile(p, "ok");
    await assert.rejects(validateRoots([p]));
    const errors = [];
    const files = await inventory([root, path.join(root, "missing")], errors);
    assert.ok(files[p]);
    assert.equal(errors.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("preview uses fresh size, rejects switched task, and never persists read operations", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-preview-")),
  );
  let stored = null,
    writes = 0;
  const other = new Map();
  const host = {
    storage: {
      get: async (k) => (k === "shelf" ? stored : other.get(k)),
      set: async (k, v) => {
        if (k === "shelf") {
          stored = structuredClone(v);
          writes++;
        } else other.set(k, v);
      },
      delete: async (k) => other.delete(k),
    },
    panels: { post: () => {} },
    log: () => {},
  };
  const shelf = createShelf(host, { stableMs: 1 });
  try {
    const p = path.join(root, "image.png");
    await fs.copyFile(
      path.resolve(import.meta.dirname, "../fixtures/image.png"),
      p,
    );
    await shelf.action({ action: "start", name: "test", roots: root });
    await shelf.action({ action: "import" });
    const taskId = stored.active,
      before = writes;
    assert.ok(
      (await shelf.action({ action: "preview", path: p, taskId })).preview,
    );
    assert.equal(writes, before);
    await fs.truncate(p, 65 * 1024 * 1024);
    assert.equal(
      (await shelf.action({ action: "preview", path: p, taskId })).preview,
      null,
    );
    assert.equal(
      (await shelf.action({ action: "preview", path: p, taskId: "other" }))
        .preview,
      null,
    );
  } finally {
    shelf.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
