import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createCheckpoint } from '../lib/api/checkpoint.js';
import { getCache } from '../lib/cache.js';

describe('checkpoint API', () => {
  before(() => {
    getCache().clear();
  });

  it('returns undefined when key does not exist', async () => {
    const cp = createCheckpoint();
    const result = await cp('nonexistent');
    assert.strictEqual(result, undefined);
  });

  it('stores and retrieves a value', async () => {
    const cp = createCheckpoint();
    const written = await cp('mykey', { data: 'hello' });
    assert.deepStrictEqual(written, { data: 'hello' });
    const read = await cp('mykey');
    assert.deepStrictEqual(read, { data: 'hello' });
  });

  it('overwrites existing key', async () => {
    const cp = createCheckpoint();
    await cp('overwrite', 'old');
    await cp('overwrite', 'new');
    const val = await cp('overwrite');
    assert.strictEqual(val, 'new');
  });
});