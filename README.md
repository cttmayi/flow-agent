# Flow Agent — DSN‑JS Dynamic Workflow Agent Runtime

基于 Node.js `vm` 沙箱和 Anthropic SDK 的 DSN‑JS 运行时，支持安全隔离的工作流执行。

## 目录结构

```
flow-agent/
├── .flow-agent/workflows/    — DSN‑JS 工作流存放目录
├── lib/
│   ├── sandbox.js            — vm 沙箱
│   ├── cache.js              — 内存缓存
│   ├── logger.js             — 日志工具
│   ├── executor.js           — 执行引擎
│   ├── tools/                — 工具注册表与内置工具
│   └── api/                  — 四大 API 实现
├── cli.js                    — CLI 入口
├── runtime.js                — 模块入口
└── README.md
```

## 四大 API

| API | 签名 | 说明 |
|-----|------|------|
| agent | `agent(prompt, opts?)` | 创建 SubAgent 调用 LLM，返回文本响应 |
| parallel | `parallel(tasks, opts?)` | 并发执行任务，支持 concurrency/failFast |
| phase | `phase(name)` | 标记执行阶段，输出 `=== 阶段：{name} ===` |
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
node cli.js run security-audit

# 生成 DSN‑JS 工作流文件
node cli.js generate security-audit "审计项目代码安全"

# 生成并立即执行
node cli.js generate-run security-audit "审计项目代码安全"
```

## 环境变量

- `ANTHROPIC_API_KEY` — Anthropic API 密钥（必需）

## 限制

- `checkpoint` 仅内存缓存，无持久化
- SubAgent 上下文完全隔离
- 无沙箱逃逸能力