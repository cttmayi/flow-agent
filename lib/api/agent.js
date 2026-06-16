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

  // Spawn agents don't support systemPrompt natively, so inject it into prompt text
  const systemPrompt = opts.systemPrompt;
  const defaultMaxTokens = opts.defaultMaxTokens;
  const spawnAgent = createSpawnAgent(agentConfig);
  return async (prompt, agentOpts = {}) => {
    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    if (!agentOpts.maxTokens && defaultMaxTokens) {
      agentOpts = { ...agentOpts, maxTokens: defaultMaxTokens };
    }
    return spawnAgent(fullPrompt, agentOpts);
  };
}
