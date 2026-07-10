import { spawnSync } from 'node:child_process';
import process from 'node:process';

export function commandName(name) {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;
}

export function redactCommandArgs(args = [], options = {}) {
  const redactedIndexes = new Set(options.redactedIndexes || []);
  return args.map((arg, index) => {
    if (redactedIndexes.has(index)) return '[REDACTED]';
    const text = String(arg);
    if (/^(?:sk|rk|pk|whsec|re|ghp|github_pat|cf)-?[A-Za-z0-9_]/.test(text)) return '[REDACTED]';
    if (/^(?:authorization|token|secret|cookie|passphrase)=/i.test(text)) {
      return `${text.split('=')[0]}=[REDACTED]`;
    }
    return text;
  });
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

export function structuredCommandResult(result = {}, options = {}) {
  return {
    ok: result.status === 0,
    status: Number(result.status ?? 1),
    timedOut: result.timedOut === true,
    command: result.command || '',
    args: result.args || [],
    ...(options.includeOutput === true ? {
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || '')
    } : {}),
    error: result.status === 0 ? '' : String(result.error || result.stderr || '').trim().slice(0, 500)
  };
}
