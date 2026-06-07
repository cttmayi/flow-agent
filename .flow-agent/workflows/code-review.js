// .flow-agent/workflows/code-review.js

phase('diff 分析');
const diff = await agent('获取当前分支的 git diff，分析变更范围', {
  tools: ['bash']
});

const cached = await checkpoint('review-result');
if (cached !== undefined) {
  phase('使用缓存结果');
  return cached;
}

phase('逐文件审查');
const issues = await agent(`审查以下代码变更：${diff}`, {
  model: 'claude-sonnet-4-20250514',
  timeout: 120000
});

phase('生成总结');
const summary = await agent(
  '将审查结果整理为 PR Review 格式，包含：严重问题、建议、评分'
);
await checkpoint('review-result', summary);