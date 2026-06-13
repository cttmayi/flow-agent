// lib/config.js — 加载双层配置：全局 ~/.flow-agent/config.yaml 和项目 ./.flow-agent/config.yaml
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function parseYaml(text) {
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

export async function loadConfig() {
  // 全局配置
  let globalConfig = {};
  try {
    const globalPath = join(homedir(), '.flow-agent', 'config.yaml');
    const text = await readFile(globalPath, 'utf8');
    globalConfig = parseYaml(text);
  } catch { /* not found */ }

  // 项目配置
  let projectConfig = {};
  try {
    const projectPath = join(process.cwd(), '.flow-agent', 'config.yaml');
    const text = await readFile(projectPath, 'utf8');
    projectConfig = parseYaml(text);
  } catch { /* not found */ }

  // 项目配置覆盖全局
  return { ...globalConfig, ...projectConfig };
}

/** 获取全局 workflows 目录 */
export function getGlobalWorkflowsDir() {
  return join(homedir(), '.flow-agent', 'workflows');
}

/** 获取项目 workflows 目录 */
export function getProjectWorkflowsDir() {
  return join(process.cwd(), '.flow-agent', 'workflows');
}
