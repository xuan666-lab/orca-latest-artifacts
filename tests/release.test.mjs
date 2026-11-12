import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
test('public package exposes only the artifact shelf and documents its supported release', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root,'orca-plugin.json'),'utf8'));
  assert.equal(manifest.repository, 'https://github.com/xuan666-lab/orca-latest-artifacts');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.contributes.customEditors?.length || 0, 0);
  assert.equal(manifest.capabilities.some(c => c.kind === 'terminal:send'), false);
  const worker = await fs.readFile(path.join(root, manifest.main),'utf8');
  assert.doesNotMatch(worker, /createWorkbench|annotation/);
  assert.match(worker, /createChunkedStorage/);
  for (const retired of ['src/annotation','src/workbench.mjs','migrate.mjs','two-tabs-initial.png','IMPLEMENTATION_REPORT.md','INTEGRATION_PLAN.md'])
    await assert.rejects(fs.stat(path.join(root,retired)), {code:'ENOENT'});
  for (const required of ['LICENSE','PRIVACY.md','COMPATIBILITY.md','README.zh-CN.md'])
    assert.ok((await fs.stat(path.join(root,required))).size > 0);
});
