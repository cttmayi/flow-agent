import { execSync } from 'node:child_process';

export default {
  name: 'bash',
  description: '在沙箱外执行 Shell 命令，返回输出结果',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 Shell 命令'
      }
    },
    required: ['command']
  },
  async execute(args) {
    try {
      const stdout = execSync(args.command, {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });
      return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
    } catch (err) {
      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exitCode: err.status || 1
      };
    }
  }
};