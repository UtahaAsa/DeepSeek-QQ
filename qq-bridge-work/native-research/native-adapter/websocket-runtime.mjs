import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 校验固定 ws 包中全部文件后加载纯JS服务端，禁用其可选原生加速模块。
 * @returns {Promise<object>} ws 的模块导出。
 * @throws {Error} 文件边界、版本、完整性记录或哈希不符时拒绝加载。
 * @note 只修改当前研究宿主进程的 WS_NO_* 环境变量，不执行安装或全局配置修改。
 */
export async function loadWebSocketRuntime() {
  const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
  const lock = JSON.parse(readFileSync(join(root, 'runtime-dependencies.lock.json'), 'utf8')).ws;
  const manifest = JSON.parse(readFileSync(join(root, 'dependencies', 'ws-manifest.json'), 'utf8'));
  const dependencyRoot = realpathSync(join(root, 'dependencies', 'ws'));
  if (!dependencyRoot.toLowerCase().startsWith((root + sep).toLowerCase()) || manifest.version !== lock.version ||
      manifest.integrity !== lock.integrity || manifest.license !== 'MIT') throw new Error('WEBSOCKET_BASELINE_CHANGED');
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[A-Za-z0-9_.\/-]+$/.test(name) || name.split('/').includes('..')) throw new Error('WEBSOCKET_PATH_REFUSED');
    const path = realpathSync(join(dependencyRoot, name));
    if (!path.toLowerCase().startsWith((dependencyRoot + sep).toLowerCase()) ||
      createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) throw new Error('WEBSOCKET_FILE_CHANGED');
  }
  process.env.WS_NO_BUFFER_UTIL = '1'; process.env.WS_NO_UTF_8_VALIDATE = '1';
  return import(pathToFileURL(join(dependencyRoot, 'wrapper.mjs')).href);
}
