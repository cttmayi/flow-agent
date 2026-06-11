/*
 * 安全审计工作流
 * 功能：扫描项目依赖、环境配置、代码安全，生成审计报告
 */

try {
  phase("依赖分析");
  const deps = await agent(
    '扫描项目的 package.json，列出所有依赖及其版本，检查是否存在高危版本或过时依赖',
    { tools: ["read"] }
  );

  phase("安全风险检查");
  const results = await parallel([
    () => agent(`基于以下依赖信息，审计是否存在已知安全漏洞或风险：\n${deps}`, { tools: [] }),
    () => agent('检查项目代码中是否存在密钥、密码、token 等硬编码的风险', { tools: ["bash", "read"] }),
    () => agent('检查 .env 文件是否存在且是否被版本控制跟踪，评估敏感信息泄露风险', { tools: ["bash", "read"] }),
  ], { concurrency: 2, failFast: false });

  phase("报告生成");
  return await agent(
    `以下是安全审计的阶段性发现，请汇总成一份完整的审计报告，包含发现的问题、风险等级和修复建议：\n\n${results.join('\n---\n')}`,
    { tools: [] }
  );
} catch (err) {
  return await agent(`安全审计过程中出现错误：${err.message}。请生成友好的错误提示。`, { tools: [] });
}