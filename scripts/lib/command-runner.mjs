import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  redactCommandArgs,
  structuredCommandResult
} from '../../shared/dust-wave-platform/packages/release-core/src/command-result.js';

export { redactCommandArgs, structuredCommandResult };

export function commandName(name) {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(commandName(command), args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    input: options.input || '',
    stdio: options.capture === false ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: options.env || process.env,
    timeout: options.timeoutMs || 30_000,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024
  });
  return {
    command,
    args: redactCommandArgs(args, options),
    cwd: options.cwd || process.cwd(),
    status: result.status ?? 1,
    signal: result.signal || '',
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error ? result.error.message : '',
    timedOut: result.error?.code === 'ETIMEDOUT'
  };
}

export function commandAvailable(command, options = {}) {
  const result = runCommand(command, ['--version'], {
    ...options,
    timeoutMs: options.timeoutMs || 5_000,
    maxBuffer: 1024 * 1024
  });
  return result.status === 0 && !result.error;
}
