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

  it('does not expose require', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    const result = await createSandbox(`return typeof require;`, apis);
    assert.strictEqual(result, 'undefined');
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

  it('does not expose fs or path (must use agent tools)', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: () => {} };
    const result = await createSandbox(`return typeof fs + '|' + typeof path;`, apis);
    assert.strictEqual(result, 'undefined|undefined');
  });

  it('supports async/await in sandbox code', async () => {
    const apis = {
      agent: async () => 'async-result',
      parallel: async () => [], phase: () => {}, checkpoint: async () => {}
    };
    const result = await createSandbox(`const val = await agent('test'); return val;`, apis);
    assert.strictEqual(result, 'async-result');
  });
});