/**
 * 创建所属DSH的有界启动行解析器；不保存或输出启动URL。
 * @param {string} expectedOrigin 本次预留的回环端点。
 * @param {(token:string)=>void} accept 内存凭据接收器；仅调用一次。
 * @returns {(chunk:Buffer|string)=>void} 按完整行解析，异常行忽略，缓存最多16KiB。
 * @note 单线程；不访问磁盘，不读取任何浏览器密钥。
 */
export function launchCapture(expectedOrigin, accept) {
  let pending = '', complete = false;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(expectedOrigin)) throw new Error('ENDPOINT_REFUSED');
  return (chunk) => {
    if (complete) return;
    pending = (pending + String(chunk)).slice(-16384);
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).replace(/\x1b\[[0-9;]*m/g, '').trim();
      pending = pending.slice(newline + 1);
      const match = line.match(/^dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)$/);
      if (!match) continue;
      try {
        const url = new URL(match[1]), token = url.searchParams.get('token');
        if (url.origin !== expectedOrigin || !token || token.length > 4096 || url.hash || [...url.searchParams.keys()].length !== 1) continue;
        complete = true; pending = ''; accept(token); return;
      } catch {}
    }
  };
}
