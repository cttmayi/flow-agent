// lib/api/agent.js — Agent provider factory
// Config determines which provider to use at construction time.
import { createAnthropicAgent } from './agent-anthropic.js';
import { createSpawnAgent } from './agent-spawn.js';
import { BUILTIN_AGENTS } from '../agents.js';

export function createAgent(toolRegistry, opts = {}) {
  const agentType = opts.defaultAgent || 'internal';

  if (agentType === 'internal') {
    return createAnthropicAgent(toolRegistry, opts);
  }

  const agentConfig = BUILTIN_AGENTS[agentType];

  if (!agentConfig) {
    throw new Error(
      `Unknown agent type: "${agentType}". ` +
      `Built-in: internal. ` +
      `Available built-in agents: ${Object.keys(BUILTIN_AGENTS).join(', ') || '(none)'}`
    );
  }

  return createSpawnAgent(agentConfig);
}
