#!/usr/bin/env node
// cli.js — CLI 入口，薄层封装
import { createEngine } from './lib/engine.js';
import { createServer_ } from './lib/serve.js';
import { logger } from './lib/logger.js';

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err instanceof Error ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});

async function main() {
  const [, , ...args] = process.argv;

  // flow-agent run <name>
  if (args[0] === 'run') {
    const name = args[1];
    if (!name) {
      console.error('Usage: flow-agent run <workflow-name>');
      process.exit(1);
    }
    const engine = await createEngine();
    const result = await engine.run(name);
    logger.result(result);
    return;
  }

  // flow-agent [-p|--port <port>]
  let port;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-p' || args[i] === '--port') {
      const next = args[++i];
      if (next && /^\d+$/.test(next)) port = parseInt(next, 10);
    }
  }

  await createServer_({ port });
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
