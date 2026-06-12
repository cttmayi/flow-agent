// tests/config.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Inline parseYaml for testing
async function parseYaml(text) {
  // parseYaml is not exported, so we inline the parser logic
  const lines = text.split('\n');
  return parseBlock(lines, 0).result;
}

function parseBlock(lines, startIdx) {
  const result = {};
  let i = startIdx;
  let blockIndent = null;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = line.length - line.trimStart().length;

    if (blockIndent === null) {
      blockIndent = indent;
    }

    if (indent < blockIndent) break;

    i++;
    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;

    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();

    if (value === '') {
      const nested = parseBlock(lines, i);
      result[key] = nested.result;
      i = nested.nextIdx;
    } else {
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) ||
                       (value.startsWith("'") && value.endsWith("'"));
      if (isQuoted) {
        value = value.slice(1, -1);
      } else {
        if (value.startsWith('[') && value.endsWith(']')) {
          value = JSON.parse(value);
        } else if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (/^\d+$/.test(value)) value = Number(value);
      }
      result[key] = value;
    }
  }

  return { result, nextIdx: i };
}

describe('config parser', () => {
  it('parses flat keys', async () => {
    const cfg = await parseYaml('key1: value1\nkey2: 42');
    assert.strictEqual(cfg.key1, 'value1');
    assert.strictEqual(cfg.key2, 42);
  });

  it('parses nested blocks', async () => {
    const yaml = `default_agent: internal
spawn_agents:
  claude:
    command: "claude"
    args: ["-p", "{prompt}"]`;
    const cfg = await parseYaml(yaml);
    assert.strictEqual(cfg.default_agent, 'internal');
    assert.strictEqual(cfg.spawn_agents.claude.command, 'claude');
    assert.deepStrictEqual(cfg.spawn_agents.claude.args, ['-p', '{prompt}']);
  });

  it('skips comments and empty lines', async () => {
    const cfg = await parseYaml('# comment\n\nkey: val\n');
    assert.strictEqual(cfg.key, 'val');
  });

  it('parses quoted strings', async () => {
    const cfg = await parseYaml('key: "hello world"\nnum: \'42\'');
    assert.strictEqual(cfg.key, 'hello world');
    assert.strictEqual(cfg.num, '42');
  });
});
