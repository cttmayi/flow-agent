const store = new Map();

class Cache {
  has(key) { return store.has(key); }
  get(key) { return store.get(key); }
  set(key, value) { store.set(key, value); }
  clear() { store.clear(); }
  keys() { return [...store.keys()]; }
}

let instance = null;
export function getCache() {
  if (!instance) instance = new Cache();
  return instance;
}