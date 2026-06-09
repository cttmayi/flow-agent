// lib/serve.js — Web server for flow-agent
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.js';

const SESSIONS = new Map();

function parseUrl(reqUrl, base) {
  const url = new URL(reqUrl, `http://${base}`);
  const parts = url.pathname.replace(/\/$/, '').split('/');
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

async function handleRequest(req, res, workflowsDir, client, defaultModel, systemPrompt, dirname) {
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
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

  // 6. POST /api/workflows/:name/chat — send chat message with code context
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'chat' && parts.length === 5) {
    const name = parts[3];
    try {
      const body = await readBody(req);
      const { message } = body;
      if (!message) {
        sendError(res, 400, 'Missing required field: message');
        return;
      }

      // Read current workflow code from disk
      let currentCode = '';
      try {
        currentCode = await readFile(join(workflowsDir, `${name}.js`), 'utf8');
      } catch {
        // Workflow file may not exist yet; proceed with empty context
      }

      // Build system prompt with current code context
      const chatSystemPrompt = `你是 DSN-JS 工作流编辑助手。你正在和用户对话，帮助用户修改和执行 DSN-JS 工作流。

当前工作流 "${name}.js" 代码如下：

\`\`\`js
${currentCode || '(空文件)'}
\`\`\`

## 你的工作方式

1. 用户会提出修改要求，你根据要求修改代码
2. 如果需要修改代码，输出完整的新的工作流代码，用 \`\`\`js ... \`\`\` 代码块包裹
3. 如果不需要修改代码，直接回复用户即可
4. 回复要简洁自然，像助手一样对话，不要以"已根据您的需求生成"开头
5. 如果用户问问题或聊天，正常回答即可

## DSN-JS API 说明

工作流代码中可以使用的全局 API：
- agent(prompt, opts?) — 调用 AI agent
- parallel(tasks, opts?) — 并发执行
- phase(name) — 标记阶段
- checkpoint(key, value?) — 内存缓存

可用工具：bash（执行命令）、read（读取文件）`;

      // Append user message to session history
      const session = getSession(name);
      session.messages.push({ role: 'user', content: message });

      // Prune old messages to prevent unbounded growth
      if (session.messages.length > MAX_SESSION_MESSAGES) {
        session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
      }

      // Call Anthropic with full message history (shallow copy to avoid SDK mutation)
      const response = await client.messages.create({
        model: defaultModel,
        max_tokens: 4096,
        system: chatSystemPrompt,
        messages: [...session.messages],
      });

      const replyText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

      // Extract code blocks from reply and save if code changed
      const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/;
      const codeMatch = replyText.match(codeBlockRegex);
      let codeChanged = false;
      if (codeMatch) {
        const newCode = codeMatch[1].trim();
        if (newCode && newCode !== currentCode) {
          await mkdir(workflowsDir, { recursive: true });
          await writeFile(join(workflowsDir, `${name}.js`), newCode, 'utf8');
          codeChanged = true;
        }
      }

      // Append assistant reply to session history
      session.messages.push({ role: 'assistant', content: replyText });

      sendJSON(res, 200, { reply: replyText, codeChanged });
    } catch (err) {
      const session = getSession(name);
      session.messages.push({ role: 'assistant', content: `错误：${err.message}` });
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
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
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
  const systemPrompt = await readFile(join(__dirname, 'prompts', 'dsnjs-system.md'), 'utf8');

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, workflowsDir, client, defaultModel, systemPrompt, __dirname);
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
