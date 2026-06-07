/*
 * 代码审查工作流
 * 功能：获取当前分支的 git diff（与主分支对比），分析变更代码，输出 PR Review 格式报告
 * 流程：获取分支与 Diff → 变更概览分析 → 逐文件深度审查 → 生成 PR Review 报告
 * 缓存在变更概览阶段启用，相同分支重复运行可跳过 LLM 分析直接进入审查
 */

try {
  /* ======================== 阶段 1：获取分支与 diff 信息 ======================== */

  phase("获取分支与 Diff");

  const branchAndDiff = await agent(
    `请依次执行以下步骤，并严格按要求的格式返回结果。

    步骤1：执行 git rev-parse --abbrev-ref HEAD 获取当前分支名
    步骤2：根据分支名判断 diff 范围：
      - 如果当前分支是 main 或 master，执行 git diff HEAD~1..HEAD 获取最近一次提交的变更
      - 否则执行 git merge-base main HEAD 获取与 main 的共同祖先，再执行 git diff <merge_base>..HEAD
    步骤3：执行 git diff --stat <范围> 获取变更统计摘要
    步骤4：执行 git diff <范围> 获取完整 diff 内容

    注意：执行 bash 命令时不要切换目录，直接执行。

    返回格式（严格按此格式解析）：
    第一行：当前分支名
    第二行：变更统计（git diff --stat 的结果）
    空一行
    之后是完整的 git diff 内容`,
    { tools: ["bash"], timeout: 60000 }
  );

  // 解析 agent 返回的结构化文本
  const lines = branchAndDiff.split("\n");
  const currentBranch = lines[0]?.trim() || "unknown";

  // 找到 diff stat 行（第二行非空内容）
  let diffStat = "";
  let diffStartIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "") {
      diffStartIdx = i + 1;
      break;
    }
    if (!diffStat && lines[i].trim()) {
      diffStat = lines[i].trim();
    }
  }

  // 提取完整 diff 内容
  const diffContent = diffStartIdx > 0 && diffStartIdx < lines.length
    ? lines.slice(diffStartIdx).join("\n").trim()
    : "";

  // 无 diff 时提前返回友好提示
  if (!diffContent) {
    return await agent(
      `当前分支 "${currentBranch}" 与主分支之间没有检测到代码变更差异。

      请生成一条友好的提示消息，说明以下情况：
      1. 当前分支与主分支相比没有检测到任何变更
      2. 可能的原因：刚创建分支、所有变更已合并、分支已是最新、没有未提交的变更
      3. 建议的操作：确认分支是否正确、提交代码后再运行、或检查是否已合并到主分支

      以 Markdown 格式输出。`,
      { tools: [], timeout: 15000 }
    );
  }

  /* ======================== 阶段 2：变更概览分析 ======================== */

  phase("分析变更概览");

  const checkpointKey = `review_overview_${currentBranch}`;
  const cachedOverview = checkpoint(checkpointKey);

  let overview;
  if (cachedOverview) {
    overview = cachedOverview;
  } else {
    overview = await agent(
      `以下是对比主分支后，当前分支 "${currentBranch}" 的代码变更。

      ## 变更统计
      ${diffStat}

      ## 完整 Diff（前 8000 字符）
      \`\`\`diff
      ${diffContent.slice(0, 8000)}
      \`\`\`

      请分析并返回以下内容（逐项列出，不要遗漏）：
      1. 变更涉及的文件列表——每个文件标注：文件名、变更类型（新增/修改/删除/重命名）
      2. 每个文件的新增行数和删除行数（从 diff stat 中统计）
      3. 变更的总体范围和影响域描述（如：前端 UI 组件、后端 API 逻辑、数据库模型、配置文件、测试用例、基础设施等）
      4. 是否涉及破坏性变更（如 API 接口变更、数据库 schema 变更、配置格式变化等）`,
      { tools: [], timeout: 60000 }
    );
    checkpoint(checkpointKey, overview);
  }

  /* ======================== 阶段 3：逐文件深度审查 ======================== */

  phase("审查代码变更");

  const reviewDetails = await agent(
    `请对以下代码变更进行全面、深入的 Code Review。

    ## 分支信息
    - 分支：${currentBranch}
    - 统计：${diffStat}

    ## 变更概览
    ${overview}

    ## 完整 Diff（前 12000 字符）
    \`\`\`diff
    ${diffContent.slice(0, 12000)}
    \`\`\`

    ### 审查维度（请逐维度检查，每个维度的发现按文件列出）：

    1. **逻辑正确性**
       - 是否存在算法或业务逻辑错误？
       - 边界条件和极端情况是否处理？
       - 条件判断和循环控制是否正确？
       - 数据类型假设是否安全（null/undefined/Nan 等）？

    2. **安全性**
       - 是否存在注入风险（SQL、NoSQL、命令注入、XSS）？
       - 敏感信息（密钥、密码、Token、内网地址）是否暴露？
       - 权限校验是否缺失或不正确？
       - 输入验证和过滤是否充分？

    3. **性能与资源**
       - 是否存在不必要的循环或重复计算？
       - 是否有内存泄漏或资源未释放风险？
       - N+1 查询问题或不必要的数据库调用？
       - 大对象复制或频繁 GC 触发？

    4. **代码质量与可维护性**
       - 命名是否清晰且符合项目规范？
       - 函数/方法是否过长或职责不单一？
       - 是否有重复代码可提取复用？
       - 注释和文档是否充分且准确？
       - 代码格式化是否一致？

    5. **错误处理与健壮性**
       - 异常捕获是否恰当？
       - 错误信息是否清晰且不泄露敏感信息？
       - 是否有优雅的降级或重试策略？
       - 异步操作的错误传递是否正确？

    6. **测试覆盖**
       - 变更是否包含对应的测试用例？
       - 测试是否覆盖关键路径和边界情况？
       - 测试命名和结构是否清晰？

    ### 问题输出格式
    每个发现问题请按以下格式输出：

    【文件】\`<文件路径>\` 【行号】\`<行号范围>\` 【类型】<逻辑/安全/性能/质量/错误处理/测试> 【严重程度】<严重/中等/轻微>
    问题描述：（详细说明问题表现和潜在影响）
    修复建议：（给出具体的修复思路或代码示例）
    ---`,
    { tools: [], timeout: 120000 }
  );

  /* ======================== 阶段 4：生成 PR Review 报告 ======================== */

  phase("生成 PR Review 报告");

  return await agent(
    `请将以下代码审查结果整理为专业的 PR Review 报告。

    --- 上下文 ---
    分支：${currentBranch}
    变更统计：${diffStat}

    --- 变更概览 ---
    ${overview}

    --- 审查详情 ---
    ${reviewDetails}

    请严格按照以下 Markdown 格式输出报告，每个章节必须完整：

    # 📋 PR Review Report

    ---

    ## 📊 变更概览
    | 项目 | 内容 |
    |------|------|
    | 分支 | ${currentBranch} |
    | 统计 | ${diffStat.replace(/\|/g, '\\|')} |
    | 影响域 | （从 overview 中提取核心影响域） |
    | 破坏性变更 | （是否涉及） |

    ### 变更文件清单
    （以表格形式列出所有文件：文件名、变更类型、新增行数、删除行数）

    ---

    ## 🔴 严重问题（必须修复）
    列出所有标记为"严重"的问题。
    每个问题包含：文件位置、问题描述、潜在影响、修复建议。
    如果没有严重问题，请写"本次变更未发现严重问题。"

    ---

    ## 🟡 改进建议（建议优化）
    列出所有标记为"中等"和"轻微"的问题。
    按文件分组，每个问题包含：问题描述、优化建议。
    如果没有改进建议，请写"本次变更代码质量良好，无特别改进建议。"

    ---

    ## ✅ 做得好的地方
    肯定代码中的亮点，至少列出 2-3 项：
    - 良好的设计模式或架构决策
    - 完善的错误处理或边界条件处理
    - 清晰的注释或文档
    - 充分的测试覆盖
    - 安全的编码实践

    ---

    ## 📝 总结与建议
    - 总体评价本次变更的质量
    - 是否建议合并（强烈建议合并 / 建议修复严重问题后合并 / 不建议合并需重大修改）
    - 后续改进方向或需关注的事项

    ---

    ## ⭐ 总体评分
    **评分：X / 5**

    评分标准：
    - 5 分：代码完美，无任何问题
    - 4 分：代码良好，有少量轻微改进点
    - 3 分：代码一般，存在一些需关注的问题
    - 2 分：代码有较多问题，需较大改进
    - 1 分：代码存在严重问题，不建议合并

    评分理由：（结合审查发现给出合理解释）

    ---

    > 📌 本报告由 AI Code Review 工作流自动生成，请人工复核后决策。`,
    { tools: [], timeout: 60000 }
  );

} catch (err) {
  /* ======================== 容错处理 ======================== */
  return await agent(
    `代码审查工作流执行过程中发生错误：${err.message}

    请生成友好的错误提示，包含：
    1. 错误可能的原因（如：不在 Git 仓库中、main 分支不存在、diff 对比失败、Agent 调用超时等）
    2. 建议的排查步骤
       - 确认当前目录是否为 Git 仓库：git rev-parse --git-dir
       - 确认 main 分支存在：git branch -a | grep main
       - 确认有可对比的提交：git log --oneline -3
       - 检查网络连接和 API 配置
    3. 如何重新运行此工作流

    以友好的 Markdown 格式输出。`,
    { tools: [], timeout: 30000 }
  );
}