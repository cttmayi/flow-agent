# DSN‑JS Dynamic Workflow Agent Runtime — 设计文档

**日期**: 2026-06-07
**状态**: v1 定稿
**规范来源**: DSN‑JS (Dynamic Script Notation‑JS) 官方规范 v1

---

## 1. 概述

实现一个完全兼容 DSN‑JS 规范的 Dynamic Workflow Agent 运行时。基于 Node.js 22+，使用 `vm` 模块构建安全沙箱，通过 Anthropic SDK 调用 LLM 执行 `agent()` 任务，支持四大核心 API、内存级缓存复用、并发控制与 CLI 交互。

### 核心能力

- **沙箱执行**: DSN‑JS 工作流在完全隔离的 `vm` 上下文中执行，禁止沙箱逃逸
- **四大 API**: `agent()`、`parallel()`、`phase()`、`checkpoint()` 严格对齐官方行为
- **工具注册表**: 可扩展的工具架构，内置 `bash`、`read` 工具，后续可轻松新增
- **生成式工作流**: 自然语言 → DSN‑JS 代码生成 → 执行 的完整闭环
- **缓存复用**: `checkpoint` 实现内存级中间结果缓存，支持断点恢复

---

## 2. 目录结构

```
flow-agent/                         # 项目根目录
├── .venv/                          # Python 虚拟环境（保留，仅供 Python 工具使用）
├── .flow-agent/
│   └── workflows/                  # DSN‑JS 工作流存放目录
│       ├── security-audit.js       # 安全审计示例工作流
│       └── code-review.js          # Code Review 示例工作流
├── lib/
│   ├── sandbox.js                  # vm 沙箱封装
│   ├── cache.js                    # 内存缓存模块
│   ├── executor.js                 # 执行引擎（Planner → Sandbox → SubAgent）
│   ├── logger.js                   # 日志/阶段输出格式化
│   ├── tools/
│   │   ├── registry.js             # 工具注册表（注册、查找、转 Anthropic 格式、执行）
│   │   ├── bash.js                 # bash 工具实现
│   │   ├── read.js                 # read 工具实现
│   │   └── template.js             # 工具扩展模板
│   └── api/
│       ├── agent.js                # agent() API
│       ├── parallel.js             # parallel() API
│       ├── phase.js                # phase() API
│       └── checkpoint.js           # checkpoint() API
├── cli.js                          # CLI 入口（run / generate / generate-run）
├── runtime.js                      # 运行时主入口，导出所有 API
├── package.json
└── README.md
```

---

## 3. 执行模型

```
┌──────────────────────────────────────────────────────────────────┐
│  CLI (cli.js)                                                    │
│  run <name> → 加载 .js 文件                                     │
│  generate <自然语言> → LLM 生成 DSN‑JS → 保存文件               │
│  generate-run <自然语言> → 生成 DSN‑JS → 保存文件 → 执行        │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Runtime (runtime.js)                                           │
│  1. 读取 workflow 源码                                           │
│  2. 通过沙箱编译为 async function                                │
│  3. 注入四大 API 实现                                            │
│  4. 执行并等待结果                                               │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Sandbox (lib/sandbox.js)                                       │
│  vm.createContext() + vm.runInNewContext()                       │
│  隔离上下文，仅暴露四大 API + JS 内置对象                         │
│  禁止: fs, process, require, fetch, import, setTimeout 等        │
└───────────────────────┬──────────────────────────────────────────┘
                        │ 用户代码调用 agent()
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  SubAgent 调度 (lib/api/agent.js + Anthropic SDK)               │
│  1. 加载 ToolRegistry 中声明的工具定义                            │
│  2. 调用 Anthropic SDK messages API (tool_use)                   │
│  3. 处理 LLM 响应 → 执行工具调用 → 结果送回 LLM                  │
│  4. 返回最终精简结果                                             │
└───────────────────────┬──────────────────────────────────────────┘
                        │ 结果返回沙箱
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  沙箱继续执行 → 下一个 agent() / parallel() / phase() /          │
│  checkpoint() 调用 → 重复直到 workflow 完成                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 模块详细设计

### 4.1 沙箱模块 — lib/sandbox.js

**职责**: 创建完全隔离的 Node.js `vm` 执行上下文。

```
- 使用 vm.createContext() 创建隔离上下文
- 注入的 API 列表：
  - 四大 API: agent, parallel, phase, checkpoint
  - JS 内置安全对象: JSON, Math, Array, Object, Map, Set,
    Promise, String, Number, Boolean, RegExp, Date,
    Error, TypeError, parseInt, parseFloat, isNaN, console
