import { getCache } from '../cache.js';

export function createCheckpoint() {
  const cache = getCache();
  return async (...args) => {
    if (args.length === 1) {
      return cache.get(args[0]);
    }
    cache.set(args[0], args[1]);
    return args[1];
  };
}