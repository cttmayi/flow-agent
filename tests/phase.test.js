// tests/phase.test.js
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createPhase } from '../lib/api/phase.js';

describe('phase API', () => {
  it('outputs formatted phase name', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    const phase = createPhase();
    phase('依赖分析');
    assert.strictEqual(logs[0], '=== 阶段：依赖分析 ===');
    mock.restoreAll();
  });
});