import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createChunkedStorage } from '../../src/shelf/storage.mjs';

function host() {
  const values = new Map();
  let failure = null;
  return {
    values,
    fail: fn => { failure = fn; },
    async get(k) { return structuredClone(values.get(k) ?? null); },
    async set(k,v) {
      assert.ok(k.length <= 256);
      assert.ok(Buffer.byteLength(JSON.stringify(v)) <= 256 * 1024);
      if (failure?.(k,v)) throw Error('injected write failure');
      values.set(k,structuredClone(v));
    },
    async delete(k) { values.delete(k); },
    async keys() { return [...values.keys()]; },
  };
}

test('large Unicode state and incompressible data survive bounded host writes and a worker restart', async()=>{
  const raw=host(), storage=createChunkedStorage(raw);
  const value={text:'汉字🙂\n"\\'.repeat(50000), random:randomBytes(400000).toString('base64')};
  await storage.set('session.cursor.v1.A', value);
  assert.ok(raw.values.size>2);
  assert.deepEqual(await createChunkedStorage(raw).get('session.cursor.v1.A'),value);
  assert.deepEqual(await storage.keys(),['session.cursor.v1.A']);
});

test('failed chunk and commit writes keep previous value and remove staged chunks',async()=>{
  const raw=host(),storage=createChunkedStorage(raw),old={text:randomBytes(300000).toString('base64')};
  await storage.set('state',old);
  const before=new Map(raw.values);
  let writes=0;
  raw.fail(k=>k!=='state'&&++writes===2);
  await assert.rejects(storage.set('state',{text:randomBytes(500000).toString('base64')}),/injected/);
  assert.deepEqual(await storage.get('state'),old);
  assert.deepEqual(raw.values,before);
  raw.fail(k=>k==='state');
  await assert.rejects(storage.set('state',{text:'new'.repeat(100000)}),/injected/);
  assert.deepEqual(await storage.get('state'),old);
  assert.deepEqual(raw.values,before);
  raw.fail(null);
  await storage.set('state',{small:true});
  assert.deepEqual(await storage.get('state'),{small:true});
  assert.deepEqual([...raw.values.keys()],['state']);
});

test('legacy values remain readable, concurrent same-key operations serialize, delete removes chunks',async()=>{
  const raw=host(); await raw.set('old',{legacy:true});
  const storage=createChunkedStorage(raw);
  assert.deepEqual(await storage.get('old'),{legacy:true});
  await Promise.all([storage.set('new',{text:'first'.repeat(100000)}),storage.set('new',{text:'last'.repeat(100000)})]);
  assert.equal((await storage.get('new')).text,'last'.repeat(100000));
  await storage.delete('new');
  assert.deepEqual(await storage.keys(),['old']);
  assert.deepEqual([...raw.values.keys()],['old']);
});

test('a missing or altered chunk fails explicitly instead of returning partial data',async()=>{
  const raw=host(),storage=createChunkedStorage(raw);
  await storage.set('state',{text:'汉字'.repeat(100000)});
  const chunk=[...raw.values.keys()].find(k=>k!=='state');
  raw.values.set(chunk,'broken');
  await assert.rejects(createChunkedStorage(raw).get('state'),/corrupt|missing/i);
});

test('derived caches keep working in memory when the host total quota is exhausted; user writes fail explicitly',async()=>{
  const raw=host(), storage=createChunkedStorage(raw);
  raw.fail(()=>true);
  const value={text:'full index'.repeat(50000)};
  assert.equal((await storage.setCache('session.cursor.v1.A',value)).persisted,false);
  assert.deepEqual(await storage.getCache('session.cursor.v1.A'),value);
  await assert.rejects(storage.set('shelf',{hidden:['keep']}),/injected/);
});
