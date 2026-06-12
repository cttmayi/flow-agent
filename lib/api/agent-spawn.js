// lib/api/agent-spawn.js — Generic CLI subprocess agent provider
import { spawn } from 'node:child_process';

export function createSpawnAgent(spawnConfig) {
  const { command, args: argTemplate, timeout: defaultTimeout, tool_mapping: toolMapping } = spawnConfig;

  if (!command) {
    throw new Error('Spawn agent missing required "command" config');
  }

  return async (prompt, agentOpts = {}) => {
    // Build tools string with mapping
    let toolsStr = '';
    if (agentOpts.tools && agentOpts.tools.length > 0) {
      const mapped = agentOpts.tools.map(t => (toolMapping && toolMapping[t]) || t);
      toolsStr = mapped.join(',');
    }

    // Template substitution
    let args = (argTemplate || []).map(a =>
      a.replace('{prompt}', prompt).replace('{tools}', toolsStr)
    );

    // Remove flag-value pairs where value is empty (e.g. --allowedTools "" → removed)
    const filtered = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '' && i > 0 && args[i - 1].startsWith('-')) {
        filtered.pop(); // remove the flag
      } else if (args[i] !== '') {
        filtered.push(args[i]);
      }
    }
    args = filtered;

    const timeout = agentOpts.timeout || defaultTimeout || 120000;

    console.log(`[spawn] ${command} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

    return new Promise((resolve, reject) => {
      let settled = false;

      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('error', (err) => {
        if (!settled) { settled = true; reject(new Error(`Failed to spawn "${command}": ${err.message}`)); }
      });

      child.on('timeout', () => {
        if (!settled) { settled = true; reject(new Error(`"${command}" timed out after ${timeout / 1000}s`)); }
        child.kill('SIGTERM');
      });

      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          settled = true;
          if (stderr.trim()) console.error(`[spawn] stderr: ${stderr.trim()}`);
          reject(new Error(`"${command}" 退出码 ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
        } else {
          settled = true;
          resolve(stdout.trim());
        }
      });
    });
  };
}
