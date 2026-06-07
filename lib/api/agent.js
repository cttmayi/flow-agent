// lib/api/agent.js — Anthropic SDK 集成 + tool_use 循环
import Anthropic from '@anthropic-ai/sdk';

export function createAgent(toolRegistry, opts = {}) {
  return async (prompt, agentOpts = {}) => {
    const model = agentOpts.model || opts.defaultModel || 'claude-sonnet-4-20250514';
    const tools = agentOpts.tools || [];
    const timeout = agentOpts.timeout || opts.defaultTimeout || 120000;
    const systemPrompt = agentOpts.systemPrompt || opts.systemPrompt || '';

    const clientOpts = {
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
    if (opts.baseURL) {
      clientOpts.baseURL = opts.baseURL;
    }

    // 占位 key → 代理模式，跳过 auth header
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

    const messages = [{ role: 'user', content: prompt }];
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
          system: systemPrompt || undefined,
          messages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          signal: controller.signal,
        });

        const toolUses = response.content.filter(b => b.type === 'tool_use');

        if (toolUses.length === 0) {
          // No tool calls → return final text
          const textBlocks = response.content.filter(b => b.type === 'text');
          return textBlocks.map(b => b.text).join('\n');
        }

        // Process tool calls
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

      // Exceeded max rounds, return last text
      const textBlocks = response.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('\n');
    } finally {
      clearTimeout(timeoutId);
    }
  };
}