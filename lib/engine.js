// lib/engine.js — 核心引擎，封装运行时初始化、工作流执行与生成
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './executor.js';
import { ToolRegistry } from './tools/registry.js';
import bashTool from './tools/bash.js';
import readTool from './tools/read.js';
import { createAgent } from './api/agent.js';
import { loadConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveApiKey(config) {
  // 配置文件优先，环境变量可覆盖
  if (config.anthropic_api_key &&
      config.anthropic_api_key !== 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    process.env.ANTHROPIC_API_KEY = config.anthropic_api_key;
  } else if (!process.env.ANTHROPIC_API_KEY) {
    // 代理模式：设一个占位 key 绕过 SDK 格式校验
    process.env.ANTHROPIC_API_KEY = 'sk-ant-placeholder';
  }
}

function createToolRegistry() {
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);
  return registry;
}

export async function createEngine() {
  const config = await loadConfig();
  resolveApiKey(config);

  const agentOpts = {
    baseURL: config.base_url,
    defaultModel: config.default_model,
    defaultTimeout: config.default_timeout,
  };

  const registry = createToolRegistry();

  const workflowsDir = join(process.cwd(), '.flow-agent', 'workflows');

  async function loadPrompt(name) {
    return readFile(join(__dirname, 'lib', 'prompts', name), 'utf8');
  }

  function extractCodeBlock(text) {
    let clean = text.trim();
    const codeBlockMatch = clean.match(/```[\w]*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }
    return clean;
  }

  return {
    /** 执行已保存的 workflow */
    async run(name) {
      const filePath = join(workflowsDir, `${name}.js`);
      const code = await readFile(filePath, 'utf8');
      return execute(code, registry, agentOpts);
    },

    /** 生成 workflow 文件，返回 { code, filePath } */
    async generate(name, description, onProgress) {
      const apiSection = await loadPrompt('dsnjs-api.md');
      const DSN_JS_SYSTEM_PROMPT = (await loadPrompt('dsnjs-system.md')).replace('{api_section}', apiSection);
      const generatePromptTmpl = await loadPrompt('dsnjs-generate.md');

      const agent = createAgent(registry, { ...agentOpts, systemPrompt: DSN_JS_SYSTEM_PROMPT });
      const generated = await agent(
        generatePromptTmpl.replace('{description}', description),
        { tools: ['bash', 'read'], onProgress }
      );

      const code = extractCodeBlock(generated);

      await mkdir(workflowsDir, { recursive: true });
      const filePath = join(workflowsDir, `${name}.js`);
      await writeFile(filePath, code, 'utf8');

      return { code, filePath };
    },

    /** 执行原始 workflow 代码 */
    async execute(code) {
      return execute(code, registry, agentOpts);
    },

    /** 获取 workflows 目录路径 */
    getWorkflowsDir() {
      return workflowsDir;
    },
  };
}