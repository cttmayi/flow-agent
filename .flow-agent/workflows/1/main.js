// 只读探索项目现状：列出根目录结构并返回摘要
try {
  const listing = await agent("请执行以下步骤：1. 使用 bash 工具运行 'ls -la' 列出当前目录所有文件和目录（不要切换目录）。2. 使用 read 工具读取关键配置文件（如 package.json、README.md 等），如果存在的话。3. 汇总项目名称、主要文件、目录结构、依赖等信息。", {
    tools: ["bash", "read"],
    timeout: 30000
  });
  // 将探索结果传给最终 agent 整理为友好输出
  const summary = await agent(`根据以下项目探索信息，生成一份简洁的项目现状报告，包括项目名称（如果有）、主要目录结构、关键文件及其用途。请用中文回答。\n\n探索结果：\n${listing}`, { model: "default", timeout: 30000 });
  // 最终输出必须是 agent 结果
  process.stdout.write(summary);
} catch (err) {
  const errorMsg = await agent(`工作流执行出错，请生成一条友好的错误说明，告知用户发生了什么问题以及可能的解决方向。错误详情：${err.message}`, { timeout: 15000 });
  process.stdout.write(errorMsg);
}