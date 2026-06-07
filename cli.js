#!/usr/bin/env node
// cli.js — CLI 入口，薄层封装
import { createEngine } from './lib/engine.js';
import { logger } from './lib/logger.js';

async function main() {
  const engine = await createEngine();

  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error('Usage:');
    console.error('  node cli.js run <workflow-name>');
    console.error('  node cli.js generate <filename> "<description>"');
    console.error('  node cli.js generate-run <filename> "<description>"');
    process.exit(1);
  }

  if (command === 'run') {
    const name = args[0];
    if (!name) {
      console.error('Usage: node cli.js run <workflow-name>');
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

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});