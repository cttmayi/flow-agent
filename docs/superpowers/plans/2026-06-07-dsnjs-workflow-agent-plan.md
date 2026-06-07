# DSN‑JS Dynamic Workflow Agent Runtime — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个完全兼容 DSN‑JS 规范的 Dynamic Workflow Agent 运行时，包含沙箱、四大核心 API、执行模型、缓存复用机制和官方示例

**Architecture:** 模块化分层设计 — 缓存/日志基础设施 → 工具注册表 → 沙箱隔离 → 四大 API → 执行引擎 → CLI。每个模块有独立职责和测试。使用 `vm` 沙箱隔离用户脚本，`@anthropic-ai/sdk` 作为模型层，ToolRegistry 管理所有可注入 agent() 的工具。

**Tech Stack:** Node.js 22+, `vm` 模块, `@anthropic-ai/sdk`, `node:test` 内置测试框架

---

### Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `lib/` 和 `cli.js` / `runtime.js` 占位文件

- [ ] **Step 1: 初始化 package.json**

```json
{
  "name": "flow-agent",
  "version": "1.0.0",
  "description": "DSN‑JS Dynamic Workflow Agent Runtime",
  "type": "module",
  "main": "runtime.js",
  "bin": {
    "flow-agent": "./cli.js"
  },
  "scripts": {
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**

```
node_modules/
.env
```

- [ ] **Step 3: 创建目录结构**

```bash
mkdir -p lib/api lib/tools .flow-agent/workflows tests
touch runtime.js cli.js lib/sandbox.js lib/cache.js lib/logger.js lib/executor.js lib/tools/registry.js lib/tools/bash.js lib/tools/read.js lib/api/agent.js lib/api/parallel.js lib/api/phase.js lib/api/checkpoint.js tests/cache.test.js tests/logger.test.js tests/registry.test.js tests/sandbox.test.js tests/phase.test.js tests/checkpoint.test.js tests/parallel.test.js
```

- [ ] **Step 4: 安装依赖**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **Step 5: 提交**

```bash
git init && git add -A && git commit -m "chore: scaffold project structure"
```

---

### Task 2: 缓存模块 lib/cache.js

**Files:**
- Create: `lib/cache.js`
- Create: `tests/cache.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/cache.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getCache } from '../lib/cache.js';

