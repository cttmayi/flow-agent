// lib/serve.js — Web server for flow-agent
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
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

/** Resolve workflow: returns { type: 'dir', path } or { type: 'file', path } */
async function resolveWorkflowPath(workflowsDir, name) {
  const dirPath = join(workflowsDir, name);
  const filePath = join(workflowsDir, `${name}.js`);
  try {
    const s = await stat(dirPath);
    if (s.isDirectory()) return { type: 'dir', path: dirPath };
  } catch { /* not a directory */ }
  return { type: 'file', path: filePath };
}

/** Read workflow code: returns code string */
async function readWorkflowCode(workflowsDir, name) {
  const resolved = await resolveWorkflowPath(workflowsDir, name);
  if (resolved.type === 'dir') {
    return readFile(join(resolved.path, 'main.js'), 'utf8');
  }
  return readFile(resolved.path, 'utf8');
}

/** Recursively list files in a workflow directory */
async function listWorkflowFiles(workflowsDir, name) {
  const resolved = await resolveWorkflowPath(workflowsDir, name);
  if (resolved.type !== 'dir') return [];
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else {
        files.push(relative(resolved.path, full));
      }
    }
  }
  await walk(resolved.path);
  files.sort();
  return files;
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

  // 1. GET / or /marked.min.js — serve frontend files
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

  // 1b. GET /*.min.js, /*.css — serve static assets
  const staticFiles = ['marked.min.js', 'highlight.min.js', 'highlight.css'];
  if (method === 'GET' && parts.length === 2 && parts[0] === '' && staticFiles.includes(parts[1])) {
    const file = parts[1];
    const ext = file.split('.').pop();
    const mime = ext === 'js' ? 'application/javascript' : 'text/css';
    try {
      const content = await readFile(join(dirname, 'web', file), 'utf8');
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
      res.end(content);
    } catch {
      sendError(res, 404, `${file} not found`);
    }
    return;
  }

  // 2. GET /api/workflows — list workflow names (dirs and .js files)
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 3) {
    try {
      const entries = await readdir(workflowsDir, { withFileTypes: true }).catch(() => []);
      const workflows = entries
        .filter(e => e.isDirectory() || (e.isFile() && e.name.endsWith('.js')))
        .map(e => e.isDirectory() ? e.name : e.name.replace(/\.js$/, ''));
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
      const code = await readWorkflowCode(workflowsDir, name);
      sendJSON(res, 200, { name, code });
    } catch {
      sendError(res, 404, `Workflow "${name}" not found`);
    }
    return;
  }

  // 3a. GET /api/workflows/:name/files — list files in workflow dir
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'files' && parts.length === 5) {
    const name = parts[3];
    try {
      const files = await listWorkflowFiles(workflowsDir, name);
      sendJSON(res, 200, { name, files });
    } catch {
      sendError(res, 404, `Workflow "${name}" not found`);
    }
    return;
  }

  // 3b. GET /api/workflows/:name/file/* — get specific file content
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'file' && parts.length >= 6) {
    const name = parts[3];
    const fileRelPath = parts.slice(5).join('/');
    try {
      const resolved = await resolveWorkflowPath(workflowsDir, name);
      if (resolved.type !== 'dir') { sendError(res, 404, 'Not a directory workflow'); return; }
      const content = await readFile(join(resolved.path, fileRelPath), 'utf8');
      sendJSON(res, 200, { name, path: fileRelPath, content });
    } catch {
      sendError(res, 404, `File not found`);
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
      const workflowDir = join(workflowsDir, name);
      await mkdir(workflowDir, { recursive: true });

      // Parse multi-file output
      const fileBlocks = text.match(/```[\w]*:[^\n]+\n[\s\S]*?\n```/g);
      if (fileBlocks && fileBlocks.length > 1) {
        for (const block of fileBlocks) {
          const firstLineEnd = block.indexOf('\n');
          const header = block.slice(3, firstLineEnd);
          const colonIdx = header.indexOf(':');
          const relPath = header.slice(colonIdx + 1).trim();
          const content = block.slice(firstLineEnd + 1, -3);
          const targetPath = join(workflowDir, relPath);
          await mkdir(targetPath.replace(/\/[^/]+$/, ''), { recursive: true });
          await writeFile(targetPath, content, 'utf8');
        }
      } else {
        const filePath = join(workflowDir, 'main.js');
        await writeFile(filePath, code, 'utf8');
      }

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

      const wfResolved = await resolveWorkflowPath(workflowsDir, name);
      const wfPath = wfResolved.path;
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

  // 7. POST /api/workflows/:name/run — execute workflow via engine (SSE)
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'run' && parts.length === 5) {
    const name = parts[3];
    const session = getSession(name);
    const userMsg = `执行 workflow "${name}"`;
    session.messages.push({ role: 'user', content: userMsg });

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      const { createEngine } = await import('./engine.js');
      const engine = await createEngine();

      const result = await engine.run(name, (phaseName) => {
        res.write(`event: phase\ndata: ${JSON.stringify(phaseName)}\n\n`);
      });

      const resultText = result == null ? '(无返回结果)' : (typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      session.messages.push({ role: 'assistant', content: resultText });
      res.write(`event: done\ndata: ${JSON.stringify(resultText)}\n\n`);
      res.end();
    } catch (err) {
      const errorMsg = `执行失败：${err.message}`;
      session.messages.push({ role: 'assistant', content: errorMsg });
      res.write(`event: error\ndata: ${JSON.stringify(errorMsg)}\n\n`);
      res.end();
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
