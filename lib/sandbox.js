import vm from 'node:vm';

const SAFE_BUILTINS = {
  JSON, Math, Array, Object, Map, Set, Promise,
  String, Number, Boolean, RegExp, Date, Symbol,
  Error, TypeError, RangeError, ReferenceError,
  parseInt, parseFloat, isNaN, isFinite, console
};

export async function createSandbox(code, apis, timeout = 60000) {
  const context = vm.createContext({
    ...SAFE_BUILTINS,
    agent: apis.agent,
    parallel: apis.parallel,
    phase: apis.phase,
    checkpoint: apis.checkpoint
  });

  const wrappedCode = `(async function() { ${code} })()`;
  const script = new vm.Script(wrappedCode);
  const result = script.runInContext(context, { timeout });
  return result;
}