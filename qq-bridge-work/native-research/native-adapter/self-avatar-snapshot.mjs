import { createImageTransport } from '../../bridge/src/image-provider.js';
import { QQ_AVATAR_MAX_BYTES } from '../../bridge/src/qq-avatar-limits.js';
import { inspectProfileAvatar } from './profile-avatar-stage.mjs';

const fail = () => Object.assign(new Error('AVATAR_BACKUP_UNAVAILABLE'), { code: 'AVATAR_BACKUP_UNAVAILABLE' });

/**
 * 创建当前登录账号的头像备份读取器；只访问固定QQ头像域名，不接受模型URL或鉴权。
 * @param {object} options selfUin为所属运行会话身份，isCurrent每次异步后复核原许可版本；transport/now仅供隔离测试。
 * @returns {Function} async(context)返回已检查的静态头像字节；失败抛固定AVATAR_BACKUP_UNAVAILABLE，不输出账号或网络诊断。
 * @note 单次GET、2MiB/15秒总预算、禁止重定向；严格公网解析含已核验的全fake-IP专用DoH兼容。
 *   TLS/Host/SNI保持原域名，未改变通用safe-fetch或系统代理；不提交头像、不自动重试。
 */
export function createSelfAvatarSnapshotReader({ selfUin, isCurrent, transport = createImageTransport(), now = Date.now }) {
  if (typeof selfUin !== 'string' || !/^[1-9]\d{0,19}$/.test(selfUin)
      || ![isCurrent, transport, now].every(value => typeof value === 'function')) throw fail();
  const current = context => { if (isCurrent(context) !== true) throw fail(); };
  return async context => {
    let bytes;
    try {
      current(context);
      const time = now(); if (!Number.isSafeInteger(time) || time < 0) throw fail();
      const url = 'https://q1.qlogo.cn/g?b=qq&nk=' + selfUin + '&s=640&t=' + time;
      bytes = await transport(url, { method: 'GET', maxBytes: QQ_AVATAR_MAX_BYTES, timeoutMs: 15000 });
      current(context);
      if (!Buffer.isBuffer(bytes) || bytes.length > QQ_AVATAR_MAX_BYTES) throw fail();
      inspectProfileAvatar(bytes);
      const result = bytes; bytes = null; return result;
    } catch { bytes?.fill?.(0); throw fail(); }
  };
}
