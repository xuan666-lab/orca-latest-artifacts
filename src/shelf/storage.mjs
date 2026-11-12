import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

// Orca limits one JSON value to 256 KiB, all values to 5 MiB and keys to 1,024.
// Leave room for protocol envelopes. Large values are compressed and published
// through one small commit record only after every immutable chunk is durable.
const PREFIX = 'latest-artifacts.chunk.v1.';
const INLINE_BYTES = 160 * 1024;
const CHUNK_BYTES = 96 * 1024;
const MARKER = 'latest-artifacts/gzip-chunks/v1';
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = value => value?.format === MARKER &&
  typeof value.generation === 'string' && /^[a-f0-9-]{36}$/.test(value.generation) &&
  Number.isInteger(value.count) && value.count > 0 && value.count <= 1020 &&
  Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= 64 * 1024 * 1024 &&
  /^[a-f0-9]{64}$/.test(value.sha256 || '');
const chunkKey = (key, value, index) => PREFIX + digest(key).slice(0, 24) + '.' + value.generation + '.' + index;

export function createChunkedStorage(raw) {
  const memoryCaches = new Map();
  const cacheKey = key => /^(session\.cursor\.v1\.|terminal\.history\.v1\.)/.test(key);
  // Serialize logical operations, including reads, so cleanup cannot race an
  // earlier read and two writers never replace the same commit concurrently.
  let chain = Promise.resolve();
  const serial = fn => {
    const result = chain.then(fn, fn);
    chain = result.catch(() => {});
    return result;
  };
  const checkKey = key => {
    if (typeof key !== 'string' || key.startsWith(PREFIX)) throw Error('Reserved storage key');
  };
  async function removeChunks(key, value) {
    if (!manifest(value)) return;
    for (let i = 0; i < value.count; i++)
      await raw.delete(chunkKey(key, value, i)).catch(() => {});
  }
  async function get(key) {
    checkKey(key);
    const value = await raw.get(key);
    if (!manifest(value)) return value;
    const chunks = [];
    for (let i = 0; i < value.count; i++) {
      const chunk = await raw.get(chunkKey(key, value, i));
      if (typeof chunk !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk))
        throw Error('Stored artifact data is missing or corrupt');
      chunks.push(Buffer.from(chunk, 'base64'));
    }
    const compressed = Buffer.concat(chunks);
    if (digest(compressed) !== value.sha256) throw Error('Stored artifact data is corrupt');
    let bytes;
    try { bytes = gunzipSync(compressed, { maxOutputLength: value.bytes }); }
    catch { throw Error('Stored artifact data is corrupt'); }
    if (bytes.length !== value.bytes) throw Error('Stored artifact data is corrupt');
    return JSON.parse(bytes.toString('utf8'));
  }
  async function set(key, value) {
    checkKey(key);
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw Error('Storage value must be JSON');
    const bytes = Buffer.from(serialized);
    const old = await raw.get(key);
    if (bytes.length <= INLINE_BYTES && value?.format !== MARKER) {
      await raw.set(key, JSON.parse(serialized));
      await removeChunks(key, old);
      return;
    }
    if (bytes.length > 64 * 1024 * 1024) throw Error('Artifact storage value exceeds 64 MiB');
    const compressed = gzipSync(bytes);
    const record = { format: MARKER, generation: randomUUID(), count: Math.ceil(compressed.length / CHUNK_BYTES), bytes: bytes.length, sha256: digest(compressed) };
    if (!manifest(record)) throw Error('Artifact storage value exceeds chunk limit');
    const written = [];
    try {
      for (let i = 0; i < record.count; i++) {
        const physicalKey = chunkKey(key, record, i);
        await raw.set(physicalKey, compressed.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64'));
        written.push(physicalKey);
      }
      await raw.set(key, record);
    } catch (error) {
      for (const physicalKey of written) await raw.delete(physicalKey).catch(() => {});
      throw error;
    }
    await removeChunks(key, old);
  }
  return {
    get: key => serial(() => get(key)),
    set: (key, value) => serial(() => set(key, value)),
    delete: key => serial(async () => {
      checkKey(key);
      const old = await raw.get(key);
      await raw.delete(key);
      memoryCaches.delete(key);
      await removeChunks(key, old);
    }),
    keys: () => serial(async () => (await raw.keys()).filter(key => !key.startsWith(PREFIX))),
    // These values contain only rebuildable evidence cursors, never user
    // hidden/delivery choices. A full host store must not blank the live list.
    getCache: key => serial(async () => {
      if (!cacheKey(key)) throw Error('Not a rebuildable artifact cache key');
      if (memoryCaches.has(key)) return structuredClone(memoryCaches.get(key));
      try { return await get(key); } catch { return null; }
    }),
    setCache: (key, value) => serial(async () => {
      if (!cacheKey(key)) throw Error('Not a rebuildable artifact cache key');
      memoryCaches.delete(key);
      memoryCaches.set(key, structuredClone(value));
      while (memoryCaches.size > 8) memoryCaches.delete(memoryCaches.keys().next().value);
      try { await set(key, value); return { persisted: true }; }
      catch { return { persisted: false }; }
    }),
  };
}