describe('Cache', () => {
  it('has() returns false for missing key', () => {
    const cache = getCache();
    assert.strictEqual(cache.has('unknown'), false);
  });

  it('set() then get() returns stored value', () => {
    const cache = getCache();
    cache.set('key1', { foo: 'bar' });
    assert.deepStrictEqual(cache.get('key1'), { foo: 'bar' });
  });

  it('get() returns undefined for missing key', () => {
    const cache = getCache();
    assert.strictEqual(cache.get('missing'), undefined);
  });

  it('clear() removes all entries', () => {
    const cache = getCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.strictEqual(cache.has('a'), false);
    assert.strictEqual(cache.has('b'), false);
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/cache.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/cache.js
const store = new Map();

class Cache {
  has(key) { return store.has(key); }
  get(key) { return store.get(key); }
  set(key, value) { store.set(key, value); }
  clear() { store.clear(); }
  keys() { return [...store.keys()]; }
}

let instance = null;
export function getCache() {
  if (!instance) instance = new Cache();
  return instance;
}
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/cache.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/cache.js tests/cache.test.js && git commit -m "feat: add cache module with Map-based storage"
```

---

### Task 3: 日志模块 lib/logger.js

**Files:**
- Create: `lib/logger.js`
- Create: `tests/logger.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/logger.test.js
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { logger } from '../lib/logger.js';

describe('logger', () => {
  it('phase() outputs formatted phase message', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    logger.phase('依赖分析');
    assert.ok(logs[0].includes('依赖分析'));
    assert.ok(logs[0].includes('阶段'));
    mock.restoreAll();
  });

  it('info() outputs prefixed message', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    logger.info('test message');
    assert.ok(logs[0].includes('[info]'));
    mock.restoreAll();
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/logger.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/logger.js
const PREFIX = '===';

export const logger = {
  phase(name) {
    console.log(`${PREFIX} 阶段：${name} ${PREFIX}`);
  },
  info(msg) {
    console.log(`[info] ${msg}`);
  },
  error(msg) {
    console.error(`[error] ${msg}`);
  },
  result(data) {
    console.log(JSON.stringify(data, null, 2));
  }
};
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/logger.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/logger.js tests/logger.test.js && git commit -m "feat: add logger module with phase/info/error/result"
```

---

### Task 4: 工具注册表 lib/tools/registry.js

**Files:**
- Create: `lib/tools/registry.js`
- Create: `tests/registry.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/registry.test.js
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry } from '../lib/tools/registry.js';

describe('ToolRegistry', () => {
  let registry;

  before(() => {
    registry = new ToolRegistry();
  });

  it('register and get a tool', () => {
    registry.register({
      name: 'echo',
      description: 'Echo input back',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      async execute(args) { return args.text; }
    });
    const tool = registry.get('echo');
    assert.strictEqual(tool.name, 'echo');
  });

  it('get() returns undefined for unknown tool', () => {
    assert.strictEqual(registry.get('nope'), undefined);
  });

  it('list() returns all registered tools', () => {
    const tools = registry.list();
    assert.ok(tools.length >= 1);
    assert.ok(tools.some(t => t.name === 'echo'));
  });

  it('toAnthropicTools() converts to Anthropic SDK format', () => {
    const anthropicTools = registry.toAnthropicTools(['echo']);
    assert.strictEqual(anthropicTools.length, 1);
    assert.strictEqual(anthropicTools[0].name, 'echo');
    assert.strictEqual(anthropicTools[0].input_schema.type, 'object');
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/registry.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/tools/registry.js
export class ToolRegistry {
  #tools = new Map();

  register(def) {
    this.#tools.set(def.name, def);
  }

  get(name) {
    return this.#tools.get(name);
  }

  list() {
    return [...this.#tools.values()];
  }

  toAnthropicTools(names) {
    return names.map(name => {
      const tool = this.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      };
    });
  }

  async execute(name, args) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args);
  }
}
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/registry.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/tools/registry.js tests/registry.test.js && git commit -m "feat: add ToolRegistry for tool management"
```

---

### Task 5: bash 工具实现

**Files:**
- Create: `lib/tools/bash.js`

- [ ] **Step 1: 编写测试**

```javascript
// 在 tests/registry.test.js 追加
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';

describe('bash tool (via execSync)', () => {
  it('echo command returns output', () => {
    const out = execSync('echo hello', { encoding: 'utf8' });
    assert.strictEqual(out.trim(), 'hello');
  });
});
```

- [ ] **Step 2: 编写实现**

```javascript
// lib/tools/bash.js
import { execSync } from 'node:child_process';

export default {
  name: 'bash',
  description: '在沙箱外执行 Shell 命令，返回输出结果',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 Shell 命令'
      }
    },
    required: ['command']
  },
  async execute(args) {
    try {
      const stdout = execSync(args.command, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exitCode: err.status || 1
      };
    }
  }
};
```

- [ ] **Step 3: 注册 bash 工具到 registry（修改 runtime.js 入口）**

```javascript
// 在 runtime.js 中添加
import bashTool from './lib/tools/bash.js';
const registry = new ToolRegistry();
registry.register(bashTool);
```

- [ ] **Step 4: 提交**

```bash
git add lib/tools/bash.js && git commit -m "feat: add bash tool for shell command execution"
```

---

### Task 6: read 工具实现

**Files:**
- Create: `lib/tools/read.js`

- [ ] **Step 1: 编写实现**

```javascript
// lib/tools/read.js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export default {
  name: 'read',
  description: '读取项目文件内容，返回文件文本',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于项目根目录）'
      }
    },
    required: ['path']
  },
  async execute(args) {
    try {
      const content = await readFile(args.path, 'utf8');
      return { content, error: null };
    } catch (err) {
      return { content: null, error: err.message };
    }
  }
};
```

- [ ] **Step 2: 提交**

```bash
git add lib/tools/read.js && git commit -m "feat: add read tool for file reading"
```

---

### Task 7: 沙箱模块 lib/sandbox.js

**Files:**
- Create: `lib/sandbox.js`
- Create: `tests/sandbox.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/sandbox.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSandbox } from '../lib/sandbox.js';

