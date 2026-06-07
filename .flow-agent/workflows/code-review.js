/*
 * 代码审查工作流
 * 功能：获取 git diff，逐文件审查变更代码，输出 PR Review 格式报告
 */

try {
  phase("diff 分析");
  const diff = await agent(
    '直接在 bash 中执行 git diff 获取与主分支的代码变更（不要 cd），分析变更范围、涉及的文件和行数',
    { tools: ["bash"] }
  );

  phase("审查代码变更");
  const review = await agent(
    `请审查以下代码变更，检查是否存在逻辑错误、安全隐患、性能问题、代码风格不一致等问题：\n\n${diff}`,
    { timeout: 120000 }
  );

  phase("生成总结");
  return await agent(
    `将以下代码审查结果整理为 PR Review 格式，包含：严重问题、改进建议、总体评分：\n\n${review}`,
    { tools: [] }
  );
} catch (err) {
  return await agent(`代码审查过程中出现错误：${err.message}。请生成友好的错误提示。`, { tools: [] });
}