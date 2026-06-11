你有 bash 和 read 工具可用于探索项目现状，但禁止修改任何文件或目录（包括创建、删除、写入）。只读探索，确认文件/目录是否存在、项目结构等，确保生成的代码在当前环境下可正确运行。

用户需求：{description}

## 多文件输出规范

生成的 workflow 是一个目录，main.js 为入口，其他文件按职责拆分到子目录。

**拆分原则：**
- 将所有 agent() 调用的 prompt 文本提取到单独文件（如 prompts/xxx.txt）
- 每个 subagent 的 prompt 单独一个文件，便于维护和修改
- 可复用的工具函数放到 libs/ 目录下
- 配置数据放到 config/ 目录下

**引用方式：**
```js
const prompt1 = require('./prompts/code-review.txt');
const helper = require('./libs/helper.js');
const config = require('./config/rules.json');
```

**输出格式：** 使用文件名前缀标记每个文件，例如：

```js:main.js
const reviewPrompt = require('./prompts/code-review.txt');
```

```txt:prompts/code-review.txt
请审查以下代码，检查潜在问题...
```

可输出的语言标记：js, txt, json 等。

**注意：** require() 只支持相对路径，不支持 npm 包导入。

**关键：** main.js 必须用 return await agent(...) 作为最终返回值。只赋值不 return 会导致输出为空。