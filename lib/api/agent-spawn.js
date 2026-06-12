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

    // Replace empty tool values with explicit "" so claude sees --tools ""
    // instead of --tools with no argument (which claude would ignore)
    const filtered = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '' && i > 0 && args[i - 1] === '--tools') {
        filtered.push('""');
      } else if (args[i] !== '') {
        filtered.push(args[i]);
      }
    }
    args = filtered;

    const timeout = agentOpts.timeout || defaultTimeout || 120000;

    console.log(`[spawn] ${command} ${args.join(' ')}`);

    return new Promise((resolve, reject) => {
      let settled = false;

      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_BASE_URL;
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env,
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
