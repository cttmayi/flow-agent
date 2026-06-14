import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve, extname, isAbsolute } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';

const SAFE_BUILTINS = {
  JSON, Math, Array, Object, Map, Set, Promise,
  String, Number, Boolean, RegExp, Date, Symbol,
  Error, TypeError, RangeError, ReferenceError,
  parseInt, parseFloat, isNaN, isFinite, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  setImmediate, clearImmediate,
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

function createModuleRequire(workflowDir, context) {
  const cache = new Map();

  function modRequire(modulePath) {
    // Only allow relative paths
    if (!modulePath.startsWith('.') && !isAbsolute(modulePath)) {
      throw new Error(`require() only supports relative paths, got "${modulePath}"`);
    }

    const resolvedPath = resolve(workflowDir, modulePath);

    if (cache.has(resolvedPath)) {
      return cache.get(resolvedPath).exports;
    }

    const ext = extname(resolvedPath);

    if (ext === '.json') {
      const content = readFileSync(resolvedPath, 'utf8');
      const exports = JSON.parse(content);
      const mod = { exports };
      cache.set(resolvedPath, mod);
      return exports;
    }

    if (ext === '.js' || ext === '') {
      const resolvedPathJs = ext === '' ? resolvedPath + '.js' : resolvedPath;
      const code = readFileSync(resolvedPathJs, 'utf8');
      const mod = { exports: {} };
      cache.set(resolvedPathJs, mod);

      const wrapped = `(function(exports, module, require) { ${code} })`;
      const fn = vm.runInContext(wrapped, context, { filename: resolvedPathJs });
      fn(mod.exports, mod, modRequire);
      return mod.exports;
    }

    // Other file types: read as text
    const content = readFileSync(resolvedPath, 'utf8');
    const mod = { exports: content };
    cache.set(resolvedPath, mod);
    return content;
  }

  return modRequire;
}

export async function createSandbox(code, apis, timeout = 60000, workflowDir) {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const context = vm.createContext({
    ...SAFE_BUILTINS,
    agent: apis.agent,
    parallel: apis.parallel,
    phase: apis.phase,
    checkpoint: apis.checkpoint,
    tool: apis.tool || (() => { throw new Error('tool() is not available without a tool registry'); }),
    fs,
    path,
    sleep
  });

  // Inject custom require if workflowDir is provided
  if (workflowDir) {
    context.require = createModuleRequire(workflowDir, context);
  }

  const body = stripIIFE(code);
  // Wrap to capture last agent() result as fallback return value
  const wrappedCode = `(async function() {
  const __agent = agent;
  let __lastAgentResult = '';
  agent = async (...a) => { __lastAgentResult = await __agent(...a); return __lastAgentResult; };
  ${body}
  return __lastAgentResult;
})()`;
  const script = new vm.Script(wrappedCode);
  const result = script.runInContext(context, { timeout });
  return result;
}