# Flow Agent — DSN‑JS Dynamic Workflow Agent Runtime

基于 Node.js `vm` 沙箱和 Anthropic SDK 的 DSN‑JS 运行时，支持安全隔离的工作流执行。

## 目录结构

```
flow-agent/
├── .flow-agent/
│   ├── config.yaml.example     — 配置文件模板（复制为 config.yaml 使用）
│   └── workflows/              — DSN‑JS 工作流存放目录
├── lib/
│   ├── prompts/                — 独立的 system prompt 模板文件
│   ├── sandbox.js              — vm 沙箱（仅注入 agent/parallel/phase/checkpoint）
│   ├── cache.js                — 内存缓存
│   ├── logger.js               — 日志工具
│   ├── executor.js             — 执行引擎
│   ├── config.js               — YAML 配置加载
│   ├── tools/                  — 工具注册表与内置工具（bash、read）
│   └── api/                    — 四大 API 实现
├── cli.js                      — CLI 入口
├── runtime.js                  — 模块入口
└── README.md
```

## 四大 API

| API | 签名 | 说明 |
|-----|------|------|
| agent | `agent(prompt, opts?)` | 调用 LLM，返回文本。通过 `opts.tools` 传入工具名称 |
| parallel | `parallel(tasks, opts?)` | 并发执行 async 函数数组，支持 concurrency/failFast |
| phase | `phase(name)` | 标记执行阶段，输出 `=== 阶段：{name} ===` |
| checkpoint | `checkpoint(key, value?)` | 内存级缓存读写 |

### agent() 选项

- `model` — 模型名称，默认 `claude-sonnet-4-20250514`
- `tools` — 可用工具列表，如 `['bash', 'read']`
- `timeout` — 超时毫秒，默认 120000
- `systemPrompt` — 自定义 system prompt，覆盖 createAgent 时设置的默认值

### parallel() 选项

- `concurrency` — 最大并发数，默认 5
- `failFast` — 是否快速失败，默认 true

## 内置工具

| 工具 | 名称 | 参数 | 用途 |
|------|------|------|------|
| bash | `"bash"` | `{ command: string }` | 执行 Shell 命令 |
| read | `"read"` | `{ path: string }` | 读取文件内容 |

工作流代码**禁止直接操作外围环境**（文件系统、进程、网络等），所有与外围环境的交互必须通过 agent 工具完成。沙箱中不注入 `fs`/`path` 等模块。

## System Prompt

生成 workflow 时使用独立的 system prompt 文件 `lib/prompts/dsnjs-system.md`，包含 API 说明、编码规则和容错原则。generate 用户消息模板在 `lib/prompts/dsnjs-generate.md`。

## 代理模式

配置占位 API Key（如 `sk-ant-placeholder`）时，SDK 会自动剥离 `x-api-key` 请求头，适用于本地代理场景。

## CLI 用法

```bash
# 执行已有工作流
node cli.js run <workflow-name>

# 生成 DSN‑JS 工作流文件
node cli.js generate <name> "<description>"

# 生成并立即执行
node cli.js generate-run <name> "<description>"
```

## 配置文件

`.flow-agent/config.yaml.example`：

```yaml
anthropic_api_key: "YOUR_API_KEY_HERE"
base_url: "http://127.0.0.1:8080"
default_model: "default"
default_timeout: 120000
```

首次使用请复制模板：

```bash
cp .flow-agent/config.yaml.example .flow-agent/config.yaml
```

> **安全提醒**：`.flow-agent/config.yaml` 已在 `.gitignore` 中，不会被提交。推荐通过 `ANTHROPIC_API_KEY` 环境变量传递密钥。

## 环境变量

- `ANTHROPIC_API_KEY` — 优先级高于配置文件

## 限制

- `checkpoint` 仅内存缓存，无持久化
- SubAgent 上下文完全隔离
- 沙箱不暴露 `fs`/`path`/`process`/`require`