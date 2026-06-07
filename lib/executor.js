// lib/executor.js
import { createSandbox } from './sandbox.js';
import { createAgent } from './api/agent.js';
import { createParallel } from './api/parallel.js';
import { createPhase } from './api/phase.js';
import { createCheckpoint } from './api/checkpoint.js';

export async function execute(code, toolRegistry, agentOpts, timeout) {
  const agent = createAgent(toolRegistry, agentOpts);
  const parallel = createParallel();
  const phase = createPhase();
  const checkpoint = createCheckpoint();

  const apis = { agent, parallel, phase, checkpoint };

  return createSandbox(code, apis, timeout);
}