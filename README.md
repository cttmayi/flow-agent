# Flow Agent — DSN‑JS Dynamic Workflow Agent Runtime

基于 Node.js `vm` 沙箱的 DSN‑JS 运行时，支持安全隔离的工作流执行，提供 CLI 和 Web UI。内置 Anthropic SDK 和外部 CLI（claude、codex 等）双 agent 后端。

## 安装

```bash
npm link
```

## 目录结构

```
flow-agent/
├── .flow-agent/
│   ├── config.yaml.example          — 配置文件模板
│   └── workflows/                   — DSN‑JS 工作流（每个目录一个 workflow）
│       ├── 检查/
│       │   ├── main.js              — 入口文件
│       │   ├── prompts/             — 长 prompt 文本（通过 require 引用）
│       │   └── libs/                — 可复用工具函数
│       └── my-workflow/
│           └── main.js
├── lib/
│   ├── engine.js                    — 核心引擎，CLI/Web 共用逻辑
│   ├── serve.js                     — Web 服务器（HTTP API + 静态文件）
│   ├── sandbox.js                   — vm 沙箱 + 自定义 require
│   ├── executor.js                  — 执行引擎
│   ├── config.js                    — YAML 配置加载
│   ├── agents.js                    — 内置 agent 定义（claude、codex 等）
│   ├── cache.js / logger.js         — 缓存和日志
│   ├── tools/                       — 工具注册表（bash、read、write）
│   ├── api/                         — agent/parallel/phase/checkpoint
│   │   ├── agent.js                 — Agent 工厂（分发到 internal 或 spawn）
│   │   ├── agent-anthropic.js       — Anthropic SDK provider（tool_use 循环）
│   │   └── agent-spawn.js           — 通用 CLI 子进程 provider
│   ├── prompts/                     — system prompt 模板
│   └── web/                         — Web UI 前端文件
├── cli.js                           — CLI 入口
├── runtime.js                       — 模块入口
└── README.md
```

## CLI 用法

```bash
# 执行已有工作流
flow-agent run <workflow-name>

# 生成 DSN‑JS 工作流文件
flow-agent generate <name> "<description>"

# 生成并立即执行
flow-agent generate-run <name> "<description>"

# 启动 Web UI
flow-agent serve [port]
```

## Web UI

启动 `flow-agent serve` 后在浏览器中打开 `http://localhost:3000`。

- 左侧：workflow 列表
- 中间：对话窗口（聊天修改 workflow）
- 右侧：代码面板（可拖动调整宽度、可折叠文件树、语法高亮）
- 执行时弹出进度窗口，实时显示 phase 信息

## 四大 API

| API | 签名 | 说明 |
|-----|------|------|
| agent | `agent(prompt, opts?)` | 调用 LLM，返回文本。通过 `opts.tools` 传入工具名称 |
| parallel | `parallel(tasks, opts?)` | 并发执行 async 函数数组，支持 concurrency/failFast |
| phase | `phase(name)` | 标记执行阶段 |
| checkpoint | `checkpoint(key, value?)` | 内存级缓存读写 |

### agent() 选项

- `model` — 模型名称（仅 internal provider），默认 `claude-sonnet-4-20250514`
- `tools` — 可用工具列表，如 `['bash', 'read']`。internal provider 注册 tool schema；spawn provider 映射后通过 `--tools` 传给 CLI
- `timeout` — 超时毫秒，默认 120000
- `systemPrompt` — 自定义 system prompt（仅 internal provider）

### parallel() 选项

- `concurrency` — 最大并发数，默认 5
- `failFast` — 是否快速失败，默认 true

## require() — 本地模块引用

沙箱注入自定义 `require()`，支持加载同 workflow 目录下的文件：

```js
const promptText = require('./prompts/code-review.txt');
const helper = require('./libs/helper.js');
const config = require('./config/rules.json');
```

- `.js` 在沙箱上下文中执行
- `.json` 自动 parse
- 其他文件按文本读取
- 只支持相对路径，不支持 npm 包

## 内置工具

| 工具 | 名称 | 参数 | 用途 |
|------|------|------|------|
| bash | `"bash"` | `{ command: string }` | 执行 Shell 命令 |
| read | `"read"` | `{ path: string }` | 读取文件或列出目录 |
| write | `"write"` | `{ path: string, content: string }` | 写入文件（Web UI 聊天用）|

工作流代码**禁止直接操作外围环境**，所有交互必须通过 agent 工具完成。沙箱不暴露 `fs`/`path`/`process`。

## 代理模式

配置占位 API Key（如 `sk-ant-placeholder`）时自动剥离 `x-api-key` 请求头，适用于本地代理场景。

## 配置文件

```yaml
anthropic_api_key: "YOUR_API_KEY_HERE"
base_url: "http://127.0.0.1:8080"
default_model: "claude-sonnet-4-20250514"
default_timeout: 120000
default_agent: "internal"          # "internal" | "claude" | "codex"
```

```bash
cp .flow-agent/config.yaml.example .flow-agent/config.yaml
```

### Agent 后端切换

通过 `default_agent` 切换 agent 后端：

- **`internal`** — 内置 SDK，通过 tool_use 循环调用 Anthropic API，workflow 中可指定 `tools` 注册工具
- **`claude` / `codex`** — 外部 CLI 进程，通过 `-p` 参数传递 prompt，`tools` 通过 `--tools` 参数传递

内置 agent 定义在 `lib/agents.js`，`tool_mapping` 自动将内部工具名映射为 CLI 专用名（如 `bash` → `Bash`、`write` → `Edit`）。

## 环境变量

- `ANTHROPIC_API_KEY` — 可覆盖 config.yaml（config.yaml 优先级更高）
- `ANTHROPIC_BASE_URL` — API 代理地址