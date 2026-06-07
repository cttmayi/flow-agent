import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../lib/tools/registry.js';

describe('ToolRegistry', () => {
  let registry;

  before(() => {
    registry = new ToolRegistry();
  });

  it('register and get a tool', () => {
    registry.register({
      name: 'echo',
      description: 'Echo input back',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      async execute(args) { return args.text; }
    });
    const tool = registry.get('echo');
    assert.strictEqual(tool.name, 'echo');
  });

  it('get() returns undefined for unknown tool', () => {
    assert.strictEqual(registry.get('nope'), undefined);
  });

  it('list() returns all registered tools', () => {
    const tools = registry.list();
    assert.ok(tools.length >= 1);
    assert.ok(tools.some(t => t.name === 'echo'));
  });

  it('toAnthropicTools() converts to Anthropic SDK format', () => {
    const anthropicTools = registry.toAnthropicTools(['echo']);
    assert.strictEqual(anthropicTools.length, 1);
    assert.strictEqual(anthropicTools[0].name, 'echo');
    assert.strictEqual(anthropicTools[0].input_schema.type, 'object');
  });

  it('execute() calls the tool handler and returns result', async () => {
    const result = await registry.execute('echo', { text: 'hello' });
    assert.strictEqual(result, 'hello');
  });

  it('execute() throws for unknown tool', async () => {
    await assert.rejects(
      () => registry.execute('unknown', {}),
      /Unknown tool: unknown/
    );
  });

  it('toAnthropicTools() throws for unknown tool', () => {
    assert.throws(
      () => registry.toAnthropicTools(['nonexistent']),
      /Unknown tool: nonexistent/
    );
  });
});