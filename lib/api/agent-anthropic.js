// lib/api/agent-anthropic.js — Anthropic SDK-based agent provider
import Anthropic from '@anthropic-ai/sdk';

function extractText(response) {
  return response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
}

function convertFormat(text, format) {
  if (format === 'text' || !format) return text;

  if (format === 'json') {
    const trimmed = text.trim();
    // Try direct parse first
    try { return JSON.parse(trimmed); } catch {}
    // Try extracting from markdown code block
    const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (match) {
      try { return JSON.parse(match[1].trim()); } catch {}
    }
    throw new Error('输出不是合法的 JSON');
  }

  if (format === 'code') {
    const trimmed = text.trim();
    const match = trimmed.match(/```[\w]*\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    // No code block found, return as-is
    return trimmed;
  }

  return text;
}

function getFormatHint(format) {
  if (format === 'json') return '请只输出 JSON 本身，不要包含 markdown 代码块标记（不要用 ```json 包裹）、不要包含任何解释说明或额外内容。确保 JSON 语法正确（引号、逗号、括号匹配）。';
  if (format === 'code') return '请将代码放在 markdown 代码块中（用 ``` 包裹），不要包含代码块之外的说明文字。';
  return '';
}

function getRetryMessage(format, retryCount) {
  if (format === 'json') {
    if (retryCount === 1) return '输出不是合法的 JSON。请只输出 JSON 本身，不要用 ```json 包裹，不要加任何说明文字。确保 JSON 格式正确，例如：{"key": "value"}';
    return '再次提醒：输出必须是可以直接 JSON.parse 的合法 JSON。只输出 JSON，不要包含任何其他内容。检查：属性名必须用双引号、字符串必须用双引号、不能有尾随逗号。';
  }
  if (format === 'code') {
    if (retryCount === 1) return '输出没有包含代码块。请用 ``` 包裹代码，例如：\n```javascript\nconsole.log("hello")\n```\n不要包含代码块之外的说明。';
    return '再次提醒：必须将代码放在 ``` 标记的代码块中。只输出代码块，不要包含任何其他文字。';
  }
  return '';
}

export function createAnthropicAgent(toolRegistry, opts = {}) {
  return async (prompt, agentOpts = {}) => {
    const model = agentOpts.model || opts.defaultModel || 'claude-sonnet-4-20250514';
    const tools = agentOpts.tools || [];
    const timeout = agentOpts.timeout || opts.defaultTimeout || 120000;
    const systemPrompt = agentOpts.systemPrompt || opts.systemPrompt || '';
    const onProgress = agentOpts.onProgress || opts.onProgress;
    const format = agentOpts.format;

    const anthropic = new Anthropic({
      apiKey: opts.apiKey || process.env.ANTHROPIC_API_KEY || undefined,
      baseURL: opts.baseURL,
    });

    const system = systemPrompt
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const messages = [{
      role: 'user',
      content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
    }];

    // If format is specified, append instruction to the initial prompt
    if (format && format !== 'text') {
      const lastMsg = messages[messages.length - 1];
      const text = typeof lastMsg.content === 'string' ? lastMsg.content : lastMsg.content.map(b => b.text).join('\n');
      const formatted = `${text}\n\n注意：请严格按照要求的格式输出。${getFormatHint(format)}`;
      if (typeof lastMsg.content === 'string') {
        lastMsg.content = formatted;
      } else {
        lastMsg.content = [{ type: 'text', text: formatted, cache_control: { type: 'ephemeral' } }];
      }
    }

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
      let formatRetries = 0;
      const MAX_FORMAT_RETRIES = 2; // 初始尝试 + 2 次重试 = 共 3 次

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
          const text = extractText(response);

          // Format conversion with retry
          if (format && format !== 'text') {
            try {
              return convertFormat(text, format);
            } catch (err) {
              if (formatRetries < MAX_FORMAT_RETRIES) {
                formatRetries++;
                const hint = getRetryMessage(format, formatRetries);
                messages.push({ role: 'assistant', content: response.content });
                messages.push({ role: 'user', content: hint });
                continue;
              }
              // All retries exhausted
              throw new Error(
                `agent() ${format} 格式转换失败（已重试 ${formatRetries} 次）: ${err.message}\n原始返回：\n${text.slice(0, 500)}`
              );
            }
          }

          return text;
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

      const text = extractText(response);

      // Format conversion after max rounds
      if (format && format !== 'text') {
        try {
          return convertFormat(text, format);
        } catch (err) {
          throw new Error(
            `agent() ${format} 格式转换失败（已达最大轮数）: ${err.message}\n原始返回：\n${text.slice(0, 500)}`
          );
        }
      }

      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
