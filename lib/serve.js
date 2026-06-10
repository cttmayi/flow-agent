// lib/serve.js — Web server for flow-agent
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';
import { ToolRegistry } from './tools/registry.js';
import readTool from './tools/read.js';
import writeTool from './tools/write.js';

const SESSIONS = new Map();

function parseUrl(reqUrl, base) {
  const url = new URL(reqUrl, `http://${base}`);
  const parts = url.pathname.replace(/\/$/, '').split('/').map(s => decodeURIComponent(s));
  return { url, parts };
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const MAX_SESSION_MESSAGES = 100; // keep last 50 turns

function getSession(name) {
  if (!SESSIONS.has(name)) {
    SESSIONS.set(name, { messages: [] });
  }
  return SESSIONS.get(name);
}

function extractCodeBlock(text) {
  let clean = text.trim();
  const codeBlockMatch = clean.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  }
  return clean;
}

function createAnthropicClient(config = {}) {
  // engine.js 的 resolveApiKey 逻辑：配置中的占位 key 跳过，使用 env 或 proxy 模式
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (config.anthropic_api_key &&
      config.anthropic_api_key !== 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    apiKey = config.anthropic_api_key;
  }
  if (!apiKey) apiKey = 'sk-ant-placeholder';

  const opts = { apiKey };
  if (config.base_url) {
    opts.baseURL = config.base_url;
  } else if (process.env.ANTHROPIC_BASE_URL) {
    opts.baseURL = process.env.ANTHROPIC_BASE_URL;
  }
  if (apiKey === 'sk-ant-placeholder' || apiKey.startsWith('sk-ant-xxx')) {
    opts.fetch = async (url, init) => {
      const headers = new Headers(init.headers);
      headers.delete('x-api-key');
      headers.delete('authorization');
      return fetch(url, { ...init, headers });
    };
  }
  return new Anthropic(opts);
}


