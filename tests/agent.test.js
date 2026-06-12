// tests/agent.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createAgent } from '../lib/api/agent.js';
import { createSpawnAgent } from '../lib/api/agent-spawn.js';

describe('agent factory', () => {
  it('should return internal agent by default', () => {
    const registry = { toAnthropicTools: () => [], execute: async () => '' };
    const agent = createAgent(registry, { defaultAgent: 'internal' });
    assert.ok(typeof agent === 'function');
  });

  it('should throw for unknown agent type', () => {
    const registry = { toAnthropicTools: () => [], execute: async () => '' };
    assert.throws(
      () => createAgent(registry, { defaultAgent: 'nonexistent' }),
      /Unknown agent type/
    );
  });

  it('should create built-in spawn agent by name', () => {
    const registry = { toAnthropicTools: () => [], execute: async () => '' };
    const agent = createAgent(registry, { defaultAgent: 'claude' });
    assert.ok(typeof agent === 'function');
  });
});

describe('spawn agent provider', () => {
  it('should execute command and return stdout', async () => {
    const agent = createSpawnAgent({ command: 'echo', args: ['hello world'] });
    const result = await agent('ignored');
    assert.strictEqual(result, 'hello world');
  });

  it('should substitute {prompt} in args', async () => {
    const agent = createSpawnAgent({ command: 'echo', args: ['prefix-{prompt}-suffix'] });
    const result = await agent('test');
    assert.strictEqual(result, 'prefix-test-suffix');
  });

  it('should substitute {tools} with mapped names', async () => {
    const agent = createSpawnAgent({
      command: 'echo',
      args: ['{tools}'],
      tool_mapping: { bash: 'Bash', read: 'Read' },
    });
    const result = await agent('prompt', { tools: ['bash', 'read'] });
    assert.strictEqual(result, 'Bash,Read');
  });

  it('should keep unmapped tool names as-is', async () => {
    const agent = createSpawnAgent({
      command: 'echo',
      args: ['{tools}'],
      tool_mapping: { bash: 'Bash' },
    });
    const result = await agent('prompt', { tools: ['bash', 'edit'] });
    assert.strictEqual(result, 'Bash,edit');
  });

  it('should remove flag-value pair when tools empty', async () => {
    const agent = createSpawnAgent({
      command: 'echo',
      args: ['-p', '{prompt}', '--tools', '{tools}'],
    });
    const result = await agent('hello');
    // Should be just: echo -p hello (no --tools)
    assert.strictEqual(result, '-p hello');
  });

  it('should include flag-value pair when tools provided', async () => {
    const agent = createSpawnAgent({
      command: 'echo',
      args: ['-p', '{prompt}', '--tools', '{tools}'],
      tool_mapping: { bash: 'Bash' },
    });
    const result = await agent('hello', { tools: ['bash'] });
    assert.strictEqual(result, '-p hello --tools Bash');
  });

  it('should reject on non-zero exit code', async () => {
    const agent = createSpawnAgent({ command: 'false', args: [] });
    await assert.rejects(
      () => agent('test'),
      /退出码/
    );
  });

  it('should throw if command is missing', () => {
    assert.throws(
      () => createSpawnAgent({}),
      /missing required "command"/
    );
  });
});
