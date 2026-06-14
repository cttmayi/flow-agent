// lib/tools/edit.js — 精确字符串替换工具（基于 search-and-replace，非正则）
import { readFile, writeFile, copyFile } from 'node:fs/promises';

function findLineCol(content, index) {
  const before = content.slice(0, index);
  const line = (before.match(/\n/g) || []).length + 1;
  const lastNewline = before.lastIndexOf('\n');
  const col = index - lastNewline;
  return { line, col };
}

export default {
  name: 'edit',
  description: '使用精确字符串匹配替换文件内容。支持多操作、dry-run 模式和自动备份。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要编辑的文件路径（相对于项目根目录）'
      },
      dryRun: {
        type: 'boolean',
        description: '为 true 时不实际写入，只返回匹配结果'
      },
      operations: {
        type: 'array',
        description: '替换操作列表，按顺序执行（自动按位置倒序处理避免偏移）',
        items: {
          type: 'object',
          properties: {
            oldText: {
              type: 'string',
              description: '要被替换的精确文本（必须唯一匹配）'
            },
            newText: {
              type: 'string',
              description: '替换后的新文本'
            }
          },
          required: ['oldText', 'newText']
        }
      }
    },
    required: ['path', 'operations']
  },
  async execute(args) {
    const { path, dryRun = false, operations } = args;

    try {
      const original = await readFile(path, 'utf8');
      let modified = original;

      // 收集所有操作的位置信息
      const ops = operations.map((op, idx) => {
        const pos = modified.indexOf(op.oldText);
        if (pos === -1) {
          return { idx, status: 'error', message: `未找到匹配文本: "${op.oldText.slice(0, 50)}"`, op };
        }
        const nextPos = modified.indexOf(op.oldText, pos + 1);
        if (nextPos !== -1) {
          const { line: l1, col: c1 } = findLineCol(modified, pos);
          const { line: l2, col: c2 } = findLineCol(modified, nextPos);
          return {
            idx, status: 'error',
            message: `文本不唯一，找到多处匹配（位置1: 第${l1}行第${c1}列, 位置2: 第${l2}行第${c2}列）: "${op.oldText.slice(0, 50)}"`,
            op
          };
        }
        return { idx, status: 'ok', pos, op };
      });

      // 检查是否有错误
      const hasErrors = ops.some(o => o.status === 'error');

      if (!hasErrors) {
        // 按位置倒序替换，避免前面的替换影响后面的位置
        const sortedOps = [...ops].sort((a, b) => b.pos - a.pos);
        for (const item of sortedOps) {
          const before = modified.slice(0, item.pos);
          const after = modified.slice(item.pos + item.op.oldText.length);
          modified = before + item.op.newText + after;
        }
      }

      if (dryRun) {
        return {
          dryRun: true,
          path,
          results: ops.map(o => ({
            status: o.status,
            oldText: o.op.oldText,
            newText: o.op.newText,
            message: o.message
          })),
          matchCount: ops.filter(o => o.status === 'ok').length,
          errorCount: ops.filter(o => o.status === 'error').length
        };
      }

      if (hasErrors) {
        return {
          path,
          results: ops.map(o => ({
            status: o.status,
            message: o.message || 'ok'
          })),
          errorCount: ops.filter(o => o.status === 'error').length,
          error: '部分操作失败，未写入任何更改'
        };
      }

      // 备份原始文件
      const backupPath = path + '.bak';
      await copyFile(path, backupPath);

      // 写入修改后的内容
      await writeFile(path, modified, 'utf8');

      return {
        path,
        backupPath,
        results: ops.map(o => ({
          status: 'ok'
        })),
        changes: ops.length,
        summary: `已修改 ${ops.length} 处，备份保存至 ${backupPath}`
      };
    } catch (err) {
      return { path, error: err.message, results: [] };
    }
  }
};
