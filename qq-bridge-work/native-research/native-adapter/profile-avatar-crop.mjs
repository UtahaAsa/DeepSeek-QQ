import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { inspectProfileAvatar } from './profile-avatar-stage.mjs';

const fail = code => Object.assign(new Error(code), { code });
const worker = fileURLToPath(new URL('./profile-avatar-crop-worker.mjs', import.meta.url));

/** 校验头像裁剪参数；中心为原图归一化坐标，zoom=1保留最大正方形。@param {object} value centerX/centerY/zoom。@returns {object} 冻结副本；不执行I/O。 */
export function normalizeAvatarCrop(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Reflect.ownKeys(value).some(key => !['centerX', 'centerY', 'zoom'].includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw fail('AVATAR_CROP_INVALID');
  const result = { centerX: value.centerX ?? 0.5, centerY: value.centerY ?? 0.5, zoom: value.zoom ?? 1 };
  if (![result.centerX, result.centerY, result.zoom].every(Number.isFinite)
      || result.centerX < 0 || result.centerX > 1 || result.centerY < 0 || result.centerY > 1
      || result.zoom < 1 || result.zoom > 8) throw fail('AVATAR_CROP_INVALID');
  return Object.freeze(result);
}

/**
 * 在固定独立Node子进程中解码、定位置及缩放头像；不安装依赖或传递QQ凭据。
 * @param {Buffer} bytes 当前会话已授权图片副本，最大8MiB/1600万像素；不修改输入。
 * @param {object} crop centerX/centerY在0至1，zoom在1至8。
 * @param {object} options sharpAnchor为已有DSH依赖锚点，timeoutMs有界，signal撤销即结束子进程。
 * @returns {Promise<Buffer>} 512平方静态PNG；失败只返回固定错误，无自动重试。
 */
export function cropProfileAvatar(bytes, crop, { sharpAnchor = process.env.QQ_WORKSPACE_DSH_ANCHOR,
  timeoutMs = 8000, signal } = {}) {
  inspectProfileAvatar(bytes); const spec = normalizeAvatarCrop(crop);
  if (!path.isAbsolute(sharpAnchor ?? '') || !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 15000)
    return Promise.reject(fail('AVATAR_CROP_UNAVAILABLE'));
  if (signal?.aborted) return Promise.reject(fail('AVATAR_CROP_CANCELLED'));
  return new Promise((resolve, reject) => {
    let failure = null, size = 0, settled = false; const chunks = [];
    const child = spawn(process.execPath, ['--max-old-space-size=96', worker, JSON.stringify(spec)], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
      env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(process.execPath),
        TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_DISABLE_COMPILE_CACHE: '1',
        QQ_AVATAR_SHARP_ANCHOR: sharpAnchor },
    });
    const cancel = () => { failure ??= fail('AVATAR_CROP_CANCELLED'); child.kill(); };
    const timer = setTimeout(() => { failure ??= fail('AVATAR_CROP_TIMEOUT'); child.kill(); }, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const finish = (code) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      let output;
      try {
        if (failure || code !== 0) throw failure ?? fail('AVATAR_CROP_FAILED');
        output = Buffer.concat(chunks, size); const info = inspectProfileAvatar(output);
        if (info.format !== 'png' || info.width !== 512 || info.height !== 512) throw fail('AVATAR_CROP_FAILED');
        resolve(output);
      } catch (error) { output?.fill(0); reject(error?.code ? error : fail('AVATAR_CROP_FAILED')); }
      finally { for (const chunk of chunks) chunk.fill(0); }
    };
    child.on('error', () => { failure ??= fail('AVATAR_CROP_UNAVAILABLE'); finish(-1); });
    child.on('close', finish);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { failure ??= fail('AVATAR_CROP_FAILED'); child.kill(); return; }
      chunks.push(chunk);
    });
    child.stdin.on('error', () => { failure ??= fail('AVATAR_CROP_FAILED'); });
    child.stdin.end(bytes);
  });
}
