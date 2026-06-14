import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSandbox } from '../lib/sandbox.js';

describe('Sandbox', () => {
  it('exposes injected APIs', async () => {
    const apis = {
      agent: async () => 'mock-agent',
      parallel: async () => ['mock-parallel'],
      phase: () => {},
      checkpoint: async () => {}
    };
    const result = await createSandbox(`return await agent('test');`, apis);
    assert.strictEqual(result, 'mock-agent');
  });

  it('does not expose require without workflowDir', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`return typeof require;`, apis);
    assert.strictEqual(result, 'undefined');
  });

  it('exposes require when workflowDir is provided', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`return typeof require;`, apis, 60000, '/tmp');
    assert.strictEqual(result, 'function');
  });

  it('does not expose process', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`return typeof process;`, apis);
    assert.strictEqual(result, 'undefined');
  });

  it('executes basic JS operations', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`const x = 1 + 2; return x * 3;`, apis);
    assert.strictEqual(result, 9);
  });

  it('exposes fs and path modules', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: () => {} };
    const result = await createSandbox(`return typeof fs + '|' + typeof path;`, apis);
    assert.strictEqual(result, 'object|object');
  });

  it('supports async/await in sandbox code', async () => {
    const apis = {
      agent: async () => 'async-result',
      parallel: async () => [], phase: () => {}, checkpoint: async () => {}
    };
    const result = await createSandbox(`const val = await agent('test'); return val;`, apis);
    assert.strictEqual(result, 'async-result');
  });

  it('exposes setTimeout and clearTimeout', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`
      return new Promise(resolve => {
        setTimeout(() => resolve('timed'), 10);
      });
    `, apis);
    assert.strictEqual(result, 'timed');
  });

  it('exposes sleep function', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {}, tool: async () => {} };
    const start = Date.now();
    await createSandbox(`await sleep(50);`, apis);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `sleep(50) took ${elapsed}ms`);
  });

  it('exposes tool function that executes via registry', async () => {
    let capturedName, capturedParams;
    const mockTool = async (name, params) => {
      capturedName = name;
      capturedParams = params;
      return 'mock-result';
    };
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {}, tool: mockTool };
    const result = await createSandbox(`return await tool('bash', { command: 'ls' });`, apis);
    assert.strictEqual(result, 'mock-result');
    assert.strictEqual(capturedName, 'bash');
    assert.strictEqual(capturedParams.command, 'ls');
  });
});