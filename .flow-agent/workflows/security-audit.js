// .flow-agent/workflows/security-audit.js

phase('依赖分析');
const deps = await agent('扫描项目的 package.json，列出所有依赖及其版本', {
  tools: ['read']
});

phase('漏洞检查');
const results = await parallel([
  () => agent(`审计依赖中是否存在已知漏洞`),
  () => agent('检查项目环境变量配置是否存在密钥硬编码'),
  () => agent('检查 .env 文件是否在版本控制中'),
], { concurrency: 2, failFast: false });

phase('报告生成');
const report = await agent('汇总以上安全审计结果，生成修复建议');
await checkpoint('audit-report', report);