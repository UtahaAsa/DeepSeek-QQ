import { randomBytes } from 'node:crypto';
import { OneBotWebSocketClient } from '../../bridge/src/onebot-client.js';
import { createNativeTextBridge } from './native-text-bridge.mjs';
import { createOneBotServer } from './onebot-server.mjs';

export const textTrialMessages = Object.freeze({ privateIncoming: '桥接私聊入站测试', groupIncoming: '桥接群聊入站测试',
  privateOutgoing: 'QQ桥接私聊连通测试', groupOutgoing: 'QQ桥接群聊连通测试' });
const numericId = (value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : null;
const adapterKeys = ['privateReceived', 'groupReceived', 'malformed', 'ignored', 'sendsAttempted', 'sendsConfirmed',
  'sendsRejected', 'sendsUnknown', 'duplicates', 'eventConsumerErrors', 'pendingSends', 'cachedMessages'];

/**
 * 一好友/一群的手动文字试验编排；只在run接收已初始化的会话后注册消息监听。
 * @param {{onStage?:function(string):Promise<void>, onReady?:function(number):void, receiveOnly?:boolean}} options
 *   onReady只供合成夹具注入事件；receiveOnly关闭发送/确认/重连，两种入站齐全后结束。正式宿主不提供onReady。
 * @returns {object} configure/run/sendTest/confirmReceipt/reconnect/stop/snapshot；目标值、消息正文和令牌不在snapshot中。
 * @note 固定出站文字各最多1次，须用户按钮触发；一次本机WS重连后要求再次收到两种标记。
 *       这验证OneBot传输恢复，不执行QQ重登或主动断开QQ网络。默认不启动任何原生/网络操作。
 */
export function createTextTrial({ onStage = async () => {}, onReady = () => {}, receiveOnly = false } = {}) {
  let scope = null, state = 'idle', reason = null, began = false, closing = false, closeTask = null, setupTask = null;
  let backend = null, server = null, client = null, complete = false, settle = null, settled = false, signal = null, abort = null;
  let reconnects = 0, privateReceived = 0, groupReceived = 0, privateMarker = false, groupMarker = false;
  let privateAfterReconnect = false, groupAfterReconnect = false, privateSend = 'not_sent', groupSend = 'not_sent';
  let privateRecipientConfirmed = false, groupRecipientConfirmed = false;
  const snapshot = () => {
    const native = backend?.snapshot();
    return { configured: scope !== null, receiveOnly, state, reason, complete, privateReceived, groupReceived, privateMarker, groupMarker,
      privateAfterReconnect, groupAfterReconnect, privateSend, groupSend, privateRecipientConfirmed, groupRecipientConfirmed, reconnects,
      transportConnected: client?.isConnected ?? false, listenerHandleKind: native?.listenerHandleKind ?? 'unobserved',
      listenerRemovalVerified: native?.listenerRemovalVerified ?? false, cleanupRequired: native?.cleanupRequired ?? false,
      nativeCounters: Object.fromEntries(adapterKeys.map((key) => [key, native?.[key] ?? 0])) };
  };
  function configure(value) {
    if (began || closing || !value || Object.keys(value).length !== 2) return false;
    const friendUin = numericId(Object.getOwnPropertyDescriptor(value, 'friendUin')?.value);
    const groupUin = numericId(Object.getOwnPropertyDescriptor(value, 'groupUin')?.value);
    if (!friendUin || !groupUin) return false;
    scope = { friendUin, groupUin }; return true;
  }
  function finish(ok, code = null) {
    if (settled) return;
    settled = true; complete = ok; reason = code;
    state = ok ? 'complete' : code === 'cancelled' ? 'stopped' : 'failed';
    settle?.(ok);
  }
  function checkComplete() {
    if (closing || settled) return;
    if (receiveOnly) { if (privateMarker && groupMarker) finish(true); return; }
    if (privateMarker && groupMarker && privateSend === 'confirmed' && groupSend === 'confirmed' && privateRecipientConfirmed && groupRecipientConfirmed && reconnects === 1 && privateAfterReconnect && groupAfterReconnect) finish(true);
  }
  function receive(kind, event) {
    if (state !== 'ready') return;
    const correctTarget = kind === 'private' ? String(event.user_id) === scope.friendUin : String(event.group_id) === scope.groupUin;
    if (!correctTarget) return;
    if (kind === 'private') {
      privateReceived = Math.min(privateReceived + 1, 1000000);
      if (event.raw_message === textTrialMessages.privateIncoming) { privateMarker = true; if (reconnects) privateAfterReconnect = true; }
    } else {
      groupReceived = Math.min(groupReceived + 1, 1000000);
      if (event.raw_message === textTrialMessages.groupIncoming) { groupMarker = true; if (reconnects) groupAfterReconnect = true; }
    }
    checkComplete();
  }
  async function run({ session, self, signal: lifetimeSignal }) {
    if (began || !scope || scope.friendUin === self.uin || closing) {
      if (!began && !closing) { state = 'failed'; reason = 'scope_refused'; }
      throw new Error('TEXT_TRIAL_SCOPE_REFUSED');
    }
    began = true; signal = lifetimeSignal; state = 'preparing';
    const lifetime = new Promise((resolve) => { settle = resolve; });
    abort = () => { finish(false, 'cancelled'); void stop(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    setupTask = (async () => {
      if (closing) return;
      backend = createNativeTextBridge({ session, self, sessionInitialized: true, friendUins: [scope.friendUin], groupUins: [scope.groupUin],
        allowReceive: true, allowSend: !receiveOnly, maxSends: receiveOnly ? 0 : 2, sendTimeoutMs: 10000 });
      backend.on('status', (value) => { if (!closing && value.online === false) finish(false, 'qq_offline'); });
      await onStage('before_text_listener'); if (closing) return;
      backend.start(); await onStage('after_text_listener'); if (closing || settled) return;
      const accessToken = randomBytes(32).toString('hex');
      server = await createOneBotServer({ backend, accessToken }); if (closing) return;
      client = new OneBotWebSocketClient({ url: server.url, accessToken, reconnect: false, connectTimeoutMs: 5000, requestTimeoutMs: 12000 });
      client.onPrivateMessage((event) => receive('private', event)); client.onGroupMessage((event) => receive('group', event));
      client.on('close', () => { if (!closing && state === 'ready') finish(false, 'transport_closed'); });
      await client.connect(); if (closing || settled) return;
      state = 'ready'; await onStage('text_transport_ready'); onReady(0);
    })();
    try {
      await setupTask;
      if (!settled && closing) finish(false, 'cancelled');
    } catch { finish(false, 'text_prepare'); }
    const passed = await lifetime;
    await stop(); return passed;
  }
  async function sendTest(kind) {
    if (receiveOnly || state !== 'ready' || !['private', 'group'].includes(kind)) return false;
    if (kind === 'private' ? !privateMarker || privateSend !== 'not_sent' : !groupMarker || groupSend !== 'not_sent') return false;
    if (kind === 'private') privateSend = 'pending'; else groupSend = 'pending';
    let result = 'unknown';
    try {
      const privateKind = kind === 'private';
      const response = await client.request(privateKind ? 'send_private_msg' : 'send_group_msg', {
        [privateKind ? 'user_id' : 'group_id']: privateKind ? scope.friendUin : scope.groupUin,
        message: [{ type: 'text', data: { text: privateKind ? textTrialMessages.privateOutgoing : textTrialMessages.groupOutgoing } }],
      });
      result = response.status === 'ok' && response.retcode === 0 && Number.isSafeInteger(response.data?.message_id) ? 'confirmed' :
        response.retcode === 1501 ? 'unknown' : 'rejected';
    } catch { result = 'unknown'; }
    // 终态先冻结在途发送为未知；迟到的传输结果不能改写已上报的快照。
    if (closing || settled) return false;
    if (kind === 'private') privateSend = result; else groupSend = result;
    checkComplete(); return result === 'confirmed';
  }
  async function reconnect() {
    if (receiveOnly || state !== 'ready' || reconnects !== 0 || privateSend !== 'confirmed' || groupSend !== 'confirmed') return false;
    state = 'reconnecting'; reconnects = 1;
    try {
      client.close(); await client.connect();
      if (closing || settled) return false;
      state = 'ready'; await onStage('text_transport_reconnected'); onReady(1); return true;
    } catch { finish(false, 'reconnect_failed'); return false; }
  }
  function confirmReceipt(kind) {
    if (receiveOnly || state !== 'ready') return false;
    if (kind === 'private' && privateSend === 'confirmed') privateRecipientConfirmed = true;
    else if (kind === 'group' && groupSend === 'confirmed') groupRecipientConfirmed = true;
    else return false;
    checkComplete(); return true;
  }
  function stop() {
    if (closeTask) return closeTask;
    closing = true;
    if (privateSend === 'pending') privateSend = 'unknown';
    if (groupSend === 'pending') groupSend = 'unknown';
    if (!settled) finish(false, 'cancelled');
    closeTask = (async () => {
      try { await setupTask; } catch {}
      signal?.removeEventListener('abort', abort);
      backend?.stop(); client?.close();
      if (server) await server.close();
    })();
    return closeTask;
  }
  return Object.freeze({ configure, run, sendTest, confirmReceipt, reconnect, stop, snapshot });
}

/**
 * 将登录控制器与文字试验组合成本机页面接口，不暴露原生对象或账号目标。
 * @param {object} login 既有登录控制器。
 * @param {object} trial 当前一次文字试验。
 * @returns {object} 页面使用的固定动作；目标配置在开始登录后冻结，未配置不得启动。
 */
export function bindTextTrialController(login, trial) {
  return Object.freeze({
    start: () => trial.snapshot().configured && login.start(),
    configure: (value) => !login.snapshot().started && login.snapshot().phase === 'idle' && trial.configure(value),
    refresh: () => login.refresh(), stop: (...args) => login.stop(...args), readQr: () => login.readQr(),
    sendTest: (kind) => trial.sendTest(kind), confirmReceipt: (kind) => trial.confirmReceipt(kind), reconnect: () => trial.reconnect(),
    snapshot: () => {
      const state = login.snapshot(), textState = trial.snapshot();
      if (state.phase === 'session_initializing' && ['ready', 'reconnecting'].includes(textState.state)) {
        state.phase = textState.state === 'ready' ? 'text_ready' : 'text_reconnecting';
      }
      return { ...state, textTrial: textState };
    },
  });
}

/**
 * 将跨子进程的文字结果限制为固定枚举、布尔值和计数；不透传额外字段。
 * @param {unknown} value 子进程结果。
 * @returns {object|null|undefined} 白名单结果、未执行的null，或表示格式无效的undefined。
 */
export function sanitizeTextTrial(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const out = {};
  for (const key of ['configured', 'receiveOnly', 'complete', 'privateMarker', 'groupMarker', 'privateAfterReconnect', 'groupAfterReconnect',
    'privateRecipientConfirmed', 'groupRecipientConfirmed', 'transportConnected', 'listenerRemovalVerified', 'cleanupRequired']) {
    if (typeof value[key] !== 'boolean') return undefined;
    out[key] = value[key];
  }
  const enums = { state: ['idle', 'preparing', 'ready', 'reconnecting', 'complete', 'stopped', 'failed'],
    reason: [null, 'scope_refused', 'cancelled', 'qq_offline', 'transport_closed', 'text_prepare', 'reconnect_failed'],
    privateSend: ['not_sent', 'pending', 'confirmed', 'unknown', 'rejected'],
    groupSend: ['not_sent', 'pending', 'confirmed', 'unknown', 'rejected'],
    listenerHandleKind: ['unobserved', 'undefined', 'null', 'true', 'false', 'number', 'string', 'object', 'function', 'bigint', 'symbol'] };
  for (const [key, allowed] of Object.entries(enums)) {
    if (!allowed.includes(value[key])) return undefined;
    out[key] = value[key];
  }
  for (const key of ['privateReceived', 'groupReceived', 'reconnects']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > (key === 'reconnects' ? 1 : 1000000)) return undefined;
    out[key] = value[key];
  }
  out.nativeCounters = {};
  for (const key of adapterKeys) {
    const count = value.nativeCounters?.[key];
    if (!Number.isSafeInteger(count) || count < 0 || count > 1000000) return undefined;
    out.nativeCounters[key] = count;
  }
  return out;
}
