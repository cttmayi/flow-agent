// tests/parallel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createParallel } from '../lib/api/parallel.js';

describe('parallel API', () => {
  it('executes all tasks and returns results in order', async () => {
    const parallel = createParallel();
    const results = await parallel([
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ]);
    assert.deepStrictEqual(results, ['a', 'b', 'c']);
  });

  it('respects concurrency limit', async () => {
    const parallel = createParallel();
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => () =>
      new Promise(resolve => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        setTimeout(() => { concurrent--; resolve(i); }, 50);
      })
    );
    const results = await parallel(tasks, { concurrency: 3 });
    assert.strictEqual(maxConcurrent <= 3, true, `max concurrent was ${maxConcurrent}`);
    assert.deepStrictEqual(results, [0,1,2,3,4,5,6,7,8,9]);
  });

  it('failFast=true throws on first error', async () => {
    const parallel = createParallel();
    try {
      await parallel([
        () => Promise.reject(new Error('task1 failed')),
        () => new Promise(resolve => setTimeout(() => resolve(2), 100)),
      ], { failFast: true, concurrency: 5 });
      assert.fail('should have thrown');
    } catch (e) {
      assert.strictEqual(e.message, 'task1 failed');
    }
  });

  it('failFast=false collects all results including errors', async () => {
    const parallel = createParallel();
    const results = await parallel([
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('ok2'),
    ], { failFast: false });
    assert.strictEqual(results[0], 'ok');
    assert.ok(results[1] instanceof Error);
    assert.strictEqual(results[2], 'ok2');
  });
});