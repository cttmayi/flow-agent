// lib/tools/write.js
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export default {
  name: 'write',
  description: '写入内容到文件（覆盖已存在的文件）',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于项目根目录）'
      },
      content: {
        type: 'string',
        description: '要写入的文件内容'
      }
    },
    required: ['path', 'content']
  },
  async execute(args) {
    try {
      await mkdir(dirname(args.path), { recursive: true });
      await writeFile(args.path, args.content, 'utf8');
      return { content: `已写入 ${args.path}`, error: null };
    } catch (err) {
      return { content: null, error: err.message };
    }
  }
};
