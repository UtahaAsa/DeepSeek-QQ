import { pathToFileURL } from 'node:url';
import { cli } from './environment.mjs';
if (!process.connected) throw new Error('OWNER_REQUIRED');
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const notify = () => {
    if (process.listenerCount('SIGTERM') === 0) process.exit(0);
    process.emit('SIGTERM');
    setTimeout(() => process.exit(1), 15000).unref();
  };
  if (process.connected) process.send({ kind: 'dsh-stop-ack' }, notify); else notify();
}
process.once('disconnect', stop);
process.on('message', (message) => { if (message?.kind === 'stop') stop(); });
// 官方CLI仍解析原始app参数；这里只为所属进程补充父断开退出合同。
process.argv[1] = cli;
if (process.connected) process.send({ kind: 'dsh-startup-stage', stage: 'cli_importing' });
const { runCli } = await import(pathToFileURL(cli).href);
if (process.connected) process.send({ kind: 'dsh-startup-stage', stage: 'cli_loaded' });
await runCli();

if (process.connected) process.send({ kind: 'dsh-startup-stage', stage: 'boot_returned' });
