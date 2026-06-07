#!/usr/bin/env node
// cli.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execute } from './lib/executor.js';
import { ToolRegistry } from './lib/tools/registry.js';
import bashTool from './lib/tools/bash.js';
import readTool from './lib/tools/read.js';
import { createAgent } from './lib/api/agent.js';
import { logger } from './lib/logger.js';

async function main() {
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
    const result = await execute(code, registry);
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

    // Use agent to generate DSN-JS code
    const agent = createAgent(registry);
    const generated = await agent(
      `根据以下需求生成 DSN-JS 工作流代码（使用 agent、parallel、phase、checkpoint API）：
${description}

输出格式要求：只输出 JavaScript 代码，不要包裹 markdown 代码块标记。`
    );

    // Save file
    await mkdir(workflowsDir, { recursive: true });
    const filePath = join(workflowsDir, `${name}.js`);
    await writeFile(filePath, generated.trim(), 'utf8');
    logger.info(`Workflow saved to ${filePath}`);

    if (command === 'generate-run') {
      const result = await execute(generated.trim(), registry);
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