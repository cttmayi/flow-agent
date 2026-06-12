// lib/api/agent-anthropic.js — Anthropic SDK-based agent provider
import Anthropic from '@anthropic-ai/sdk';

export function createAnthropicAgent(toolRegistry, opts = {}) {
  return async (prompt, agentOpts = {}) => {
    const model = agentOpts.model || opts.defaultModel || 'claude-sonnet-4-20250514';
    const tools = agentOpts.tools || [];
    const timeout = agentOpts.timeout || opts.defaultTimeout || 120000;
    const systemPrompt = agentOpts.systemPrompt || opts.systemPrompt || '';
    const onProgress = agentOpts.onProgress || opts.onProgress;

    const clientOpts = {
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
    if (opts.baseURL) {
      clientOpts.baseURL = opts.baseURL;
    }

    // Placeholder key → proxy mode, strip auth header
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const isPlaceholder = apiKey === 'sk-ant-placeholder' || apiKey.startsWith('sk-ant-xxx');
    if (isPlaceholder) {
      clientOpts.fetch = async (url, init) => {
        const headers = new Headers(init.headers);
        headers.delete('x-api-key');
        headers.delete('authorization');
        return fetch(url, { ...init, headers });
      };
    }

    const anthropic = new Anthropic(clientOpts);

    const system = systemPrompt
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
    }];
    let toolSchemas = [];

    if (tools.length > 0) {
      toolSchemas = toolRegistry.toAnthropicTools(tools);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let response;
      let toolUseCount = 0;
      const MAX_TOOL_ROUNDS = 10;

      while (toolUseCount < MAX_TOOL_ROUNDS) {
        response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system,
          messages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          signal: controller.signal,
        });

        const toolUses = response.content.filter(b => b.type === 'tool_use');

        if (onProgress) {
          const textBlocks = response.content.filter(b => b.type === 'text');
          if (textBlocks.length > 0) {
            onProgress(textBlocks.map(b => b.text).join('\n'));
          }
        }

        if (toolUses.length === 0) {
          const textBlocks = response.content.filter(b => b.type === 'text');
          return textBlocks.map(b => b.text).join('\n');
        }

        const toolResults = [];
        for (const block of toolUses) {
          try {
            const result = await toolRegistry.execute(block.name, block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${err.message}`,
              is_error: true,
            });
          }
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        toolUseCount++;
      }

      const textBlocks = response.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('\n');
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
