import { existsSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { work, root, runtime, home, profile, cli, environment } from './environment.mjs';

// 初次准备采用排他标记；失败保留产物供诊断，不覆盖既有用户配置。
if (existsSync(join(root, 'prepared.json'))) {
  console.log(JSON.stringify({ status: 'already_prepared', productionReady: false }));
} else {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'prepare.lock'), '', { flag: 'wx' });
  mkdirSync(join(root, 'temp'), { recursive: true });
  const env = environment();
  const source = join(work, 'bridge');
  mkdirSync(runtime, { recursive: true });
  for (const name of ['src', 'scripts', 'plugins', 'dsh', 'roles', 'public', 'assets', 'package.json']) {
    cpSync(join(source, name), join(runtime, name), { recursive: true, errorOnExist: true, force: false,
      filter: (path) => !path.split(/[\\/]/).includes('node_modules') });
  }
  symlinkSync(realpathSync(join(source, 'node_modules')), join(runtime, 'node_modules'), 'junction');
  // 本组合禁用自动社交；新环境必须显式使用普通聊天，避免继承插件的 reserved2 默认值。
  // 只修改首次创建的副本；prepared.json 分支始终保留既有用户设置。
  writeFileSync(join(runtime, 'plugins', 'qq-mode-console', 'cordis.patch.yml'),
    '- insert:\n    - id: qq-mode\n      name: qq-mode-console\n      config:\n        mode: chat\n');
  mkdirSync(join(runtime, 'state'), { recursive: true });
  writeFileSync(join(runtime, 'state', 'mode.json'), JSON.stringify({ mode: 'chat', closedAgentPreset: '' }, null, 2));
  const initialized = spawnSync(process.execPath, [cli, '--profile', profile, '--from-default-profile', 'web', '--dump-config'],
    { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (initialized.status !== 0) throw new Error('PROFILE_INITIALIZATION_FAILED');
  const setup = spawnSync(process.execPath, [join(runtime, 'scripts', 'setup-dsh.mjs'), profile],
    { cwd: runtime, env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (setup.status !== 0) throw new Error('ISOLATED_SETUP_FAILED');
  const config = JSON.parse(readFileSync(join(work, 'templates', 'config.local.example.json'), 'utf8'));
  config.sessionCwd = join(root, 'sessions');
  config.nativeFeatureProtocol = 1;
  config.snowluma.wsUrl = 'ws://127.0.0.1:1'; config.snowluma.httpUrl = 'http://127.0.0.1:1';
  config.social.enabled = false; config.social.proactiveEnabled = false; config.socialV2.enabled = false;
  config.socialV2.sticker = { enabled: false }; config.slang.enabled = false;
  config.socialV2.voice = { enabled: false }; config.consolePort = 3100;
  writeFileSync(join(runtime, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'prepared.json'), JSON.stringify({ schemaVersion: 1, profile,
    status: 'prepared', dependencies: 'read-only-local-junction', dshHome: home, productionReady: false }, null, 2));
  unlinkSync(join(root, 'prepare.lock'));
  console.log(JSON.stringify({ status: 'prepared', productionReady: false }));
}
