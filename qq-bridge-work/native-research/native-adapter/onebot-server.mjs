import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { loadWebSocketRuntime } from './websocket-runtime.mjs';
import { QZONE_PUBLIC_ERROR_CODES } from './native-qzone.mjs';
import { STICKER_ERROR_CODES } from './native-stickers.mjs';

const safeCodes = new Set(['PERMISSION_REVISION_CHANGED', 'SEND_DISABLED', 'TARGET_NOT_ALLOWED', 'SEND_LIMIT', 'TEXT_LIMIT', 'UNSUPPORTED_MESSAGE',
  'FRIEND_NOT_OBSERVED', 'SEND_PREPARATION_FAILED', 'SEND_REJECTED', 'SEND_OUTCOME_UNKNOWN', 'MESSAGE_NOT_CACHED',
  'MENTION_NOT_OBSERVED', 'MENTION_PRIVATE', 'MENTION_MAPPING_CONFLICT', 'IMAGE_DISABLED', 'IMAGE_LIMIT',
  'IMAGE_NOT_CACHED', 'IMAGE_CHUNK_INVALID', 'IMAGE_FORMAT_INVALID', 'IMAGE_DOWNLOAD_FAILED', 'IMAGE_DOWNLOAD_TIMEOUT',
  'IMAGE_FILE_REFUSED', 'IMAGE_PREPARATION_FAILED', 'MEMBER_NOT_OBSERVED', 'VOICE_DISABLED', 'VOICE_LIMIT',
  'VOICE_NOT_CACHED', 'VOICE_CHUNK_INVALID', 'VOICE_FORMAT_INVALID', 'VOICE_DOWNLOAD_FAILED', 'VOICE_DOWNLOAD_TIMEOUT',
  'VOICE_FILE_REFUSED', 'VOICE_PREPARATION_FAILED', 'SELF_AVATAR_UNAVAILABLE', 'IDLE_NOT_ALLOWED', 'IDLE_CLAIM_INVALID', 'IMAGE_GENERATION_NOT_ALLOWED',
  'GROUP_ADMIN_NOT_ALLOWED', 'GROUP_ADMIN_BUSY', 'GROUP_ADMIN_REPEAT_REFUSED', 'GROUP_ADMIN_CLOCK_INVALID', 'GROUP_ADMIN_TIMEOUT',
  'GROUP_ADMIN_REQUEST_INVALID', 'GROUP_ADMIN_MEMBER_UNVERIFIED', 'GROUP_ADMIN_ROLE_REFUSED', 'GROUP_ADMIN_AT_ALL_REFUSED', 'GROUP_ADMIN_UNAVAILABLE', ...QZONE_PUBLIC_ERROR_CODES,
  'SELF_PROFILE_NOT_ALLOWED', 'SELF_PROFILE_BUSY', 'SELF_PROFILE_VALUE_INVALID', 'SELF_PROFILE_CONTENT_REFUSED',
  'SELF_PROFILE_REQUEST_INVALID', 'SELF_PROFILE_CLOCK_INVALID', 'SELF_PROFILE_LIMIT', 'SELF_PROFILE_SUBJECT_UNVERIFIED',
  'SELF_PROFILE_AVATAR_UNAVAILABLE', 'GROUP_MEMBER_INPUT_INVALID', 'FRIEND_STATUS_NOT_ALLOWED', 'FRIEND_STATUS_UNAVAILABLE', ...STICKER_ERROR_CODES,
  'PHONE_NOT_ALLOWED','PHONE_NOT_READY','PHONE_INPUT_INVALID','PHONE_NOT_CONNECTED','PHONE_STOP_UNCONFIRMED','PHONE_PREPARE_UNCONFIRMED',
  'CALL_STALE','CALL_BUSY','CALL_STATE_INVALID','CALL_REASON_INVALID','CALL_OUTGOING_UNAVAILABLE','CALL_AUDIO_STALE']);

/**
 * 为受控文字适配器提供 OneBot v11 正向 WebSocket，只绑定回环并要求宿主生成的内存令牌。
 * @param {object} options backend 提供文字与状态API；accessToken 不得写日志/报告；port默认0。
 * @returns {Promise<object>} 无令牌的url、仅计数snapshot、close；启动本服务不会调用backend.start。
 * @note /、/api、/event 使用固定动作表。未知动作拒绝，掉线不重放发送，慢客户端关闭。
 *       身份/消息仅通过已鉴权连接传给本机桥接，服务自身不保存正文或访问日志。
 */
