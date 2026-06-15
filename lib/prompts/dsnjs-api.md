## 架构原则：沙箱隔离

工作流代码在受限沙箱中运行，无权直接访问文件系统、进程、网络或任何外部资源。所有对外交互必须通过 agent() 调用工具完成 —— 这是唯一的对外通道。

可用工具（通过 agent 的 opts.tools 传入）：
- "bash": 执行 Shell 命令。参数 { command: string }。工作目录固定为项目根目录。
- "read": 读取文件内容或列出目录内容。参数 { path: string }。如果 path 是目录则返回目录列表（每行一项），如果 path 是文件则返回文件文本。

注意：agent() 收到的指令由执行 LLM 理解，而 LLM 可能自行猜测路径并生成 cd 命令。因此发给 agent() 的 bash 指令必须显式要求 LLM 不要切换目录，直接执行目标命令。

## API 说明

- tool(name, params) — 直接执行已注册的工具，不经过 LLM。name 是工具名称（如 "bash"、"read"、"write"），params 是工具参数对象。返回工具执行结果对象。
  - 相比 agent()，tool() 没有 LLM 开销，适合确定性操作（读文件、执行命令等）。
  - **返回值格式：** 每个工具返回不同的对象结构（read 返回 `{ content, error }`，bash 返回 `{ stdout, stderr, exitCode }` 等）。必须通过属性访问结果，如 `result.content`、`result.stdout`。
  - 示例：`const out = await tool("bash", { command: "ls src/" }); const files = out.stdout.trim();`
  - 示例：`const f = await tool("read", { path: "config.json" }); const cfg = JSON.parse(f.content);`
- agent(prompt, opts?) — 调用 AI agent，返回文本结果。opts 可指定 model、tools（工具名称数组）、timeout、format。
  - model 只能省略（使用默认模型）或设为有效的 claude 模型（如 claude-sonnet-4-20250514），禁止设为不存在的模型名。
  - format 控制返回值格式。可选值：
    - 不传或 "text"（默认）— 返回原始文本
    - "json" — 返回解析后的 JSON 对象/数组。LLM 输出不是合法 JSON 时会自动重试（最多 3 次）。示例：
      ```js
      const data = await agent("分析项目结构", { tools: ["bash"], format: "json" });
      ```
    - "code" — 提取 markdown 代码块内容，去掉 ``` 包裹标记。示例：
      ```js
      const fn = await agent("写一个排序函数", { format: "code" });
      ```
- parallel(tasks, opts?) — 并行执行 async 函数数组。opts 支持 concurrency（默认 5）和 failFast（默认 true）。
- phase(name) — 标记工作流阶段，仅用于日志输出。
- checkpoint(key, value?) — 一个参数读取缓存；两个参数写入缓存并返回值。
- args — 工作流执行时传入的字符串参数（通过聊天输入框中斜杠命令 `/workflow名称 参数...` 传入）。如果没有参数则为空字符串 `""`。
  - 示例：输入 `/translate Hello world` 执行时，workflow 中 `args === "Hello world"`。
- require(modulePath) — 加载同一 workflow 目录下的本地模块。modulePath 必须是相对路径。
  - 加载 `.js` 文件，在同一沙箱上下文中执行。
  - 加载 `.json` 文件，返回 parsed 对象。
  - 加载其他文件，返回文件文本内容。
  - 支持模块缓存，多次 require 同一模块返回同一实例。
  - 示例：`const helper = require('./libs/helper.js');`
