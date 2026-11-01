/**
 * 创建常驻网关的有界心跳/初始化监督策略。
 * @param {object} options now为可注入时钟；默认心跳6秒、初始化60秒。
 * @returns {object} userStart/heartbeat/reason；reason仅返回固定失败原因或null。
 * @note ready立即结束初始化宽限，即使登录控制器仍保留session_initializing阶段。
 */
export function createGatewayWatchdog({ now = Date.now, heartbeatMs = 6000, initializationMs = 60000 } = {}) {
  let lastBeat = now(), deadline = 0, phase = 'idle';
  return {
    userStart() { if (phase === 'idle') { phase = 'initializing'; deadline = now() + initializationMs; } },
    heartbeat(nextPhase, gatewayState) {
      lastBeat = now();
      if (nextPhase === 'session_initializing' && phase !== nextPhase) deadline = now() + initializationMs;
      if (gatewayState === 'ready' || !['initializing', 'session_initializing'].includes(nextPhase)) deadline = 0;
      phase = nextPhase;
    },
    reason() {
      if (deadline && now() > deadline) return 'initialization_timeout';
      if (now() > Math.max(lastBeat + heartbeatMs, deadline)) return 'heartbeat_timeout';
      return null;
    },
  };
}
