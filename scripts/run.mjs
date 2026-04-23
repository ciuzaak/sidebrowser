// Wrapper that strips ELECTRON_RUN_AS_NODE (which may leak in from tooling contexts,
// e.g. Claude Code's terminal) before spawning the real command. cross-env can only
// set env vars to empty strings, not delete them — and Electron treats the variable
// as present even when set to "", forcing Node-compat mode.

import { spawn } from 'node:child_process';

delete process.env.ELECTRON_RUN_AS_NODE;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/run.mjs <command> [args...]');
  process.exit(2);
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
