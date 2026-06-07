phase('列出项目目录');
let projectList;
try {
  const listResult = await agent(
    `请执行命令 ls -1 MyProject/ 列出该目录下的所有子目录名称，只返回目录名称列表，每行一个。`,
    { tools: ['bash'] }
  );
  projectList = listResult.trim().split('\n');
} catch (e) {
  // 如果列出失败，提供一个友好的提示
  projectList = [];
}

phase('生成项目简介文章');
let finalArticle;
try {
  finalArticle = await agent(
    `项目目录 MyProject 下有以下子目录（每个子目录代表一个项目）：\n${projectList.join('\n')}\n\n请为每个项目写一段简短介绍（约50-100字）。可以尝试读取每个项目下的 README.md 或 package.json（如果存在）来获取信息；如果文件不存在，则根据项目名称合理推测简介。最后以 Markdown 格式写一篇标题为 "MyProject 项目概览" 的文章，列出所有项目及其简介。`,
    { tools: ['bash', 'read'] }
  );
} catch (e) {
  // 如果生成失败，返回一个基础的占位文章
  finalArticle = `# MyProject 项目概览\n\n未能成功获取项目简介。`;
}

return finalArticle;