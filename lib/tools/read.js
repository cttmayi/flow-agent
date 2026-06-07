// lib/tools/read.js
import { readFile, readdir, stat } from 'node:fs/promises';

export default {
  name: 'read',
  description: '读取文件内容或列出目录内容',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件或目录路径（相对于项目根目录）'
      }
    },
    required: ['path']
  },
  async execute(args) {
    try {
      const stats = await stat(args.path);
      if (stats.isDirectory()) {
        const entries = await readdir(args.path);
        return { content: entries.join('\n'), error: null };
      }
      const content = await readFile(args.path, 'utf8');
      return { content, error: null };
    } catch (err) {
      return { content: null, error: err.message };
    }
  }
};