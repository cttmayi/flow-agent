// lib/config.js — 加载 .flow-agent/config.yaml
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function parseYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf(':');
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    let value = trimmed.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\d+$/.test(value)) value = Number(value);
    result[key] = value;
  }
  return result;
}

export async function loadConfig() {
  try {
    const yamlPath = join(process.cwd(), '.flow-agent', 'config.yaml');
    const text = await readFile(yamlPath, 'utf8');
    return parseYaml(text);
  } catch {
    return {};
  }
}