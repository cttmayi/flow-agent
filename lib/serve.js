// lib/serve.js — Web server for flow-agent
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, getGlobalWorkflowsDir, getProjectWorkflowsDir } from './config.js';
import { ToolRegistry } from './tools/registry.js';
import readTool from './tools/read.js';
import writeTool from './tools/write.js';
import bashTool from './tools/bash.js';
import editTool from './tools/edit.js';
import { createAgent } from './api/agent.js';

const SESSIONS = new Map();
const CREATE_SESSIONS = new Map();

// Cleanup stale create sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of CREATE_SESSIONS) {
    if (now - sess.updatedAt > 30 * 60 * 1000) CREATE_SESSIONS.delete(id);
  }
}, 5 * 60 * 1000).unref();

function describeResult(result) {
  if (result == null || result === '') return '(workflow 执行完毕但没有返回任何值)';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    // If error is a descriptive string, show it
    if (typeof result.error === 'string') return `错误：${result.error}`;
    // If there's a message (even alongside boolean error), show it
    if (typeof result.message === 'string') return result.message;
    // Error is boolean true — generic message, look for other useful fields
    if (result.error === true) return '执行出错，请检查操作';
    // stdout/stderr from bash tool, or summary from edit tool
    if (typeof result.stdout === 'string') return result.stderr ? `${result.stdout}\n${result.stderr}` : result.stdout;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.summary === 'string') return result.summary;
    // Fallback: key-value pairs from tool results
    const entries = Object.entries(result).filter(([, v]) => v != null && typeof v !== 'object');
    if (entries.length > 0) return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
    return String(result);
  }
  return String(result);
}

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
const MAX_SESSION_MESSAGES = 100;

function getSession(name) {
  if (!SESSIONS.has(name)) {
    SESSIONS.set(name, { messages: [] });
  }
  return SESSIONS.get(name);
}

/** Resolve workflow across project then global: returns { type, path, source } or null */
async function resolveWorkflowPath(projectDir, globalDir, name) {
  // Try project first
  const pDir = join(projectDir, name);
  const pFile = join(projectDir, `${name}.js`);
  try {
    const s = await stat(pDir);
    if (s.isDirectory()) return { type: 'dir', path: pDir, source: 'project' };
  } catch { /* not a directory */ }
  try {
    await stat(pFile);
    return { type: 'file', path: pFile, source: 'project' };
  } catch { /* not found */ }

  // Fallback to global
  const gDir = join(globalDir, name);
  const gFile = join(globalDir, `${name}.js`);
  try {
    const s = await stat(gDir);
    if (s.isDirectory()) return { type: 'dir', path: gDir, source: 'global' };
  } catch { /* not a directory */ }
  try {
    await stat(gFile);
    return { type: 'file', path: gFile, source: 'global' };
  } catch { /* not found */ }

  return null;
}

/** List workflows from a single directory, returning names */
async function listWorkflowsFromDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() || (e.isFile() && e.name.endsWith('.js')))
      .map(e => e.isDirectory() ? e.name : e.name.replace(/\.js$/, ''));
  } catch {
    return [];
  }
}

/** Read workflow code from resolved path */
async function readWorkflowCode(resolved) {
  if (resolved.type === 'dir') {
    return readFile(join(resolved.path, 'main.js'), 'utf8');
  }
  return readFile(resolved.path, 'utf8');
}

