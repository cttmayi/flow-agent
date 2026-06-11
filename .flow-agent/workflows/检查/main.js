/**
 * 工作流：检查代码（含安全检查）— 全并行优化版
 * 
 * 所有独立的读取/检查操作并行执行，最大化效率。
 * 使用 bash 和 read 工具只读探索项目结构，收集关键代码文件信息，
 * 同时进行依赖安全扫描（npm audit）和敏感信息检查，
 * 然后由 AI agent 分析代码质量、项目结构合理性及潜在问题。
 * 最终输出一份包含安全审查的检查报告。
 */

phase('并行收集所有项目信息');

// 第一步：一次性并行执行所有独立的读取/检查操作
const allTasks = [];

// 任务：探索项目根目录
allTasks.push(async () => {
  const result = await agent(
    '请列出当前目录的内容。使用 read 工具列出根目录文件（参数 path 设为 "."）。',
    { tools: ['read'] }
  );
  return { type: 'root_listing', content: result };
});

// 任务：读取 package.json
allTasks.push(async () => {
  try {
    const result = await agent(
      '读取 package.json 文件的内容。使用 read 工具，path 设为 "package.json"。',
      { tools: ['read'] }
    );
    return { type: 'package_json', content: result };
  } catch (e) {
    return { type: 'package_json', content: 'package.json 不存在或无法读取。' };
  }
});

// 任务：读取 .env（安全检查）
allTasks.push(async () => {
  try {
    const result = await agent(
      '读取 .env 文件的内容。使用 read 工具，path 设为 ".env"。注意：这是安全检查的一部分，不要输出敏感值细节，只判断是否存在以及结构是否合理。',
      { tools: ['read'] }
    );
    return { type: 'env', content: result };
  } catch (e) {
    return { type: 'env', content: '.env 文件不存在，无法读取。' };
  }
});

// 任务：读取 .gitignore
allTasks.push(async () => {
  try {
    const result = await agent(
      '读取 .gitignore 文件的内容。使用 read 工具，path 设为 ".gitignore"。',
      { tools: ['read'] }
    );
    return { type: 'gitignore', content: result };
  } catch (e) {
    return { type: 'gitignore', content: '.gitignore 文件不存在。' };
  }
});

// 任务：读取 config 目录
allTasks.push(async () => {
  try {
    const result = await agent(
      '列出 config 目录下的文件。使用 read 工具，path 设为 "config"。',
      { tools: ['read'] }
    );
    return { type: 'config', content: result };
  } catch (e) {
    return { type: 'config', content: 'config 目录不存在。' };
  }
});

// 任务：读取 src 目录
allTasks.push(async () => {
  try {
    const result = await agent(
      '列出 src 目录下的文件。使用 read 工具，path 设为 "src"。',
      { tools: ['read'] }
    );
    return { type: 'src_listing', content: result };
  } catch (e) {
    return { type: 'src_listing', content: 'src 目录不存在或无法读取。' };
  }
});

// 任务：npm audit 依赖安全检查
allTasks.push(async () => {
  try {
    const result = await agent(
      '运行 npm audit 命令检查项目依赖的安全性。使用 bash 工具执行 "npm audit --json" 命令。注意：不要切换目录，直接在当前目录执行。返回完整的 JSON 结果。',
      { tools: ['bash'], timeout: 60000 }
    );
    return { type: 'npm_audit', content: result };
  } catch (e) {
    return { type: 'npm_audit', content: `npm audit 执行失败：${e.message}` };
  }
});

// 任务：Git 检查
allTasks.push(async () => {
  try {
    const result = await agent(
      '检查 .git 目录是否存在以及项目是否有 git 历史。使用 bash 工具执行 "git log --oneline -5 2>&1 || echo 非 git 仓库"。注意：不要切换目录，直接在当前目录执行。',
      { tools: ['bash'] }
    );
    return { type: 'git_check', content: result };
  } catch (e) {
    return { type: 'git_check', content: `Git 检查失败：${e.message}` };
  }
});

// 并行执行所有任务（并发数 5，但全部独立所以无妨）
const allResults = await parallel(allTasks);

// 解析结果到字典
const data = {};
allResults.forEach(r => {
  data[r.type] = r.content;
});

// 阶段 2：读取源代码文件（需等 src 目录信息就绪）
phase('读取源代码文件');

let codeFiles = {};
const srcListing = data['src_listing'] || '';
const filePaths = srcListing
  .split('\n')
  .filter(f => f && (f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.jsx') || f.endsWith('.tsx')))
  .slice(0, 5);

if (filePaths.length > 0) {
  const codeTasks = filePaths.map(filePath => async () => {
    const content = await agent(
      `读取文件 "${filePath}" 的内容。使用 read 工具，path 设为 "${filePath}"。`,
      { tools: ['read'] }
    );
    return { filePath, content };
  });

  const codeResults = await parallel(codeTasks);
  codeResults.forEach(({ filePath, content }) => {
    codeFiles[filePath] = content;
  });
}

// 阶段 3：生成检查报告
phase('生成检查报告');

const finalReport = await agent(
  `你是一个代码审查和安全审计专家。根据以下项目信息生成一份详细的代码检查报告。

项目根目录内容：
${data['root_listing'] || '无数据'}

package.json 内容：
${data['package_json'] || '无数据'}

.env 文件内容（用于检查敏感信息泄露）：
${data['env'] || '无数据'}

.gitignore 内容：
${data['gitignore'] || '无数据'}

config 目录内容：
${data['config'] || '无数据'}

源代码目录内容：
${srcListing}

读取到的源代码文件（最多5个）：
${Object.entries(codeFiles).map(([path, content]) => `--- ${path} ---\n${content}`).join('\n\n')}

npm audit 依赖安全检查结果：
${data['npm_audit'] || '未执行'}

Git 检查结果（检查是否在 git 仓库中、是否有提交历史）：
${data['git_check'] || '未执行'}

请输出结构化的报告，包含以下章节：
1. 项目概览
2. 配置检查（包括 .env 是否合理、.gitignore 是否覆盖敏感文件）
3. 代码质量分析
4. 安全检查（重点分析以下内容）：
   a. 依赖安全 — 根据 npm audit 结果，列出高危/严重漏洞及修复建议
   b. 敏感信息泄露 — 检查 .env 文件是否存在硬编码密钥，检查源代码中是否有硬编码的密码、Token、API Key
   c. 文件泄露风险 — 检查 .gitignore 是否覆盖了 node_modules、.env、dist 等目录
   d. Git 安全性 — 检查是否有敏感文件被提交到版本历史中
   e. 代码安全 — 检查是否存在 SQL 注入、XSS、命令注入等常见 Web 安全风险
5. 潜在问题
6. 改进建议（包含安全改进建议）`,
  { }
);

return finalReport;
