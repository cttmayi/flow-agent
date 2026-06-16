// lib/tools/search.js — Search the web
// Stub: returns placeholder error until implemented.

export default {
  name: 'search',
  description: '搜索网络，输入关键词返回搜索结果列表（标题、链接、摘要）',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词'
      },
      count: {
        type: 'number',
        description: '返回结果数量（默认 5）'
      }
    },
    required: ['query']
  },
  async execute(args) {
    throw new Error('search 工具尚未实现');
  }
};