- 明确禁止: require, fs, process, global, globalThis,
  setTimeout, setInterval, fetch, import()
- 对 async workflow 使用 `(async function() { ${code} })()` 包裹
- 支持执行超时（默认 60s）
```

**关键设计点**:
- `console` 在沙箱内重定向到主进程 `console`，但仅限于 `log/warn/error`
- 所有注入对象通过手动白名单选择，不继承主进程 `global`
- 不暴露 `Buffer`、`TextEncoder` 等可能用于逃逸的 API
- `parallel()` 和 `agent()` 返回 Promise，由沙箱内代码 await

### 4.2 工具注册表 — lib/tools/registry.js

**职责**: 统一管理所有可通过 agent() 调用的工具。

```
class ToolRegistry {
  constructor()
  register(toolDef)                 // 注册工具
  get(name): ToolDef                // 按名称查找
  list(): ToolDef[]                 // 列出所有注册的工具
  getToolSchemas(names[]): object[] // 转换为 Anthropic tool_use JSON Schema
  execute(name, args): Promise<any> // 执行工具调用
}
```

**工具定义接口**:
```typescript
interface ToolDef {
  name: string;            // 工具名称，agent({ tools: ['name'] })
  description: string;     // LLM 可读的描述
  parameters: {            // JSON Schema 格式参数定义
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
  execute(args, context): Promise<any>;
}
```

**内置工具**:

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `bash` | 在沙箱中执行 Shell 命令 | `command: string` |
| `read` | 读取项目文件内容 | `path: string` |

**扩展方式**: 新建工具文件 → 实现 ToolDef 接口 → `registry.register(require('./new-tool'))`。

### 4.3 agent() — lib/api/agent.js

**职责**: 创建隔离 SubAgent，通过 Anthropic SDK 调用 LLM。

```
agent(prompt, opts?)
  → prompt: string        — 任务描述
  → opts.model?: string   — 模型名称（默认 claude-sonnet-4-20250514）
  → opts.tools?: string[] — 允许的工具列表（从 ToolRegistry 查找）
  → opts.timeout?: number — 超时（ms，默认 120000）
  → opts.worktree?: boolean — 预留
  → returns: Promise<string>  — LLM 的文本响应

返回值说明:
  - 始终返回字符串，即 LLM 对 prompt 的最终 text 响应
  - 可通过字符串方法解析结果：includes()、match()、JSON.parse() 等
  - 工具调用（tool_use）在 agent 内部自动循环处理，对调用方透明
  - 链式调用示例:
      const diff = await agent('获取 git diff', { tools: ['bash'] });
      const issues = await agent(`审查以下变更：${diff}`, { tools: ['read'] });
      if (issues.includes('严重')) {
        await agent('标记为 block 级别');
      }

SubAgent 行为:
  - 每次调用创建独立的 Anthropic SDK 会话
  - 工具声明根据 opts.tools 从 ToolRegistry 获取
  - 自动处理 tool_use → 执行 → 结果回传 循环（对调用方透明）
  - 最终返回 LLM 的 text 响应内容
  - 超时通过 AbortController 实现，超时后 reject 异常
```

### 4.4 parallel() — lib/api/parallel.js

**职责**: 并发执行一组异步任务。

```
parallel(tasks, opts?)
  → tasks: (() => Promise<any>)[]   — 任务数组
  → opts.concurrency?: number       — 最大并发数（默认 5）
  → opts.failFast?: boolean         — 是否快速失败（默认 true）
  → returns: Promise<any[]>         — 结果数组，顺序与 tasks 传入顺序一致

返回值说明:
  - 始终返回数组，每个元素对应 tasks 中同索引任务的返回值
  - 可通过解构赋值获取各结果:
      const [frontend, backend, ci] = await parallel([
        () => agent('审计前端'),
        () => agent('审计后端'),
        () => agent('审计 CI'),
      ]);
  - 可通过索引判断各结果:
      const results = await parallel([...]);
      if (results[0].includes('高危')) { ... }
  - failFast=true 时，任一任务 reject 立即抛出首个异常，取消其他任务
  - failFast=false 时，每个任务独立执行，错误在对应位置体现

行为:
  - 使用信号量模式控制并发
  - failFast=true: 任一任务 reject → 立即 AbortController.abort()
    取消所有进行中的任务，抛出首个错误
  - failFast=false: 聚合所有结果，每个任务独立执行
  - 返回顺序与 tasks 传入顺序一致
  - 每个 task 的内部错误不影响其他 task（failFast=false 时）
```

**实现策略**: 不使用第三方库，用原生 `Promise` + 队列调度实现并发控制。

### 4.5 phase() — lib/api/phase.js

**职责**: 标记执行阶段，用于可视化与调试。

```
phase(name)
  → name: string
  → returns: void
  → 输出格式: === 阶段：${name} ===
  → 无副作用，纯日志功能
```

### 4.6 checkpoint() — lib/api/checkpoint.js

**职责**: 内存级缓存，支持断点恢复与中间结果复用。

```
checkpoint(key, value?)
  → key: string
  → value?: any        — 传入则写入缓存
  → returns: Promise<any>
  → 无 value → 读取缓存，hit 返回值，miss 返回 undefined
  → 有 value → 写入缓存，返回 value
  → 纯内存，无持久化存储
```

### 4.7 缓存模块 — lib/cache.js

**职责**: 提供底层 Map 存储。

```
class Cache {
  constructor()
  has(key): boolean
  get(key): any
  set(key, value): void
  clear(): void
  keys(): string[]
}
```

- 单例模式，全局唯一缓存实例
- Node.js 单线程，无需锁

### 4.8 日志模块 — lib/logger.js

**职责**: 统一的日志输出格式化。

```
logger.phase(name)  // === 阶段：${name} ===
logger.info(msg)    // [info] msg
logger.error(msg)   // [error] msg
logger.result(data) // 格式化最终输出
```

### 4.9 执行引擎 — lib/executor.js

**职责**: 编译 DSN‑JS 源码并在沙箱中执行。

```
async function execute(code, apis, timeout?)
  → code: string       — DSN‑JS 源码
  → apis: object       — 四大 API 实现
  → timeout?: number   — 执行超时
  → returns: Promise<any>
```

### 4.10 CLI — cli.js

**职责**: 命令行接口。

| 命令 | 描述 |
|------|------|
| `node runtime.js run <name>` | 执行 `.flow-agent/workflows/<name>.js` |
| `node runtime.js generate "<自然语言>"` | 将自然语言需求转化为 DSN‑JS 代码，保存到 workflows 目录 |
| `node runtime.js generate-run "<自然语言>"` | 生成 DSN‑JS 代码 + 保存 + 立即执行 |

**generate 流程**:
1. 使用 agent()（默认带 read 工具）调用 LLM
2. LLM 以当前项目上下文为输入，生成 DSN‑JS 代码
3. 文件命名策略：将自然语言输入转为 kebab-case 作为文件名（如 "审计项目代码安全" → `security-audit.js`）。由 LLM 在生成代码时返回建议文件名
4. 将生成的代码保存到 `.flow-agent/workflows/<name>.js`
5. 向用户返回文件保存路径
6. generate-run 模式下：保存后立即走 execute 流程

---

## 5. 限制说明

- `checkpoint` 仅内存缓存，重启后丢失，无持久化
- SubAgent 上下文完全隔离，一次 agent() 调用就是一个独立 LLM 会话
- 无沙箱逃逸能力，无法在 workflow 中直接操作文件系统或网络
- `agent()` 的 worktree 选项为预留字段，当前版本不实现
- 所有工具调用必须通过 `agent()`，不支持在 workflow 中直接调用工具

---

## 6. Anthropic SDK 集成

使用 `@anthropic-ai/sdk` 包。

- 环境变量 `ANTHROPIC_API_KEY` 用于认证
- agent() 的 model 参数传入 `model` 字段
- tools 参数通过 ToolRegistry 转换为 Anthropic `tools` 数组格式
- 自动处理 tool_use 循环（LLM 请求工具 → 执行 → 结果送回 → LLM 继续）
- 响应截断：当工具结果过大时截断到 20000 字符

---

## 7. 示例工作流

### security-audit.js

展示完整的四大 API 使用、并行执行、缓存复用：

```javascript
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

### code-review.js

展示缓存断点恢复和模型选择：

```javascript
phase('diff 分析');
const diff = await agent('获取当前分支的 git diff，分析变更范围', {
  tools: ['bash']
});

const cached = await checkpoint('review-result');
if (cached) {
  phase('使用缓存结果');
  return cached;
}

phase('逐文件审查');
const issues = await agent(`审查以下代码变更：${diff}`, {
  model: 'claude-sonnet-4-6',
  timeout: 120000
});

phase('生成总结');
const summary = await agent(
  '将审查结果整理为 PR Review 格式，包含：严重问题、建议、评分'
);
await checkpoint('review-result', summary);
```