import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inventory, reconcile, hash, safe } from "../../src/shelf/core.mjs";
test("baseline, import, add, overwrite, deletion, equal names, delivery, restart, symlink escape", async () => {
  const r = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-")),
  );
  try {
    await fs.writeFile(path.join(r, "old.html"), "old");
    const initial = await inventory([r]);
    let t = {
      roots: [r],
      baseline: Object.fromEntries(
        Object.entries(initial).map(([p, f]) => [p, f.signature]),
      ),
      items: {},
      hidden: [],
    };
    reconcile(t, initial);
    assert.equal(Object.keys(t.items).length, 0);
    reconcile(t, initial, true);
    assert.equal(Object.keys(t.items).length, 1);
    await fs.mkdir(path.join(r, "nested"));
    await fs.writeFile(path.join(r, "nested/old.html"), "nested");
    for (const ext of ["png", "pdf", "mp4"])
      await fs.writeFile(path.join(r, "new." + ext), "fixture");
    reconcile(t, await inventory([r]));
    assert.equal(Object.keys(t.items).length, 5);
    const p = path.join(r, "old.html");
    t.items[p].delivered = await hash(p);
    await fs.writeFile(p, "different content");
    reconcile(t, await inventory([r]));
    assert.equal(t.items[p].changed, true);
    t = JSON.parse(JSON.stringify(t));
    assert.ok(t.items[p].delivered);
    await fs.unlink(p);
    reconcile(t, await inventory([r]));
    assert.equal(t.items[p].missing, true);
    await fs.symlink("/etc", path.join(r, "escape"));
    assert.equal(Object.keys(await inventory([r])).length, 4);
    await assert.rejects(safe(path.join(r, "escape/hosts"), [r]));
    await fs.mkdir(path.join(r, "node_modules"));
    await fs.writeFile(path.join(r, "node_modules/skip.html"), "skip");
    assert.equal(Object.keys(await inventory([r])).length, 4);
  } finally {
    await fs.rm(r, { recursive: true, force: true });
  }
});

test("directory permission errors preserve known records as unavailable and scanning stays bounded", async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "shelf-permissions-")),
  );
  const blocked = path.join(root, "blocked");
  try {
    await fs.mkdir(blocked);
    await fs.writeFile(path.join(blocked, "old.html"), "old");
    await fs.writeFile(path.join(root, "good.html"), "good");
    const files = await inventory([root]);
    const task = { roots: [root], baseline: {}, items: {}, hidden: [] };
    reconcile(task, files, true);
    await fs.chmod(blocked, 0);
    const errors = [];
    const accessible = await inventory([root], errors);
    reconcile(task, accessible, false, errors);
    assert.ok(accessible[path.join(root, "good.html")]);
    assert.ok(errors.some((e) => e.code === "EACCES"));
    assert.equal(task.items[path.join(blocked, "old.html")].unavailable, true);
    assert.equal(task.items[path.join(blocked, "old.html")].missing, false);
    await fs.chmod(blocked, 0o700);
    const limited = [];
    await inventory([root], limited, 1);
    assert.ok(limited.some((e) => e.code === "LIMIT"));
  } finally {
    await fs.chmod(blocked, 0o700).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
