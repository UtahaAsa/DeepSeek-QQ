import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { isMainThread } from 'node:worker_threads';
const require = createRequire(import.meta.url);
let cached;
/**
 * 核验自有管道模块及固定Node指纹后加载；不加载QQ、不执行系统设置变更。
 * @returns {object} 仅供内存管道交接的同步原生接口；读取/关闭最多等待约4秒。
 * @throws {Error} 平台、线程、边界、指纹不符时固定脱敏错误。
 */
export function loadSecurePipeRuntime() {
  if (cached) return cached;
  try {
    if (!isMainThread || process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '24.15.0') throw new Error();
    const root = realpathSync(dirname(fileURLToPath(import.meta.url))), build = realpathSync(join(root, 'build'));
    const file = realpathSync(join(build, 'secure-pipe.node'));
    if (!build.toLowerCase().startsWith((root + sep).toLowerCase()) || dirname(file).toLowerCase() !== build.toLowerCase()) throw new Error();
    const manifest = JSON.parse(readFileSync(join(build, 'secure-pipe-manifest.json'), 'utf8'));
    const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
    const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8'));
    if (manifest.nodeSha256 !== lock.node.sha256 || digest(process.execPath) !== lock.node.sha256 ||
        digest(file) !== manifest.binarySha256 || manifest.qqLoaded !== false || manifest.qqImports !== false) throw new Error();
    cached = require(file); return cached;
  } catch { throw new Error('SECURE_PIPE_RUNTIME_UNAVAILABLE'); }
}
