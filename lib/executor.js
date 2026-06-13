// lib/executor.js
import { createSandbox } from './sandbox.js';
import { createAgent } from './api/agent.js';
import { createParallel } from './api/parallel.js';
import { createPhase } from './api/phase.js';
import { createCheckpoint } from './api/checkpoint.js';

export async function execute(code, toolRegistry, agentOpts, timeout, workflowDir, onPhase) {
  const agent = createAgent(toolRegistry, agentOpts);
  const parallel = createParallel();
  const phase = createPhase(onPhase);
  const checkpoint = createCheckpoint();

  const apis = {
    agent,
    parallel,
    phase,
    checkpoint,
    tool: (name, params) => toolRegistry.execute(name, params),
  };

  return createSandbox(code, apis, timeout, workflowDir);
}