// lib/executor.js
import { createSandbox } from './sandbox.js';
import { createAgent } from './api/agent.js';
import { createParallel } from './api/parallel.js';
import { createPhase } from './api/phase.js';
import { createCheckpoint } from './api/checkpoint.js';

export async function execute(code, toolRegistry, agentOpts, timeout, workflowDir, onPhase, onAgentOutput) {
  try {
    const agent = createAgent(toolRegistry, agentOpts);
    const agentWithProgress = async (prompt, opts = {}) => {
      return agent(prompt, {
        ...opts,
        onProgress: (text) => {
          if (onAgentOutput) onAgentOutput(text);
          if (opts.onProgress) opts.onProgress(text);
        },
      });
    };
    const parallel = createParallel();
    const phase = createPhase(onPhase);
    const checkpoint = createCheckpoint();

    const apis = {
      agent: agentWithProgress,
      parallel,
      phase,
      checkpoint,
      tool: async (name, params) => {
        try {
          return await toolRegistry.execute(name, params);
        } catch (err) {
          return { error: err.message };
        }
      },
    };

    return await createSandbox(code, apis, timeout, workflowDir);
  } catch (err) {
    // Wrap sandbox errors to prevent unhandled rejections crashing the process
    const message = err.message || String(err);
    throw new Error(`Workflow execution failed: ${message}`);
  }
}