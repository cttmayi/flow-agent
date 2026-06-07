/*
 * 代码审查工作流
 * 功能：获取当前分支的 git diff（与主分支对比），分析变更代码，输出 PR Review 格式报告
 * 输出格式：PR Review 风格的 Markdown 报告，包含变更概览、逐文件审查、严重问题、改进建议、总体评分
 */

try {
  let diffContent;

  phase("获取 diff");

  // 获取当前分支名，确定 diff 对比对象
  const branchInfo = await agent(
    '执行命令 git rev-parse --abbrev-ref HEAD 获取当前分支名，然后判断：' +
    '如果当前分支是 main 或 master，执行 git diff HEAD~1..HEAD 获取最近一次提交的变更；' +
    '否则执行 git diff main...HEAD 获取与主分支的差异。' +
    '然后执行 git diff --stat 获取变更统计（文件数、插入行、删除行）。' +
    '返回格式：第一行是分支名，第二行是 diff --stat 结果，空一行后是完整的 git diff 内容。',
    { tools: ["bash"] }
  );

  diffContent = branchInfo;

  // 提取分支名和统计信息用于后续上下文
  const diffLines = diffContent.split('\n');
  const currentBranch = diffLines[0] || "unknown";
  const diffStat = diffLines.length > 1 ? diffLines[1] : "";

  phase("分析变更概览");

  const overview = await agent(
    `以下是当前分支（${currentBranch}）的代码变更 diff 信息：\n\n` +
    `变更统计：${diffStat}\n\n` +
    `完整 diff 内容：\n${diffContent}\n\n` +
    `请分析并返回以下内容：\n` +
    `1. 变更涉及的文件列表（文件名 + 变更类型：新增/修改/删除）\n` +
    `2. 每文件变更的行数（新增行/删除行）\n` +
    `3. 变更的总体范围和影响域描述（如：前端组件、后端逻辑、配置文件等）`,
    { tools: [], timeout: 60000 }
  );

  phase("审查代码变更");

  const reviewDetails = await agent(
    `请对以下代码变更进行全面审查，重点关注以下方面：\n\n` +
    `--- 变更概览 ---\n${overview}\n\n` +
    `--- 完整 Diff ---\n${diffContent}\n\n` +
    `审查维度：\n` +
    `1. 逻辑错误：是否存在潜在的 bug、边界条件未处理、逻辑矛盾\n` +
    `2. 安全隐患：SQL 注入、XSS、敏感信息泄露、权限校验缺失等\n` +
    `3. 性能问题：不必要的循环、重复计算、内存泄漏风险、大对象复制等\n` +
    `4. 代码质量：可读性、复用性、命名规范、代码结构、注释完整性\n` +
    `5. 错误处理：异常捕获是否完善、错误信息是否合理、降级策略\n` +
    `6. 测试覆盖：变更是否有对应的测试、测试用例是否覆盖关键路径\n` +
    `请逐文件列出发现的问题，每个问题标注：文件、行号（如适用）、问题类型、严重程度（严重/中等/轻微）、详细说明`,
    { tools: [], timeout: 120000 }
  );

  phase("生成 PR Review 报告");

  return await agent(
    `请将以下代码审查结果整理为标准的 PR Review 格式报告：\n\n` +
    `--- 变更概览 ---\n${overview}\n\n` +
    `--- 审查详情 ---\n${reviewDetails}\n\n` +
    `报告格式要求：\n` +
    `# 📋 PR Review Report\n\n` +
    `## 📊 变更概览\n` +
    `- 分支：${currentBranch}\n` +
    `- ${diffStat}\n` +
    `- 变更摘要：（此处根据 overview 概括）\n\n` +
    `## 🔴 严重问题（必须修复）\n` +
    `列出所有严重级别的问题，逐条说明影响和修复建议\n\n` +
    `## 🟡 改进建议（建议优化）\n` +
    `列出中等和轻微问题，给出优化方向\n\n` +
    `## ✅ 做得好的地方\n` +
    `肯定代码中的亮点：良好的设计、完善的错误处理、清晰的注释等\n\n` +
    `## 📝 总结\n` +
    `总体评价代码质量，给出是否建议合并的意见，以及后续改进方向\n\n` +
    `## ⭐ 总体评分\n` +
    `给出 1-5 分的综合评分及简要理由\n\n` +
    `请严格按照上述 Markdown 格式输出完整的 PR Review 报告。`,
    { tools: [], timeout: 60000 }
  );

} catch (err) {
  // 容错处理：任何步骤失败都不让 workflow 崩溃，返回友好的错误提示
  return await agent(
    `代码审查工作流出错：${err.message}。\n\n` +
    `请生成友好的错误提示，包含以下信息：\n` +
    `1. 错误发生的可能原因\n` +
    `2. 建议的排查步骤（如：检查 git 分支是否存在、是否有未提交的变更等）\n` +
    `3. 如何重新运行此工作流\n\n` +
    `以友好的 Markdown 格式输出。`,
    { tools: [], timeout: 30000 }
  );
}