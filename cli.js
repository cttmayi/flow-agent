#!/usr/bin/env node
// cli.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './lib/executor.js';
import { ToolRegistry } from './lib/tools/registry.js';
import bashTool from './lib/tools/bash.js';
import readTool from './lib/tools/read.js';
import { createAgent } from './lib/api/agent.js';
import { logger } from './lib/logger.js';
import { loadConfig } from './lib/config.js';

async function main() {
  // 加载 .flow-agent/config.yaml
  const config = await loadConfig();

  // 设置 API key：环境变量 > 配置文件 > 代理模式占位 key
  if (process.env.ANTHROPIC_API_KEY) {
    // 已设置，无需操作
  } else if (config.anthropic_api_key &&
             config.anthropic_api_key !== 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    process.env.ANTHROPIC_API_KEY = config.anthropic_api_key;
  } else {
    // 代理模式：设一个占位 key 绕过 SDK 格式校验
    process.env.ANTHROPIC_API_KEY = 'sk-ant-placeholder';
  }

  // 构造 agent 选项（传给 createAgent 和 executor）
  const agentOpts = {
    baseURL: config.base_url,
    defaultModel: config.default_model,
    defaultTimeout: config.default_timeout,
  };

  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error('Usage:');
    console.error('  node runtime.js run <workflow-name>');
    console.error('  node runtime.js generate <filename> "<description>"');
    console.error('  node runtime.js generate-run <filename> "<description>"');
    process.exit(1);
  }

  // Initialize tool registry
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);

  const workflowsDir = join(process.cwd(), '.flow-agent', 'workflows');

  if (command === 'run') {
    const name = args[0];
    if (!name) {
      console.error('Usage: node runtime.js run <workflow-name>');
      process.exit(1);
    }
    const filePath = join(workflowsDir, `${name}.js`);
    const code = await readFile(filePath, 'utf8');
    const result = await execute(code, registry, agentOpts);
    logger.result(result);
    return;
  }

  if (command === 'generate' || command === 'generate-run') {
    const name = args[0];
    const description = args.slice(1).join(' ');
    if (!name || !description) {
      console.error('Usage: node runtime.js generate <filename> "<description>"');
      process.exit(1);
    }

    // Load system prompt from file
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const DSN_JS_SYSTEM_PROMPT = await readFile(join(__dirname, 'lib', 'prompts', 'dsnjs-system.md'), 'utf8');

    const generatePromptTmpl = await readFile(join(__dirname, 'lib', 'prompts', 'dsnjs-generate.md'), 'utf8');

    const agent = createAgent(registry, { ...agentOpts, systemPrompt: DSN_JS_SYSTEM_PROMPT });
    const generated = await agent(
      generatePromptTmpl.replace('{description}', description),
      { tools: ['bash', 'read'], onProgress: (text) => console.log(`[generate] ${text}`) }
    );

    // Strip markdown code block markers if present
    let clean = generated.trim();
    // Extract content from markdown code blocks even if there's text before/after
    const codeBlockMatch = clean.match(/```[\w]*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      clean = codeBlockMatch[1].trim();
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    }

    // Save file
    await mkdir(workflowsDir, { recursive: true });
    const filePath = join(workflowsDir, `${name}.js`);
    await writeFile(filePath, clean, 'utf8');

    if (command === 'generate-run') {
      const result = await execute(clean, registry, agentOpts);
      logger.result(result);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});