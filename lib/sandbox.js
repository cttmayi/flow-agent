import vm from 'node:vm';

const SAFE_BUILTINS = {
  JSON, Math, Array, Object, Map, Set, Promise,
  String, Number, Boolean, RegExp, Date, Symbol,
  Error, TypeError, RangeError, ReferenceError,
  parseInt, parseFloat, isNaN, isFinite, console
};

// Strip common IIFE wrappers so user return values propagate
function stripIIFE(code) {
  const trimmed = code.trim();
  const iifePattern = /^\(async\s*(?:\(\)\s*=>|function\s*\(\))\s*\{([\s\S]*)\}\)\s*\(\);?\s*$/;
  const match = trimmed.match(iifePattern);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

export async function createSandbox(code, apis, timeout = 60000) {
  const context = vm.createContext({
    ...SAFE_BUILTINS,
    agent: apis.agent,
    parallel: apis.parallel,
    phase: apis.phase,
    checkpoint: apis.checkpoint
  });

  const body = stripIIFE(code);
  const wrappedCode = '(async function() { '.concat(body, '\n})()');
  const script = new vm.Script(wrappedCode);
  const result = script.runInContext(context, { timeout });
  return result;
}