// tests/logger.test.js
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { logger } from '../lib/logger.js';

describe('logger', () => {
  it('phase() outputs formatted phase message', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    logger.phase('依赖分析');
    assert.ok(logs[0].includes('依赖分析'));
    assert.ok(logs[0].includes('阶段'));
    mock.restoreAll();
  });

  it('info() outputs prefixed message', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    logger.info('test message');
    assert.ok(logs[0].includes('[info]'));
    mock.restoreAll();
  });
});