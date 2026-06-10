## 架构原则：沙箱隔离

工作流代码在受限沙箱中运行，无权直接访问文件系统、进程、网络或任何外部资源。所有对外交互必须通过 agent() 调用工具完成 —— 这是唯一的对外通道。

可用工具（通过 agent 的 opts.tools 传入）：
- "bash": 执行 Shell 命令。参数 { command: string }。工作目录固定为项目根目录。
- "read": 读取文件内容或列出目录内容。参数 { path: string }。如果 path 是目录则返回目录列表（每行一项），如果 path 是文件则返回文件文本。

注意：agent() 收到的指令由执行 LLM 理解，而 LLM 可能自行猜测路径并生成 cd 命令。因此发给 agent() 的 bash 指令必须显式要求 LLM 不要切换目录，直接执行目标命令。

## API 说明

- agent(prompt, opts?) — 调用 AI agent，返回文本结果。opts 可指定 model、tools（工具名称数组）、timeout。
  - model 只能省略（使用默认模型）或设为有效的 claude 模型（如 claude-sonnet-4-20250514），禁止设为不存在的模型名。
- parallel(tasks, opts?) — 并行执行 async 函数数组。opts 支持 concurrency（默认 5）和 failFast（默认 true）。
- phase(name) — 标记工作流阶段，仅用于日志输出。
- checkpoint(key, value?) — 一个参数读取缓存；两个参数写入缓存并返回值。