export async function createOneBotServer({ backend, accessToken, port = 0, heartbeatMs = 15000 }) {
  if (typeof accessToken !== 'string' || accessToken.length < 32 || accessToken.length > 128 ||
      !Number.isSafeInteger(port) || port < 0 || port > 65535 || !Number.isSafeInteger(heartbeatMs) || heartbeatMs < 50) throw new Error('ONEBOT_CONFIG_INVALID');
  const { WebSocketServer, WebSocket } = await loadWebSocketRuntime();
  const counts = { connections: 0, rejectedConnections: 0, actions: 0, unsupportedActions: 0, malformedFrames: 0, slowConsumers: 0, socketErrors: 0 };
  let endpointHost = '', closing = false, closeTask = null;
  const server = createServer((_request, response) => { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end(); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false, clientTracking: true });
  const subscriptions = new Map();
  const isAuthenticated = (candidate) => typeof candidate === 'string' && Buffer.byteLength(candidate) === Buffer.byteLength(accessToken) &&
    timingSafeEqual(Buffer.from(candidate), Buffer.from(accessToken));
  const send = (socket, value) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 262144) { counts.slowConsumers++; socket.close(1013); return; }
    try { socket.send(JSON.stringify(value)); } catch { counts.socketErrors++; socket.terminate(); }
  };
  const broadcast = (event) => { for (const [socket, kind] of subscriptions) if (kind !== 'api') send(socket, event); };
  const timestamp = () => Math.floor(Date.now() / 1000);
  const statusEvent = () => ({ time: timestamp(), self_id: backend.getLoginInfo().user_id, post_type: 'meta_event',
    meta_event_type: 'heartbeat', status: backend.getStatus(), interval: heartbeatMs });
  const offMessage = backend.on('message', broadcast);
  const offStatus = backend.on('status', () => broadcast(statusEvent()));
  const offActivity = backend.on('activity', broadcast);
  const offPermissions = backend.on('permissions', value => broadcast({ time: timestamp(), post_type: 'meta_event',
    meta_event_type: 'native_policy_changed', configurationRevision: value.configurationRevision }));
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => { counts.socketErrors++; });
    let address;
    try { if (!request.url || request.url.length > 1024) throw new Error(); address = new URL(request.url, 'http://' + endpointHost); } catch { counts.rejectedConnections++; socket.destroy(); return; }
    const route = address.pathname.replace(/\/$/, '') || '/';
    const queryToken = address.searchParams.get('access_token');
    const headerToken = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : null;
    const allowed = !closing && request.headers.host === endpointHost && !request.headers.origin && wss.clients.size < 2 &&
      ['/', '/api', '/event'].includes(route) && isAuthenticated(queryToken ?? headerToken) &&
      (queryToken === null || headerToken === null || queryToken === headerToken) && address.searchParams.getAll('access_token').length <= 1;
    if (!allowed) { counts.rejectedConnections++; socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      counts.connections++;
      subscriptions.set(ws, route === '/api' ? 'api' : route === '/event' ? 'event' : 'both');
      wss.emit('connection', ws);
    });
  });
  wss.on('connection', (socket) => {
    let inFlight = 0;
    socket.on('error', () => { counts.socketErrors++; });
    socket.on('close', () => subscriptions.delete(socket));
    if (subscriptions.get(socket) !== 'api') send(socket, { time: timestamp(), self_id: backend.getLoginInfo().user_id,
      post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' });
    socket.on('message', async (bytes, binary) => {
      if (closing || socket.readyState !== WebSocket.OPEN) return;
      if (subscriptions.get(socket) === 'event') return;
      let request;
      try {
        if (binary) throw new Error();
        request = JSON.parse(bytes.toString('utf8'));
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string' ||
          (request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)))) throw new Error();
      } catch { counts.malformedFrames++; socket.close(1007); return; }
      const echo = Object.hasOwn(request, 'echo') ? { echo: request.echo } : {};
      if (inFlight >= 8) { send(socket, { status: 'failed', retcode: 1503, data: null, ...echo }); return; }
      inFlight++; counts.actions++;
      try {
        const params = request.params ?? {};
        const revision = backend.snapshot?.().configurationRevision;
        if (!['get_status', 'get_login_info', 'get_version_info','close_phone'].includes(request.action)
            && Number.isSafeInteger(revision) && ((revision > 1 && request.qq_policy_revision !== revision)
              || request.qq_policy_revision !== undefined && request.qq_policy_revision !== revision)) {
          throw Object.assign(new Error(), { code: 'PERMISSION_REVISION_CHANGED' });
        }
        let data;
        switch (request.action) {
          case 'get_status': data = backend.getStatus(); break;
          case 'prepare_phone':data=await backend.preparePhone(params);break;
          case 'phone_poll':
          case 'close_phone':
            if(Object.keys(params).length)throw Object.assign(new Error(),{code:'PHONE_INPUT_INVALID'});
            data=request.action==='phone_poll'?backend.pollPhone():await backend.closePhone();break;
          case 'read_phone_audio':data=backend.readPhoneAudio(params);break;
          case 'write_phone_audio':data=await backend.writePhoneAudio(params);break;
          case 'clear_phone_audio':data=await backend.clearPhoneAudio(params);break;
          case 'phone_media_status':data=await backend.phoneMediaStatus(params);break;
          case 'accept_phone_call':data=await backend.acceptPhoneCall(params);break;
          case 'start_phone_call':data=await backend.startPhoneCall(params);break;
          case 'end_phone_call':data=await backend.endPhoneCall(params);break;
          case 'get_login_info': data = await (backend.readLoginInfo ? backend.readLoginInfo() : backend.getLoginInfo()); break;
          case 'get_version_info': data = { app_name: 'QQ Bridge Native', app_version: '0.1.0-prototype', protocol_version: 'v11' }; break;
          case 'get_msg': data = backend.getMessage(params.message_id); break;
          case 'get_observed_member': data = backend.getObservedMember(params.kind, params.peer_id, params.user_id); break;
          case 'get_observed_group_members':
            if (Object.keys(params).some(key => !['group_id','limit'].includes(key))) throw Object.assign(new Error(), { code: 'GROUP_MEMBER_INPUT_INVALID' });
            data = backend.getObservedGroupMembers(params.group_id, params.limit); break;
          case 'get_observed_friend_status':
            if (Object.keys(params).some(key => !['kind','peer_id','user_id'].includes(key))) throw Object.assign(new Error(), { code: 'FRIEND_STATUS_NOT_ALLOWED' });
            data = backend.getObservedFriendStatus(params.kind, params.peer_id, params.user_id); break;
          case 'inspect_observed_friend_request':
            if (Object.keys(params).length !== 3 || Object.keys(params).some(key => !['kind','peer_id','user_id'].includes(key))) throw Object.assign(new Error(), { code: 'FRIEND_STATUS_NOT_ALLOWED' });
            data = await backend.inspectObservedFriendRequest(params.kind, params.peer_id, params.user_id); break;
          case 'approve_inspected_friend_request':
            if (Object.keys(params).length !== 1 || !/^qqreq_[a-f0-9]{48}$/.test(params.reviewId ?? '')) throw Object.assign(new Error(), { code: 'FRIEND_REQUEST_REVIEW_NOT_ALLOWED' });
            data = await backend.approveInspectedFriendRequest(params.reviewId); break;
          case 'get_self_avatar_subject': data = await (backend.readSelfAvatarSubject ? backend.readSelfAvatarSubject(params.kind, params.peer_id) : backend.getSelfAvatarSubject(params.kind, params.peer_id)); break;
          case 'get_image_generation_subject': data = backend.getImageGenerationSubject(params.kind, params.peer_id); break;
          case 'get_group_admin_subject': data = backend.getGroupAdminSubject(params.action, params.group_id); break;
          case 'get_qzone_subject': data = backend.getQzoneSubject(params.kind, params.peer_id); break;
          case 'get_self_profile_subject':
            if (Object.keys(params).length !== 3 || Object.keys(params).some(key => !['kind', 'peer_id', 'field'].includes(key))) throw Object.assign(new Error(), { code: 'SELF_PROFILE_NOT_ALLOWED' });
            data = backend.getSelfProfileSubject(params.kind, params.peer_id, params.field); break;
          case 'update_self_profile':
            if (Object.keys(params).length !== 4 || Object.keys(params).some(key => !['kind', 'peer_id', 'field', 'value'].includes(key))) throw Object.assign(new Error(), { code: 'SELF_PROFILE_NOT_ALLOWED' });
            data = await backend.updateSelfProfile(params.kind, params.peer_id, { field: params.field, value: params.value }); break;
          case 'read_self_profile':
            if (Object.keys(params).length !== 3 || Object.keys(params).some(key => !['kind','peer_id','field'].includes(key))) throw Object.assign(new Error(), { code: 'SELF_PROFILE_NOT_ALLOWED' });
            data = await backend.readSelfProfile(params.kind, params.peer_id, params.field); break;
          case 'prepare_self_avatar':
            if (Object.keys(params).some(key => !['kind','peer_id','operation','file','crop'].includes(key))) throw Object.assign(new Error(), { code: 'SELF_PROFILE_NOT_ALLOWED' });
            data = await backend.prepareSelfAvatar(params.kind, params.peer_id, { operation: params.operation,
              ...(Object.hasOwn(params, 'file') ? { file: params.file } : {}), ...(Object.hasOwn(params, 'crop') ? { crop: params.crop } : {}) }); break;
          case 'publish_qzone':
            if (Object.keys(params).length !== 3 || Object.keys(params).some(key => !['kind', 'peer_id', 'text'].includes(key))) throw Object.assign(new Error(), { code: 'QZONE_NOT_ALLOWED' });
            data = await backend.publishQzone(params.kind, params.peer_id, params.text); break;
          case 'execute_group_action': data = await backend.executeGroupAction(params); break;
          case 'send_group_at_all':
            if (Object.keys(params).some(key => !['group_id', 'text'].includes(key)) || typeof params.text !== 'string' || !params.text.trim() || Array.from(params.text).length > 280) throw Object.assign(new Error(), { code: 'GROUP_ADMIN_REQUEST_INVALID' });
            data = await backend.sendText('group', params.group_id, [{ type: 'at', data: { qq: 'all' } }, { type: 'text', data: { text: ' ' + params.text } }]); break;
          case 'get_idle_group_candidates': data = { groups: backend.idleCandidates() }; break;
          case 'claim_idle_group': data = backend.claimIdleGroup(params.group_id); break;
          case 'send_idle_group_msg': data = await backend.sendIdleText(params.group_id, params.claim, params.message); break;
          case 'get_image': data = await backend.getImage(params); break;
          case 'list_favorite_stickers': data = await backend.listFavoriteStickers(params); break;
          case 'get_favorite_sticker_source': data = await backend.getFavoriteStickerSource(params); break;
          case 'collect_favorite_sticker': data = await backend.collectFavoriteSticker(params); break;
          case 'upload_image': data = await backend.uploadImage(params); break;
          case 'get_record': data = await backend.getRecord(params); break;
          case 'upload_record': data = await backend.uploadRecord(params); break;
          case 'send_private_msg': data = await backend.sendText('private', params.user_id, params.message); break;
          case 'send_group_msg': data = await backend.sendText('group', params.group_id, params.message); break;
          default: counts.unsupportedActions++; send(socket, { status: 'failed', retcode: 1404, data: null, ...echo }); return;
        }
        send(socket, { status: 'ok', retcode: 0, data, ...echo });
      } catch (error) {
        const code = safeCodes.has(error?.code) ? error.code : 'ACTION_FAILED';
        const retcode = ['SEND_DISABLED', 'TARGET_NOT_ALLOWED'].includes(code) ? 1403 : code === 'MESSAGE_NOT_CACHED' ? 1404 : code === 'SEND_OUTCOME_UNKNOWN' ? 1501 : 1500;
        send(socket, { status: 'failed', retcode, data: null, message: code, ...echo });
      } finally { inFlight--; }
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { offMessage(); offStatus(); offActivity(); offPermissions(); wss.close(); throw new Error('ONEBOT_LISTEN_FAILED'); }
  endpointHost = '127.0.0.1:' + server.address().port;
  const heartbeat = setInterval(() => broadcast(statusEvent()), heartbeatMs);
  heartbeat.unref();
  function close() {
    if (closeTask) return closeTask;
    closing = true; clearInterval(heartbeat); offMessage(); offStatus(); offActivity(); offPermissions();
    closeTask = new Promise((resolve) => {
      for (const socket of wss.clients) socket.terminate();
      wss.close(() => { server.closeAllConnections(); server.close(() => resolve()); });
    });
    return closeTask;
  }
  return { url: 'ws://' + endpointHost, snapshot: () => ({ ...counts, activeConnections: subscriptions.size }), close };
}
