// lib/api/agent.js — Anthropic SDK 集成 + tool_use 循环
import Anthropic from '@anthropic-ai/sdk';

export function createAgent(toolRegistry) {
  return async (prompt, opts = {}) => {
    const model = opts.model || 'claude-sonnet-4-20250514';
    const tools = opts.tools || [];
    const timeout = opts.timeout || 120000;

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

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