function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res, workflowsDir, client, defaultModel, systemPrompt, chatSystemTemplate, dirname) {
  const { url, parts } = parseUrl(req.url, req.headers.host || 'localhost');
  const method = req.method;

  // 1. GET / — serve frontend HTML
  if (method === 'GET' && parts.length === 1 && parts[0] === '') {
    try {
      const html = await readFile(join(dirname, 'web', 'index.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      sendError(res, 404, 'Frontend not found');
    }
    return;
  }

  // 2. GET /api/workflows — list workflow names
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 3) {
    try {
      const files = await readdir(workflowsDir).catch(() => []);
      const workflows = files
        .filter(f => f.endsWith('.js'))
        .map(f => f.replace(/\.js$/, ''));
      sendJSON(res, 200, workflows);
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3. GET /api/workflows/:name — get workflow code
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 4) {
    const name = parts[3];
    try {
      const code = await readFile(join(workflowsDir, `${name}.js`), 'utf8');
      sendJSON(res, 200, { name, code });
    } catch {
      sendError(res, 404, `Workflow "${name}" not found`);
    }
    return;
  }

  // 4. GET /api/workflows/:name/messages — get chat history
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'messages' && parts.length === 5) {
    const name = parts[3];
    const session = getSession(name);
    sendJSON(res, 200, { messages: session.messages });
    return;
  }

  // 5. POST /api/workflows — create new workflow via LLM generation
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 3) {
    try {
      const body = await readBody(req);
      const { name, description } = body;
      if (!name || !description) {
        sendError(res, 400, 'Missing required fields: name, description');
        return;
      }

      const generatePromptTmpl = await readFile(join(dirname, 'prompts', 'dsnjs-generate.md'), 'utf8');
      const userPrompt = generatePromptTmpl.replace('{description}', description);

      const response = await client.messages.create({
        model: defaultModel,
        max_tokens: 4096,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt, cache_control: { type: 'ephemeral' } }] }],
      });

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const code = extractCodeBlock(text);

      await mkdir(workflowsDir, { recursive: true });
      const filePath = join(workflowsDir, `${name}.js`);
      await writeFile(filePath, code, 'utf8');

      // Initialize session for the new workflow
      const session = getSession(name);
      session.messages.push(
        { role: 'user', content: `已创建 workflow "${name}"。\n\n\`\`\`js\n${code}\n\`\`\`` },
        { role: 'assistant', content: `Workflow "${name}" 已创建成功。` },
      );

      sendJSON(res, 201, { name, code });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 6. POST /api/workflows/:name/chat — send chat message with tool_use loop
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'chat' && parts.length === 5) {
    const name = parts[3];
    try {
      const body = await readBody(req);
      const { message } = body;
      if (!message) {
        sendError(res, 400, 'Missing required field: message');
        return;
      }

      const wfPath = join(workflowsDir, `${name}.js`);
      const session = getSession(name);

      // Build chat system prompt with workflow path info
      const finalChatPrompt = [{ type: 'text', text: chatSystemTemplate.replace('{workflow_path}', wfPath), cache_control: { type: 'ephemeral' } }];

      // Build tool schemas for read/write
      const chatRegistry = new ToolRegistry();
      chatRegistry.register(readTool);
      chatRegistry.register(writeTool);
      const toolSchemas = chatRegistry.toAnthropicTools(['read', 'write']);

      // Append user message
      session.messages.push({ role: 'user', content: message });

      // Prune old messages
      if (session.messages.length > MAX_SESSION_MESSAGES) {
        session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
      }

      // Tool-use loop (max 10 rounds)
      let response;
      let toolUseCount = 0;
      const MAX_TOOL_ROUNDS = 10;

      while (toolUseCount < MAX_TOOL_ROUNDS) {
        response = await client.messages.create({
          model: defaultModel,
          max_tokens: 4096,
          system: finalChatPrompt,
          messages: [...session.messages],
          tools: toolSchemas,
        });

        const toolUses = response.content.filter(b => b.type === 'tool_use');

        if (toolUses.length === 0) {
          // No tool calls — done, push final text to session
          const replyText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          session.messages.push({ role: 'assistant', content: replyText || '(无回复)' });
          sendJSON(res, 200, { reply: replyText });
          return;
        }

        // Execute tool calls
        const toolResults = [];
        for (const block of toolUses) {
          try {
            const result = await chatRegistry.execute(block.name, block.input);
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

        session.messages.push({ role: 'assistant', content: response.content });
        session.messages.push({ role: 'user', content: toolResults });
        toolUseCount++;
      }

      // Max rounds exceeded — extract text from last response
      const replyText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      session.messages.push({ role: 'assistant', content: replyText || '(已达最大轮数)' });
      sendJSON(res, 200, { reply: replyText });
    } catch (err) {
      const session = getSession(name);
      const errorMsg = `错误：${err.message}`;
      session.messages.push({ role: 'assistant', content: errorMsg });
      sendError(res, 500, err.message);
    }
    return;
  }

  // 7. POST /api/workflows/:name/run — execute workflow via engine
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'run' && parts.length === 5) {
    const name = parts[3];
    try {
      // Auto-insert user message indicating execution
      const session = getSession(name);
      const userMsg = `执行 workflow "${name}"`;
      session.messages.push({ role: 'user', content: userMsg });

      // Dynamically import engine to avoid circular dependencies
      const { createEngine } = await import('./engine.js');
      const engine = await createEngine();

      const result = await engine.run(name);

      // Append result as assistant message
      const resultText = result == null ? '(无返回结果)' : (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      session.messages.push({ role: 'assistant', content: resultText });

      sendJSON(res, 200, { result: resultText });
    } catch (err) {
      const session = getSession(name);
      const errorMsg = `执行失败：${err.message}`;
      session.messages.push({ role: 'assistant', content: errorMsg });
      sendError(res, 500, errorMsg);
    }
    return;
  }

  // Fallback: unmatched route
  sendError(res, 404, `Not found: ${method} ${url.pathname}`);
}

export async function createServer_(opts = {}) {
  const config = await loadConfig();
  const port = opts.port || config.serve_port || 3000;
  const workflowsDir = join(process.cwd(), '.flow-agent', 'workflows');
  const client = createAnthropicClient(config);
  const defaultModel = config.default_model || process.env.DEFAULT_MODEL || 'claude-sonnet-4-20250514';
  const __dirname = new URL('.', import.meta.url).pathname;
  const apiSection = await readFile(join(__dirname, 'prompts', 'dsnjs-api.md'), 'utf8');
  const systemPrompt = (await readFile(join(__dirname, 'prompts', 'dsnjs-system.md'), 'utf8')).replace('{api_section}', apiSection);
  const chatSystemTemplate = (await readFile(join(__dirname, 'prompts', 'chat-system.md'), 'utf8')).replace('{api_section}', apiSection);

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, workflowsDir, client, defaultModel, systemPrompt, chatSystemTemplate, __dirname);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  return new Promise(resolve => {
    server.listen(port, () => {
      console.log(`flow-agent web UI at http://localhost:${port}`);
      resolve(server);
    });
  });
}
