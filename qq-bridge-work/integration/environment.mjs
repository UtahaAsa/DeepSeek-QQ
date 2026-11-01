import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const work = dirname(dirname(fileURLToPath(import.meta.url)));
export const deployment = join(dirname(work), 'deployment', 'DeepSeek-Harness-Windows');
export const cli = join(deployment, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
export const root = resolve(work, 'integration', 'data');
export const runtime = join(root, 'bridge');
export const home = join(root, 'dsh');
export const profile = 'qq-native';
export const gateway = join(work, 'native-research', 'native-adapter');
/**
 * 构造本任务子进程环境；不修改父进程或全局设置。
 * @returns {object} 临时目录、缓存和DSH_HOME均限定在自有目录，清除继承启动凭据。
 */
export function environment() {
  const env = { ...process.env, DSH_HOME: home, QQ_BRIDGE_RUNTIME_ROOT: runtime,
    QQ_WORKSPACE_DSH_ANCHOR: join(deployment, 'engine', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    QQ_BRIDGE_SKIP_DSH_INSTALL: '1', QQ_MODE_DIAG: '',
    TEMP: join(root, 'temp'), TMP: join(root, 'temp'),
    npm_config_cache: join(root, 'cache', 'npm'), XDG_CACHE_HOME: join(root, 'cache'),
    NODE_COMPILE_CACHE: join(root, 'cache', 'node-compile'),
    HF_HOME: join(root, 'cache', 'hf'), TORCH_HOME: join(root, 'cache', 'torch'),
    PIP_CACHE_DIR: join(root, 'cache', 'pip'), UV_CACHE_DIR: join(root, 'cache', 'uv'),
    PLAYWRIGHT_BROWSERS_PATH: join(root, 'cache', 'playwright'), COREPACK_HOME: join(root, 'cache', 'corepack'),
    PNPM_HOME: join(root, 'cache', 'pnpm'), PATH: dirname(process.execPath) + ';' + process.env.PATH };
  for (const key of ['DSH_LAUNCH_TOKEN', 'DSH_BRIDGE_LAUNCH_TOKEN', 'SNOWLUMA_TOKEN', 'SNOWLUMA_HOME',
    'SNOWLUMA_HTTP_URL', 'QQ_NATIVE_GATEWAY_STATUS', 'QQ_NATIVE_GATEWAY_ALLOW_FIXTURE']) delete env[key];
  // 独立profile由用户本机配置；不顺带继承调用方的模型/浏览器身份。
  for (const key of Object.keys(env)) {
    if (/^(?:DSH|DEEPSEEK|OPENAI|ANTHROPIC).*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)/i.test(key)) delete env[key];
  }
  return env;
}
