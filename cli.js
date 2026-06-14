#!/usr/bin/env node
// cli.js — CLI 入口，薄层封装
import { createEngine } from './lib/engine.js';
import { createServer_ } from './lib/serve.js';
import { logger } from './lib/logger.js';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err instanceof Error ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

async function main() {
  const engine = await createEngine();

  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error('Usage:');
    console.error('  flow-agent run <workflow-name>');
    console.error('  flow-agent generate <filename> "<description>"');
    console.error('  flow-agent generate-run <filename> "<description>"');
    process.exit(1);
  }

  if (command === 'run') {
    const name = args[0];
    if (!name) {
      console.error('Usage: flow-agent run <workflow-name>');
      process.exit(1);
    }
    const result = await engine.run(name);
    logger.result(result);
    return;
  }

  if (command === 'generate' || command === 'generate-run') {
    const name = args[0];
    const description = args.slice(1).join(' ');
    if (!name || !description) {
      console.error('Usage: node cli.js generate <filename> "<description>"');
      process.exit(1);
    }

    const { code } = await engine.generate(
      name,
      description,
      (text) => console.log(`[generate] ${text}`)
    );

    if (command === 'generate-run') {
      const result = await engine.execute(code);
      logger.result(result);
    }
    return;
  }

  if (command === 'serve') {
    const portArg = args[0] ? parseInt(args[0], 10) : undefined;
    await createServer_({ port: portArg });
    // Keep running until SIGINT
    await new Promise(() => {});
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});