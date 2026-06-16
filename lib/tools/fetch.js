// lib/tools/fetch.js — Fetch web page content
// Stub: returns placeholder error until implemented.

export default {
  name: 'fetch',
  description: '获取网页内容，输入 URL 返回页面文本（HTML 已转为纯文本）',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要获取的网页 URL（完整 URL，含协议）'
      }
    },
    required: ['url']
  },
  async execute(args) {
    throw new Error('fetch 工具尚未实现');
  }
};
