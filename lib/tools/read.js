// lib/tools/read.js
import { readFile } from 'node:fs/promises';

export default {
  name: 'read',
  description: '读取项目文件内容，返回文件文本',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（相对于项目根目录）'
      }
    },
    required: ['path']
  },
  async execute(args) {
    try {
      const content = await readFile(args.path, 'utf8');
      return { content, error: null };
    } catch (err) {
      return { content: null, error: err.message };
    }
  }
};