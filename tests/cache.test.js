import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { getCache } from '../lib/cache.js';

describe('Cache', () => {
  beforeEach(() => {
    getCache().clear();
  });

  it('has() returns false for missing key', () => {
    const cache = getCache();
    assert.strictEqual(cache.has('unknown'), false);
  });

  it('set() then get() returns stored value', () => {
    const cache = getCache();
    cache.set('key1', { foo: 'bar' });
    assert.deepStrictEqual(cache.get('key1'), { foo: 'bar' });
  });

  it('get() returns undefined for missing key', () => {
    const cache = getCache();
    assert.strictEqual(cache.get('missing'), undefined);
  });

  it('clear() removes all entries', () => {
    const cache = getCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.strictEqual(cache.has('a'), false);
    assert.strictEqual(cache.has('b'), false);
  });

  it('getCache() returns the same singleton instance', () => {
    assert.strictEqual(getCache(), getCache());
  });

  it('keys() returns all stored keys', () => {
    const cache = getCache();
    cache.set('x', 1);
    cache.set('y', 2);
    assert.deepStrictEqual(cache.keys(), ['x', 'y']);
  });
});