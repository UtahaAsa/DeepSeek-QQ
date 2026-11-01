const phases = new Set(['not_started', 'disabled', 'idle', 'starting', 'loading_asr', 'warming_asr', 'loading_tts', 'warming_tts', 'switching', 'rolling_back', 'stop_failed', 'ready', 'failed', 'unavailable']);
/**
 * 投影所属桥接的语音状态，不保留路径、账号、正文、凭据或任意额外字段。
 * @param {object|null} value 来自所属子进程的阶段、布尔就绪值与毫秒计数。
 * @returns {object} 固定字段；未知阶段或自相矛盾的ready显示unavailable。
 * @note 同步、无I/O；就绪仅说明本机预热，不代表QQ实际送达或人工听感通过。
 */
export function projectVoiceStatus(value) {
  if (!value) return { phase: 'not_started' };
  const result = { phase: phases.has(value.phase) ? value.phase : 'unavailable' };
  for (const key of ['receiveEnabled', 'sendEnabled', 'asrReady', 'ttsReady', 'busy']) result[key] = value[key] === true;
  for (const key of ['elapsedMs', 'warmupMs', 'asrLoadMs', 'ttsLoadMs', 'lastProcessingMs', 'queued']) {
    result[key] = Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 3600000 ? value[key] : null;
  }
  if (result.phase === 'ready' && ((result.receiveEnabled && !result.asrReady) || (result.sendEnabled && !result.ttsReady))) result.phase = 'unavailable';
  return result;
}
