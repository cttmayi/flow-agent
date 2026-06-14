// lib/engine.js — 核心引擎，封装运行时初始化、工作流执行与生成
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './executor.js';
import { ToolRegistry } from './tools/registry.js';
import bashTool from './tools/bash.js';
import readTool from './tools/read.js';
import writeTool from './tools/write.js';
import editTool from './tools/edit.js';
import { createAgent } from './api/agent.js';
import { loadConfig, getGlobalWorkflowsDir, getProjectWorkflowsDir } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveApiKey(config) {
  // 配置文件优先，环境变量可覆盖
  if (config.anthropic_api_key &&
      config.anthropic_api_key !== 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    process.env.ANTHROPIC_API_KEY = config.anthropic_api_key;
  } else if (!process.env.ANTHROPIC_API_KEY) {
    // 代理模式：设一个占位 key 绕过 SDK 格式校验
    process.env.ANTHROPIC_API_KEY = 'sk-ant-placeholder';
  }
}

function createToolRegistry() {
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  return registry;
}

export async function createEngine() {
  const config = await loadConfig();
  resolveApiKey(config);

  const agentOpts = {
    baseURL: config.base_url,
    defaultModel: config.default_model,
    defaultTimeout: config.default_timeout,
    defaultAgent: config.default_agent,
  };

  const registry = createToolRegistry();

  const globalWorkflowsDir = getGlobalWorkflowsDir();
  const projectWorkflowsDir = getProjectWorkflowsDir();

  async function loadPrompt(name) {
    return readFile(join(__dirname, 'lib', 'prompts', name), 'utf8');
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

  return {
    /** Resolve workflow to { code, workflowDir, source } — searches project then global */
    async resolveWorkflow(name) {
      // Try project first
      const projectDir = join(projectWorkflowsDir, name);
      const projectFile = join(projectWorkflowsDir, `${name}.js`);
      try {
        const s = await stat(projectDir);
        if (s.isDirectory()) {
          const code = await readFile(join(projectDir, 'main.js'), 'utf8');
          return { code, workflowDir: projectDir, source: 'project' };
        }
      } catch { /* not a directory */ }
      try {
        const code = await readFile(projectFile, 'utf8');
        return { code, workflowDir: undefined, source: 'project' };
      } catch { /* not found */ }

      // Fallback to global
      const globalDir = join(globalWorkflowsDir, name);
      const globalFile = join(globalWorkflowsDir, `${name}.js`);
      try {
        const s = await stat(globalDir);
        if (s.isDirectory()) {
          const code = await readFile(join(globalDir, 'main.js'), 'utf8');
          return { code, workflowDir: globalDir, source: 'global' };
        }
      } catch { /* not a directory */ }
      const code = await readFile(globalFile, 'utf8');
      return { code, workflowDir: undefined, source: 'global' };
    },

    /** 执行已保存的 workflow */
    async run(name, onPhase, onAgentOutput) {
      const { code, workflowDir } = await this.resolveWorkflow(name);
      return execute(code, registry, agentOpts, undefined, workflowDir, onPhase, onAgentOutput);
    },

    /** 生成 workflow 文件，返回 { code, filePath } */
    async generate(name, description, onProgress) {
      const apiSection = await loadPrompt('dsnjs-api.md');
      const DSN_JS_SYSTEM_PROMPT = (await loadPrompt('dsnjs-system.md')).replace('{api_section}', apiSection);
      const generatePromptTmpl = await loadPrompt('dsnjs-generate.md');

      const agent = createAgent(registry, { ...agentOpts, systemPrompt: DSN_JS_SYSTEM_PROMPT });
      const generated = await agent(
        generatePromptTmpl.replace('{description}', description),
        { tools: ['bash', 'read'], onProgress }
      );

      const code = extractCodeBlock(generated);

      await mkdir(projectWorkflowsDir, { recursive: true });
      const workflowDir = join(projectWorkflowsDir, name);
      await mkdir(workflowDir, { recursive: true });

      // Parse multi-file output: ```lang:path\ncontent\n```
      const fileBlocks = generated.match(/```[\w]*:[^\n]+\n[\s\S]*?\n```/g);
      if (fileBlocks && fileBlocks.length > 1) {
        let mainContent = '';
        for (const block of fileBlocks) {
          const firstLineEnd = block.indexOf('\n');
          const header = block.slice(3, firstLineEnd);
          const colonIdx = header.indexOf(':');
          const relPath = header.slice(colonIdx + 1).trim();
          const content = block.slice(firstLineEnd + 1, -3);

          const targetPath = join(workflowDir, relPath);
          await mkdir(targetPath.replace(/\/[^/]+$/, ''), { recursive: true });
          await writeFile(targetPath, content, 'utf8');

          if (relPath === 'main.js') mainContent = content;
        }
        const filePath = join(workflowDir, 'main.js');
        return { code: mainContent, filePath };
      }

      // Single file output
      const filePath = join(workflowDir, 'main.js');
      await writeFile(filePath, code, 'utf8');

      return { code, filePath };
    },

    /** 执行原始 workflow 代码 */
    async execute(code) {
      return execute(code, registry, agentOpts);
    },

    /** 获取项目 workflows 目录路径 */
    getWorkflowsDir() {
      return projectWorkflowsDir;
    },

    /** 获取全局 workflows 目录路径 */
    getGlobalWorkflowsDir() {
      return globalWorkflowsDir;
    },
  };
}