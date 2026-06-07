// lib/logger.js
export const logger = {
  phase(name) {
    console.log(`=== 阶段：${name} ===`);
  },
  info(msg) {
    console.log(`[info] ${msg}`);
  },
  error(msg) {
    console.error(`[error] ${msg}`);
  },
  result(data) {
    console.log(JSON.stringify(data, null, 2));
  }
};