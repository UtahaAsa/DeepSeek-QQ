import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';

const root = realpathSync(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * 校验固定宿主与构建指纹后加载自有控制模块。
 * @returns {{control: object}} 未启动绑定的控制对象。
 * @throws {Error} 版本、平台、线程、文件边界或指纹不符时在原生加载前拒绝。
 * @note 主线程同步调用；不加载 QQ 模块、不启动登录、不获取 QQ 会话。
 */
export function loadNativePrototype() {
  if (!isMainThread || process.platform !== 'win32' || process.arch !== 'x64' || process.versions.node !== '24.15.0') {
    throw new Error('原型只允许固定 Windows x64 Node24.15.0 主线程');
  }
  const lock = JSON.parse(readFileSync(join(root, 'toolchain.lock.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'build', 'build-manifest.json'), 'utf8'));
  if (!manifest.prototypeOnly || manifest.qqLoaded !== false || manifest.nodeSha256 !== lock.node.sha256 ||
      hashFile(process.execPath) !== lock.node.sha256 || manifest.coveredWrapperImports !== 99) {
    throw new Error('宿主或构建基线不匹配');
  }
  const outputRoot = realpathSync(join(root, 'build'));
  if (!outputRoot.toLowerCase().startsWith((root + sep).toLowerCase())) throw new Error('构建目录越界');
  const paths = {};
  for (const name of ['QQNT.dll', 'control.node']) {
    const path = realpathSync(join(outputRoot, name));
    if (dirname(path).toLowerCase() !== outputRoot.toLowerCase() || hashFile(path) !== manifest.files[name]) {
      throw new Error(`原型文件指纹或边界不匹配：${name}`);
    }
    paths[name] = path;
  }
  return {
    control: require(paths['control.node']),
  };
}
