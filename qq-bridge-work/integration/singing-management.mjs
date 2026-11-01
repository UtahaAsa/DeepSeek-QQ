import { createBridgeManagementClient } from './role-management.mjs';

const definitions = new Map([['state', ['GET', '/api/singing/state']],
  ...['prepare', 'status', 'audio'].map(action => [action, ['POST', '/api/singing/' + action]])]);
const fail = () => new Error('SINGING_MANAGEMENT_UNAVAILABLE');

/**
 * 仅向本人工作台投影歌库、生成进度及有界音频分块，不允许页面发送QQ。
 * @param {object} options 沿用所属bridge管理客户端的OS身份、端口与代次检查。
 * @returns {Function} state/prepare/status/audio；每块最多128KiB，响应不含本地路径或模型日志。
 */
export function createSingingClient(options) {
  const request = createBridgeManagementClient({ ...options, definitions,
    fields: () => ['ok', 'songs', 'worker', 'job', 'songId', 'title', 'status', 'error', 'elapsedMs', 'durationMs',
      'actualRvcInference', 'sent', 'humanListeningAccepted', 'cached', 'offset', 'size', 'sha256', 'data'],
    unavailable: 'SINGING_MANAGEMENT_UNAVAILABLE', rejected: 'SINGING_MANAGEMENT_UNAVAILABLE' });
  return async (operation, input = {}) => {
    const value = await request(operation, input);
    if (value.ok !== true) throw fail();
    if (operation === 'state') {
      if (!Array.isArray(value.songs) || value.songs.length > 32) throw fail();
      return { songs: value.songs.map(song => {
        if (!/^[a-z0-9-]{1,48}$/.test(song.id ?? '') || typeof song.title !== 'string' || song.title.length > 80
            || !Number.isInteger(song.defaultPitch) || Math.abs(song.defaultPitch) > 12) throw fail();
        return { id: song.id, title: song.title, defaultPitch: song.defaultPitch };
      }) };
    }
    if (!/^[a-f0-9]{32}$/.test(value.job ?? '')) throw fail();
    if (operation === 'audio') {
      if (value.offset !== input.offset || !Number.isSafeInteger(value.size) || value.size < 46 || value.size > 3 * 1024 * 1024
          || !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || typeof value.data !== 'string' || value.data.length > 174764
          || Buffer.from(value.data, 'base64').toString('base64') !== value.data) throw fail();
      return { job: value.job, offset: value.offset, size: value.size, sha256: value.sha256, data: value.data };
    }
    if (!['preparing', 'prepared', 'failed', 'cancelled', 'sent', 'sending', 'send_unconfirmed'].includes(value.status)
        || !Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0) throw fail();
    return { job: value.job, title: value.title, status: value.status, elapsedMs: value.elapsedMs,
      durationMs: value.durationMs, actualRvcInference: value.actualRvcInference === true, sent: false,
      humanListeningAccepted: false, cached: value.cached === true };
  };
}