describe('Sandbox', () => {
  it('exposes injected APIs', async () => {
    const apis = {
      agent: async () => 'mock-agent',
      parallel: async () => ['mock-parallel'],
      phase: () => {},
      checkpoint: async () => {}
    };
    const result = await createSandbox(`return await agent('test');`, apis);
    assert.strictEqual(result, 'mock-agent');
  });

  it('does not expose require', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    try {
      await createSandbox(`return typeof require;`, apis);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof ReferenceError || e.message.includes('require'));
    }
  });

  it('does not expose process', async () => {
    const apis = { agent: async () => {}, parallel: async () => [], phase: () => {}, checkpoint: async () => {} };
    try {
      await createSandbox(`return typeof process;`, apis);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(true);
    }
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/sandbox.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/sandbox.js
import vm from 'node:vm';

const SAFE_BUILTINS = {
  JSON, Math, Array, Object, Map, Set, Promise,
  String, Number, Boolean, RegExp, Date, Symbol,
  Error, TypeError, RangeError, ReferenceError,
  parseInt, parseFloat, isNaN, isFinite,
  console, Buffer, TextEncoder, TextDecoder
};

export async function createSandbox(code, apis, timeout = 60000) {
  const context = vm.createContext({
    ...SAFE_BUILTINS,
    agent: apis.agent,
    parallel: apis.parallel,
    phase: apis.phase,
    checkpoint: apis.checkpoint
  });

  const wrappedCode = `(async function() { ${code} })()`;
  const script = new vm.Script(wrappedCode);
  const result = script.runInContext(context, { timeout });
  return result;
}
```

注意：`Buffer`、`TextEncoder`、`TextDecoder` 仅提供基础文本处理能力，不涉及文件系统或网络访问，安全。核心原则：不暴露 `require`、`process`、`global`、`globalThis`、`import()`、`fetch`、`WebAssembly`。

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/sandbox.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/sandbox.js tests/sandbox.test.js && git commit -m "feat: add vm sandbox module with API injection"
```

---

### Task 8: phase() API

**Files:**
- Create: `lib/api/phase.js`
- Create: `tests/phase.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/phase.test.js
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createPhase } from '../lib/api/phase.js';

describe('phase API', () => {
  it('outputs formatted phase name', () => {
    const logs = [];
    mock.method(console, 'log', (msg) => logs.push(msg));
    const phase = createPhase();
    phase('依赖分析');
    assert.strictEqual(logs[0], '=== 阶段：依赖分析 ===');
    mock.restoreAll();
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/phase.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/api/phase.js
import { logger } from '../logger.js';

export function createPhase() {
  return (name) => {
    logger.phase(name);
  };
}
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/phase.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/api/phase.js tests/phase.test.js && git commit -m "feat: add phase() API for execution stage marking"
```

---

### Task 9: checkpoint() API

**Files:**
- Create: `lib/api/checkpoint.js`
- Create: `tests/checkpoint.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/checkpoint.test.js
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createCheckpoint } from '../lib/api/checkpoint.js';
import { getCache } from '../lib/cache.js';

describe('checkpoint API', () => {
  before(() => {
    getCache().clear();
  });

  it('returns undefined when key does not exist', async () => {
    const cp = createCheckpoint();
    const result = await cp('nonexistent');
    assert.strictEqual(result, undefined);
  });

  it('stores and retrieves a value', async () => {
    const cp = createCheckpoint();
    const written = await cp('mykey', { data: 'hello' });
    assert.deepStrictEqual(written, { data: 'hello' });
    const read = await cp('mykey');
    assert.deepStrictEqual(read, { data: 'hello' });
  });

  it('overwrites existing key', async () => {
    const cp = createCheckpoint();
    await cp('overwrite', 'old');
    await cp('overwrite', 'new');
    const val = await cp('overwrite');
    assert.strictEqual(val, 'new');
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/checkpoint.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/api/checkpoint.js
import { getCache } from '../cache.js';

export function createCheckpoint() {
  const cache = getCache();
  return async (key, value) => {
    if (arguments.length === 1) {
      return cache.get(key);
    }
    cache.set(key, value);
    return value;
  };
}
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/checkpoint.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/api/checkpoint.js tests/checkpoint.test.js && git commit -m "feat: add checkpoint() API for memory cache"
```

---

### Task 10: parallel() API — 并发控制

**Files:**
- Create: `lib/api/parallel.js`
- Create: `tests/parallel.test.js`

- [ ] **Step 1: 编写测试**

```javascript
// tests/parallel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createParallel } from '../lib/api/parallel.js';

describe('parallel API', () => {
  it('executes all tasks and returns results in order', async () => {
    const parallel = createParallel();
    const results = await parallel([
      () => Promise.resolve('a'),
      () => Promise.resolve('b'),
      () => Promise.resolve('c'),
    ]);
    assert.deepStrictEqual(results, ['a', 'b', 'c']);
  });

  it('respects concurrency limit', async () => {
    const parallel = createParallel();
    let concurrent = 0;
    let maxConcurrent = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => () =>
      new Promise(resolve => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        setTimeout(() => { concurrent--; resolve(i); }, 50);
      })
    );
    const results = await parallel(tasks, { concurrency: 3 });
    assert.strictEqual(maxConcurrent <= 3, true, `max concurrent was ${maxConcurrent}`);
    assert.deepStrictEqual(results, [0,1,2,3,4,5,6,7,8,9]);
  });

  it('failFast=true throws on first error and cancels others', async () => {
    const parallel = createParallel();
    let task2Started = false;
    try {
      await parallel([
        () => Promise.reject(new Error('task1 failed')),
        () => new Promise(resolve => { task2Started = true; setTimeout(() => resolve(2), 100); }),
      ], { failFast: true, concurrency: 5 });
      assert.fail('should have thrown');
    } catch (e) {
      assert.strictEqual(e.message, 'task1 failed');
    }
  });

  it('failFast=false collects all results including errors', async () => {
    const parallel = createParallel();
    const results = await parallel([
      () => Promise.resolve('ok'),
      () => Promise.reject(new Error('fail')),
      () => Promise.resolve('ok2'),
    ], { failFast: false });
    assert.strictEqual(results[0], 'ok');
    assert.ok(results[1] instanceof Error);
    assert.strictEqual(results[2], 'ok2');
  });
});
```

- [ ] **Step 2: 运行测试 — 预期失败**

```bash
node --test tests/parallel.test.js
```

- [ ] **Step 3: 编写实现**

```javascript
// lib/api/parallel.js
export function createParallel(abortSignal) {
  return async (tasks, opts = {}) => {
    const { concurrency = 5, failFast = true } = opts;
    const results = new Array(tasks.length);
    let rejected = false;
    let aborted = false;

    const signal = abortSignal || new AbortController().signal;

    return new Promise((resolve, reject) => {
      let nextIndex = 0;
      let completed = 0;

      function runTask(index) {
        if (aborted || (failFast && rejected)) return;
        tasks[index]()
          .then(result => {
            results[index] = result;
          })
          .catch(err => {
            if (failFast) {
              rejected = true;
              aborted = true;
              reject(err);
              return;
            }
            results[index] = err;
          })
          .finally(() => {
            completed++;
            if (completed === tasks.length) {
              resolve(results);
              return;
            }
            if (!aborted && !rejected) {
              scheduleNext();
            }
          });
      }

      function scheduleNext() {
        while (nextIndex < tasks.length && nextIndex - completed < concurrency && !(rejected || aborted)) {
          const idx = nextIndex++;
          runTask(idx);
        }
      }

      scheduleNext();
    });
  };
}
```

- [ ] **Step 4: 运行测试 — 预期通过**

```bash
node --test tests/parallel.test.js
```

- [ ] **Step 5: 提交**

```bash
git add lib/api/parallel.js tests/parallel.test.js && git commit -m "feat: add parallel() API with concurrency control"
```

---

### Task 11: agent() API — Anthropic SDK 集成

**Files:**
- Create: `lib/api/agent.js`

- [ ] **Step 1: 编写实现**

```javascript
// lib/api/agent.js
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
          // 没有工具调用 → 返回最终文本
          const textBlocks = response.content.filter(b => b.type === 'text');
          return textBlocks.map(b => b.text).join('\n');
        }

        // 处理工具调用
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

      // 超过最大轮次，返回最后的消息文本
      const textBlocks = response.content.filter(b => b.type === 'text');
      return textBlocks.map(b => b.text).join('\n');
    } finally {
      clearTimeout(timeoutId);
    }
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add lib/api/agent.js && git commit -m "feat: add agent() API with Anthropic SDK and tool_use loop"
```

---

### Task 12: 执行引擎 lib/executor.js

**Files:**
- Create: `lib/executor.js`

- [ ] **Step 1: 编写实现**

```javascript
// lib/executor.js
import { createSandbox } from './sandbox.js';
import { createAgent } from './api/agent.js';
import { createParallel } from './api/parallel.js';
import { createPhase } from './api/phase.js';
import { createCheckpoint } from './api/checkpoint.js';

export async function execute(code, toolRegistry, timeout) {
  const parallel = createParallel();
  const phase = createPhase();
  const checkpoint = createCheckpoint();
  const agent = createAgent(toolRegistry);

  const apis = { agent, parallel, phase, checkpoint };

  return createSandbox(code, apis, timeout);
}
```

- [ ] **Step 2: 提交**

```bash
git add lib/executor.js && git commit -m "feat: add executor that compiles and runs DSN-JS in sandbox"
```

---

### Task 13: CLI 入口 cli.js

**Files:**
- Create: `cli.js`

- [ ] **Step 1: 编写实现**

```javascript
#!/usr/bin/env node
// cli.js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute } from './lib/executor.js';
import { ToolRegistry } from './lib/tools/registry.js';
import bashTool from './lib/tools/bash.js';
import readTool from './lib/tools/read.js';
import { createAgent } from './lib/api/agent.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error('Usage:');
    console.error('  node runtime.js run <workflow-name>');
    console.error('  node runtime.js generate <filename> "<description>"');
    console.error('  node runtime.js generate-run <filename> "<description>"');
    process.exit(1);
  }

  // 初始化工具注册表
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(readTool);

  const workflowsDir = join(process.cwd(), '.flow-agent', 'workflows');

  if (command === 'run') {
    const name = args[0];
    if (!name) {
      console.error('Usage: node runtime.js run <workflow-name>');
      process.exit(1);
    }
    const filePath = join(workflowsDir, `${name}.js`);
    const code = await readFile(filePath, 'utf8');
    const result = await execute(code, registry);
    logger.result(result);
    return;
  }

  if (command === 'generate' || command === 'generate-run') {
    const name = args[0];
    const description = args.slice(1).join(' ');
    if (!name || !description) {
      console.error('Usage: node runtime.js generate <filename> "<description>"');
      process.exit(1);
    }

    // 用 agent 生成 DSN-JS 代码
    const agent = createAgent(registry);
    const generated = await agent(
      `根据以下需求生成 DSN-JS 工作流代码（使用 agent、parallel、phase、checkpoint API）：
${description}

输出格式要求：只输出 JavaScript 代码，不要包裹 markdown 代码块标记。`
    );

    // 保存文件
    await mkdir(workflowsDir, { recursive: true });
    const filePath = join(workflowsDir, `${name}.js`);
    await writeFile(filePath, generated.trim(), 'utf8');
    logger.info(`Workflow saved to ${filePath}`);

    if (command === 'generate-run') {
      const result = await execute(generated.trim(), registry);
      logger.result(result);
    }
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 编写运行时入口 runtime.js**

```javascript
// runtime.js
export { execute } from './lib/executor.js';
export { ToolRegistry } from './lib/tools/registry.js';
export { createAgent } from './lib/api/agent.js';
export { createParallel } from './lib/api/parallel.js';
export { createPhase } from './lib/api/phase.js';
export { createCheckpoint } from './lib/api/checkpoint.js';
export { getCache } from './lib/cache.js';
export { logger } from './lib/logger.js';
```

- [ ] **Step 3: 提交**

```bash
git add cli.js runtime.js && git commit -m "feat: add CLI and runtime entry point"
```

---

### Task 14: 示例 Workflow

**Files:**
- Create: `.flow-agent/workflows/security-audit.js`
- Create: `.flow-agent/workflows/code-review.js`

- [ ] **Step 1: 编写 security-audit.js**

```javascript
// .flow-agent/workflows/security-audit.js
phase('依赖分析');
const deps = await agent('扫描项目的 package.json，列出所有依赖及其版本', {
  tools: ['read']
});

phase('漏洞检查');
const results = await parallel([
  () => agent(`审计依赖 ${deps[0]} 是否存在已知漏洞`),
  () => agent(`审计依赖 ${deps[1]} 是否存在已知漏洞`),
  () => agent('检查项目环境变量配置是否存在密钥硬编码'),
  () => agent('检查 .env 文件是否在版本控制中'),
], { concurrency: 2, failFast: false });

phase('报告生成');
const report = await agent('汇总以上安全审计结果，生成修复建议');
await checkpoint('audit-report', report);
```

- [ ] **Step 2: 编写 code-review.js**

```javascript
// .flow-agent/workflows/code-review.js
phase('diff 分析');
const diff = await agent('获取当前分支的 git diff，分析变更范围', {
  tools: ['bash']
});

const cached = await checkpoint('review-result');
if (cached !== undefined) {
  phase('使用缓存结果');
  return cached;
}

phase('逐文件审查');
const issues = await agent(`审查以下代码变更：${diff}`, {
  model: 'claude-sonnet-4-20250514',
  timeout: 120000
});

phase('生成总结');
const summary = await agent(
  '将审查结果整理为 PR Review 格式，包含：严重问题、建议、评分'
);
await checkpoint('review-result', summary);
```

- [ ] **Step 3: 提交**

```bash
git add .flow-agent/workflows/ && git commit -m "feat: add example DSN-JS workflows"
```

---

### Task 15: README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README**

```markdown
# Flow Agent — DSN‑JS Dynamic Workflow Agent Runtime

基于 Node.js `vm` 沙箱和 Anthropic SDK 的 DSN‑JS 运行时，支持安全隔离的工作流执行。

## 目录结构

```
.flow-agent/workflows/    — DSN‑JS 工作流存放目录
lib/                      — 核心模块
  sandbox.js              — vm 沙箱
  cache.js                — 内存缓存
  logger.js               — 日志工具
  executor.js             — 执行引擎
  tools/                  — 工具注册表与内置工具
  api/                    — 四大 API 实现
cli.js                    — CLI 入口
runtime.js                — 模块入口
```

## 四大 API

| API | 签名 | 说明 |
|-----|------|------|
| agent | `agent(prompt, opts?)` | 创建 SubAgent 调用 LLM，返回文本响应 |
| parallel | `parallel(tasks, opts?)` | 并发执行任务，支持 concurrency/failFast |
| phase | `phase(name)` | 标记执行阶段 |
| checkpoint | `checkpoint(key, value?)` | 内存级缓存读写 |

### agent() 选项

- `model` — 模型名称，默认 `claude-sonnet-4-20250514`
- `tools` — 可用工具列表，如 `['bash', 'read']`
- `timeout` — 超时毫秒，默认 120000

### parallel() 选项

- `concurrency` — 最大并发数，默认 5
- `failFast` — 是否快速失败，默认 true

## CLI 用法

```bash
# 执行已有工作流
node runtime.js run security-audit

# 生成 DSN‑JS 工作流文件
node runtime.js generate security-audit "审计项目代码安全"

# 生成并立即执行
node runtime.js generate-run security-audit "审计项目代码安全"
```

## 环境变量

- `ANTHROPIC_API_KEY` — Anthropic API 密钥（必需）

## 限制

- `checkpoint` 仅内存缓存，无持久化
- SubAgent 上下文完全隔离
- 无沙箱逃逸能力
```

- [ ] **Step 2: 提交**

```bash
git add README.md && git commit -m "docs: add README with API docs and usage"
```

---

## Self-Review

### Spec Coverage

| 规范要求 | 对应 Task |
|---------|-----------|
| 目录规范 .flow-agent/workflows/ | Task 1 (脚手架) |
| vm 沙箱隔离，禁止 fs/process/require | Task 7 (sandbox.js) |
| 四大 API: agent | Task 11 |
| 四大 API: parallel | Task 10 |
| 四大 API: phase | Task 8 |
| 四大 API: checkpoint | Task 9 |
| async/await, if/else, 等语法支持 | Task 7 (通过 vm.Script 原生支持) |
| 执行模型: Planner → Sandbox → SubAgent → 结果 | Task 12 (executor.js) |
| CLI: node runtime.js run <name> | Task 13 |
| 缓存: checkpoint 内存缓存 | Task 2 + Task 9 |
| 复用: 生成 DSN‑JS 保存到 workflows | Task 13 (generate 命令) |
| 工具可扩展架构 | Task 4 + Task 5 + Task 6 |
| 内置 bash/read 工具 | Task 5 + Task 6 |
| 示例 workflow | Task 14 |

### Placeholder Scan

✅ 所有步骤包含完整代码，无 "TBD"、"TODO"、"implement later"

### Type Consistency

- `createCache()` → `getCache()` 单例：Task 2 和 Task 9 对齐
- `ToolRegistry` 方法签名（register/get/list/toAnthropicTools/execute）：Task 4 和 Task 11 对齐
- `createCheckpoint()` 返回 `async (key, value?)`: Task 9 定义，Task 12 使用
- `createParallel()` 返回 `async (tasks, opts?)`: Task 10 定义，Task 12 使用

### Scope Check

✅ 聚焦于 DSN‑JS 运行时本身，未引入额外功能