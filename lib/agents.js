// lib/agents.js — Built-in agent definitions
// Each agent defines how to spawn an external CLI process.
// `args` supports {prompt} and {tools} template variables.
// `tool_mapping` maps internal tool names to CLI-specific names.

export const BUILTIN_AGENTS = {
  claude: {
    command: 'claude',
    args: ['-p', '{prompt}', '--tools', '{tools}', '--dangerously-skip-permissions'],
    tool_mapping: {
      bash: 'Bash',
      read: 'Read',
      write: 'Edit',
    },
    timeout: 600000,
  },
  codex: {
    command: 'codex',
    args: ['-p', '{prompt}', '--tools', '{tools}'],
    tool_mapping: {
      bash: 'Bash',
      read: 'Read',
      write: 'Edit',
    },
    timeout: 600000,
  },
};