/** Recursively list files in a workflow directory */
async function listWorkflowFiles(resolved) {
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
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (config.anthropic_api_key &&
      config.anthropic_api_key !== 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    apiKey = config.anthropic_api_key;
  }

  const isPlaceholder = !apiKey || apiKey === 'sk-ant-placeholder' || apiKey.startsWith('sk-ant-xxx');

  const opts = {
    apiKey: isPlaceholder ? null : apiKey,
    defaultHeaders: isPlaceholder ? { 'x-api-key': null } : undefined,
  };
  if (config.base_url) {
    opts.baseURL = config.base_url;
  } else if (process.env.ANTHROPIC_BASE_URL) {
    opts.baseURL = process.env.ANTHROPIC_BASE_URL;
  }
  if (isPlaceholder) {
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

async function handleRequest(req, res, projectDir, globalDir, client, defaultModel, systemPrompt, chatSystemTemplate, dirname, createRegistry, config) {
  const { url, parts } = parseUrl(req.url, req.headers.host || 'localhost');
  const method = req.method;

  // 1. GET / — serve frontend
  if (method === 'GET' && parts.length === 1 && parts[0] === '') {
    try {
      let html = await readFile(join(dirname, 'web', 'index.html'), 'utf8');
      html = html.replace('id="version"></span>', `id="version">v${APP_VERSION}</span>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      sendError(res, 404, 'Frontend not found');
    }
    return;
  }

  // 1b. GET static assets
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

  // 2. GET /api/workflows — list workflows from both dirs with source
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 3) {
    try {
      const projectNames = await listWorkflowsFromDir(projectDir);
      const globalNames = await listWorkflowsFromDir(globalDir);

      // Deduplicate: project names override global
      const projectSet = new Set(projectNames);
      const result = [];

      for (const name of projectNames) {
        result.push({ name, source: 'project' });
      }
      for (const name of globalNames) {
        if (!projectSet.has(name)) {
          result.push({ name, source: 'global' });
        } else {
          result.push({ name, source: 'global', overridden: true });
        }
      }

      sendJSON(res, 200, result);
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3. GET /api/workflows/:name — get workflow code
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 4) {
    const name = parts[3];
    try {
      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found`); return; }
      const code = await readWorkflowCode(resolved);
      sendJSON(res, 200, { name, code, source: resolved.source });
    } catch {
      sendError(res, 404, `Workflow "${name}" not found`);
    }
    return;
  }

  // 3a. GET /api/workflows/:name/files — list files
  if (method === 'GET' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'files' && parts.length === 5) {
    const name = parts[3];
    try {
      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found`); return; }
      const files = await listWorkflowFiles(resolved);
      sendJSON(res, 200, { name, files, source: resolved.source });
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
      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found`); return; }
      if (resolved.type !== 'dir') { sendError(res, 404, 'Not a directory workflow'); return; }
      const content = await readFile(join(resolved.path, fileRelPath), 'utf8');
      sendJSON(res, 200, { name, path: fileRelPath, content });
    } catch {
      sendError(res, 404, `File not found`);
    }
    return;
  }

  // 3c. PUT /api/workflows/:name — save single-file workflow code (to project)
  if (method === 'PUT' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 4) {
    const name = parts[3];
    try {
      const body = await readBody(req);
      const { code } = body;
      if (code === undefined) { sendError(res, 400, 'Missing required field: code'); return; }
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, `${name}.js`), code, 'utf8');
      sendJSON(res, 200, { name, saved: true });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3d. PUT /api/workflows/:name/file/* — save specific file (to project dir)
  if (method === 'PUT' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'file' && parts.length >= 6) {
    const name = parts[3];
    const fileRelPath = parts.slice(5).join('/');
    try {
      const body = await readBody(req);
      const { content } = body;
      if (content === undefined) { sendError(res, 400, 'Missing required field: content'); return; }
      // Resolve to find the actual directory path
      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      const baseDir = resolved ? resolved.path : join(projectDir, name);
      const targetPath = join(baseDir, fileRelPath);
      await mkdir(targetPath.replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(targetPath, content, 'utf8');
      sendJSON(res, 200, { name, path: fileRelPath, saved: true });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3e. DELETE /api/workflows/:name — delete workflow from project or global
  if (method === 'DELETE' && parts[1] === 'api' && parts[2] === 'workflows' && parts.length === 4) {
    const name = parts[3];
    try {
      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found`); return; }
      const target = resolved.path;
      if (resolved.type === 'dir') {
        await rm(target, { recursive: true, force: true });
      } else {
        await rm(target, { force: true });
      }
      SESSIONS.delete(name);
      sendJSON(res, 200, { name, deleted: true });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3f. POST /api/workflows/:name/copy — copy workflow between project and global
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'copy' && parts.length === 5) {
    const name = parts[3];
    try {
      const body = await readBody(req);
      const { to } = body;
      if (!to || (to !== 'global' && to !== 'project')) {
        sendError(res, 400, 'Missing or invalid field: to (must be "global" or "project")');
        return;
      }

      const fromDir = to === 'global' ? projectDir : globalDir;
      const destDir = to === 'global' ? globalDir : projectDir;

      const resolved = await resolveWorkflowPath(fromDir, fromDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found in source`); return; }

      await mkdir(destDir, { recursive: true });
      const dest = join(destDir, name);

      if (resolved.type === 'dir') {
        // Remove existing dest first for clean copy (no leftover files)
        await rm(dest, { recursive: true, force: true });
        const { execSync } = await import('node:child_process');
        execSync(`cp -R "${resolved.path}" "${dest}"`);
      } else {
        const content = await readFile(resolved.path, 'utf8');
        await writeFile(dest, content, 'utf8');
      }

      sendJSON(res, 200, { name, to, copied: true });
    } catch (err) {
      sendError(res, 500, err.message);
    }
    return;
  }

  // 3g. POST /api/workflows/create — multi-phase subagent workflow creation
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[3] === 'create' && parts.length === 4) {
    try {
      const body = await readBody(req);
      const { sessionId, phase, message, name } = body;

      // New session
      if (!sessionId || !CREATE_SESSIONS.has(sessionId)) {
        const newId = crypto.randomUUID();
        const wfName = name || 'unnamed';
        const session = {
          sessionId: newId,
          name: wfName,
          phase: phase || 'requirements',
          messages: [],
          context: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        CREATE_SESSIONS.set(newId, session);
        sendJSON(res, 200, {
          sessionId: newId,
          phase: session.phase,
          message: '你好！我是需求分析师。请描述一下你想创建的 workflow 是做什么的？',
          status: 'continue',
          context: {},
        });
        return;
      }

      const session = CREATE_SESSIONS.get(sessionId);
      session.updatedAt = Date.now();
      session.phase = phase;

      // Store user message
      if (message) {
        session.messages.push({ role: 'user', content: message });
      }

      // Load subagent system prompt
      const phasePrompt = await readFile(join(dirname, 'prompts', `create-${phase}.md`), 'utf8');

      // Build agent messages — inject prior phase context at start of new phase
      let agentMessages = session.messages;
      const hasPriorContext = Object.keys(session.context).length > 0;
      if (hasPriorContext && session.messages.length <= 1) {
        const ctxSummary = Object.entries(session.context)
          .map(([k, v]) => `## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`)
          .join('\n\n');
        let phaseIntro = `已完成阶段：\n\n${ctxSummary}\n\n---\n请开始当前阶段：${phase}`;
        // Inject workflow path for file operations
        if (['generate', 'review', 'verify'].includes(phase)) {
          const wfDir = `.flow-agent/workflows/${session.name}`;
          phaseIntro += `\n\n工作流目录：${wfDir}\n文件应创建/读取在 ${wfDir}/ 下。`;
        }
        agentMessages = [{ role: 'user', content: phaseIntro }];
        if (message) agentMessages.push({ role: 'user', content: message });
      }

      // Run agent
      const agent = createAgent(createRegistry, {
        baseURL: config.base_url,
        defaultModel: config.default_model,
        systemPrompt: phasePrompt,
        apiKey: config.anthropic_api_key,
      });

      const promptText = agentMessages.map(m => {
        const role = m.role === 'user' ? '用户' : '助手';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}：${content}`;
      }).join('\n\n');

      const reply = await agent(promptText, { tools: ['bash', 'read', 'write', 'edit'] });

      // Store reply
      session.messages.push({ role: 'assistant', content: reply });

      // Parse status — auto-advance phases approve on non-empty reply
      let status = 'continue';
      const autoAdvancePhases = ['generate', 'review', 'verify'];
      if (reply.includes('[STATUS: approved]')) status = 'approved';
      else if (reply.includes('[STATUS: cancelled]')) status = 'cancelled';
      else if (autoAdvancePhases.includes(phase) && reply.trim()) status = 'approved';

      // Store phase output in context on approval
      if (status === 'approved') {
        session.context[phase] = reply;
      }

      sendJSON(res, 200, {
        sessionId: session.sessionId,
        phase,
        message: reply,
        status,
        context: session.context,
      });
    } catch (err) {
      sendError(res, 500, err.message);
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

  // 5. POST /api/workflows — create new workflow (to project dir)
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

      await mkdir(projectDir, { recursive: true });
      const workflowDir = join(projectDir, name);
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

      // Initialize session
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

  // 6. POST /api/workflows/:name/chat — chat with tool_use loop (SSE)
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'chat' && parts.length === 5) {
    const name = parts[3];
    try {
      const body = await readBody(req);
      const { message } = body;
      if (!message) {
        sendError(res, 400, 'Missing required field: message');
        return;
      }

      const resolved = await resolveWorkflowPath(projectDir, globalDir, name);
      if (!resolved) { sendError(res, 404, `Workflow "${name}" not found`); return; }
      const wfPath = resolved.path;
      const session = getSession(name);

      const finalChatPrompt = [{ type: 'text', text: chatSystemTemplate.replace('{workflow_path}', wfPath), cache_control: { type: 'ephemeral' } }];

      const chatRegistry = new ToolRegistry();
      chatRegistry.register(readTool);
      chatRegistry.register(writeTool);
      const toolSchemas = chatRegistry.toAnthropicTools(['read', 'write']);

      session.messages.push({ role: 'user', content: message });

      if (session.messages.length > MAX_SESSION_MESSAGES) {
        session.messages = session.messages.slice(-MAX_SESSION_MESSAGES);
      }

      // SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

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

        // Send text blocks as output
        const textBlocks = response.content.filter(b => b.type === 'text');
        for (const block of textBlocks) {
          res.write(`event: output\ndata: ${JSON.stringify(block.text)}\n\n`);
        }

        const toolUses = response.content.filter(b => b.type === 'tool_use');

        if (toolUses.length === 0) {
          const replyText = textBlocks.map(b => b.text).join('\n');
          const displayText = replyText || '(无回复)';
          session.messages.push({ role: 'assistant', content: displayText });
          res.write(`event: done\ndata: ${JSON.stringify(displayText)}\n\n`);
          res.end();
          return;
        }

        // Send tool_use as phase events
        for (const block of toolUses) {
          const params = JSON.stringify(block.input).slice(0, 200);
          res.write(`event: phase\ndata: ${JSON.stringify(`使用工具: ${block.name} ${params}`)}\n\n`);
        }

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

      const replyText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const displayText = replyText || '(已达最大轮数)';
      session.messages.push({ role: 'assistant', content: displayText });
      res.write(`event: done\ndata: ${JSON.stringify(displayText)}\n\n`);
      res.end();
    } catch (err) {
      const session = getSession(name);
      const errorMsg = `错误：${err.message}`;
      session.messages.push({ role: 'assistant', content: errorMsg });
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify(errorMsg)}\n\n`);
        res.end();
      } else {
        sendError(res, 500, err.message);
      }
    }
    return;
  }

  // 7. POST /api/workflows/:name/run — execute workflow via engine (SSE)
  if (method === 'POST' && parts[1] === 'api' && parts[2] === 'workflows' && parts[4] === 'run' && parts.length === 5) {
    const name = parts[3];
    const session = getSession(name);
    const userMsg = `执行 workflow "${name}"`;
    session.messages.push({ role: 'user', content: userMsg });

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

      const resultText = describeResult(result);
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

  sendError(res, 404, `Not found: ${method} ${url.pathname}`);
}

export async function createServer_(opts = {}) {
  const config = await loadConfig();
  const port = opts.port || config.serve_port || 3000;
  const projectDir = getProjectWorkflowsDir();
  const globalDir = getGlobalWorkflowsDir();
  const client = createAnthropicClient(config);
  const defaultModel = config.default_model || process.env.DEFAULT_MODEL || 'claude-sonnet-4-20250514';
  const __dirname = new URL('.', import.meta.url).pathname;
  const apiSection = await readFile(join(__dirname, 'prompts', 'dsnjs-api.md'), 'utf8');
  const systemPrompt = (await readFile(join(__dirname, 'prompts', 'dsnjs-system.md'), 'utf8')).replace('{api_section}', apiSection);
  const chatSystemTemplate = (await readFile(join(__dirname, 'prompts', 'chat-system.md'), 'utf8')).replace('{api_section}', apiSection);

  const createRegistry = new ToolRegistry();
  createRegistry.register(readTool);
  createRegistry.register(writeTool);
  createRegistry.register(bashTool);
  createRegistry.register(editTool);

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, projectDir, globalDir, client, defaultModel, systemPrompt, chatSystemTemplate, __dirname, createRegistry, config);
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
