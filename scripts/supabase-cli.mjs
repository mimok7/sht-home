import { spawn } from 'node:child_process';

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(executable, ['--yes', '-p', 'supabase@2.109.1', 'supabase', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error(`Supabase CLI를 실행하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
