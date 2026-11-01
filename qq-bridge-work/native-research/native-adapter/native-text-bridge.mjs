import { EventEmitter } from 'node:events';
import { gatewayFailureCode } from './gateway-diagnostics.mjs';
import { nativeMethod, isNativeListenerHandle } from './manual-login.mjs';
import { createNativeImageStore } from './native-image-store.mjs';
import { createNativeVoiceStore } from './native-voice-store.mjs';
import { createNativeStickers } from './native-stickers.mjs';
import { normalizeNativeScope, nativeScopeFromLists, nativeScopeAllows } from './scope-policy.mjs';
import { createIdleGroupPolicy, normalizeIdleSettings } from './idle-policy.mjs';
import { createNativeGroupAdmin, normalizeGroupAdminPermissions } from './native-group-admin.mjs';
import { createNativeFriendRequests, normalizeFriendRequestPermissions } from './native-friend-requests.mjs';
import { createNativeQzonePublisher, normalizeQzoneSettings } from './native-qzone.mjs';
import { createNativeSelfProfile, normalizeSelfProfilePermissions } from './native-self-profile.mjs';
import { createProfileAvatarWorkflow } from './profile-avatar-workflow.mjs';
import { createSelfAvatarSnapshotReader } from './self-avatar-snapshot.mjs';
import { createNativePhone } from './native-phone.mjs';

const idString = (value) => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value :
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const uidString = (value) => typeof value === 'string' && /^u_[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const protocolId = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : value;
const field = (object, name) => object && Object.getOwnPropertyDescriptor(object, name)?.value;
const sequenceString = (value) => typeof value === 'string' && /^(0|[1-9]\d{0,19})$/.test(value) ? value :
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
const safeError = (code) => Object.assign(new Error(code), { code });
const displayName = (value) => typeof value === 'string'
  ? Array.from(value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim()).slice(0, 128).join('') : '';

/**
 * 将普通文本及显式 text/at/reply 段转换为原生元素；字符串中的 CQ 码和 @ 字样保持字面值。
 * @param {string|Array<object>} message OneBot 文本输入。
 * @param {object} options resolveMention仅按当前群已观察UIN解析UID；resolveAtAll是独立许可同步预检，
 *   实际全体提及发送还须异步核验当前身份与额度，单独调用编码不表示已经授权或发送。
 *   resolveReply仅解析本次运行当前会话内已观察的消息；引用必须是首段且至多一个，不查询历史。
 * @returns {{text:string,elements:Array<object>,segments:Array<object>}} 仅在内存流转的正文与原生元素。
 * @throws {Error} 类型、长度或编码边界不满足时拒绝；异常不含正文。
 */
export function encodeNativeText(message, { resolveMention, resolveAtAll, resolveImage, resolveRecord, resolveReply } = {}) {
  const input = typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : message;
  if (!Array.isArray(input) || !input.length || input.length > 64) throw safeError('UNSUPPORTED_MESSAGE');
  let text = '';
  const elements = [], segments = [];
  for (const item of input) {
    const type = field(item, 'type'), data = field(item, 'data');
    let content, atType = 0, atUid = '', atNtUid = '';
    if (type === 'text' && typeof field(data, 'text') === 'string') {
      content = field(data, 'text'); segments.push({ type: 'text', data: { text: content } });
    } else if (type === 'reply') {
      const id = idString(field(data, 'id'));
      if (!id || elements.length || typeof resolveReply !== 'function') throw safeError('REPLY_NOT_OBSERVED');
      const reply = resolveReply(id);
      if (!reply) throw safeError('REPLY_NOT_OBSERVED');
      elements.push(reply); segments.push({ type: 'reply', data: { id } }); continue;
    } else if (type === 'at') {
      if (field(data, 'qq') === 'all') {
        if (typeof resolveAtAll !== 'function') throw safeError('MENTION_NOT_OBSERVED');
        if (resolveAtAll() !== true || segments.some(segment => segment.type === 'at' && segment.data.qq === 'all')) throw safeError('GROUP_ADMIN_NOT_ALLOWED');
        atType = 1; atUid = 'all'; atNtUid = 'all'; content = '@全体成员';
        segments.push({ type: 'at', data: { qq: 'all' } });
        text += content;
        elements.push({ elementType: 1, elementId: '', textElement: { content, atType, atUid, atTinyId: '', atNtUid } });
        continue;
      }
      atUid = idString(field(data, 'qq'));
      if (!atUid || typeof resolveMention !== 'function') throw safeError('MENTION_NOT_OBSERVED');
      const member = resolveMention(atUid);
      atNtUid = uidString(member?.uid);
      if (!atNtUid) throw safeError('MENTION_NOT_OBSERVED');
      atType = 2; content = '@' + (displayName(member.card) || displayName(member.nickname) || atUid);
      segments.push({ type: 'at', data: { qq: atUid } });
    } else if (type === 'image' && typeof resolveImage === 'function') {
      const file = field(data, 'file');
      if (typeof file !== 'string' || !/^qqimg_[a-f0-9]{32}$/.test(file) || segments.filter((segment) => segment.type === 'image').length >= 4) throw safeError('UNSUPPORTED_MESSAGE');
      elements.push(resolveImage(file)); segments.push({ type: 'image', data: { file } }); text += '[图片]'; continue;
    } else if (type === 'record' && typeof resolveRecord === 'function' && input.length === 1) {
      const file = field(data, 'file');
      if (typeof file !== 'string' || !/^qqvoice_[a-f0-9]{32}$/.test(file)) throw safeError('UNSUPPORTED_MESSAGE');
      elements.push(resolveRecord(file)); segments.push({ type: 'record', data: { file } }); text += '[语音]'; continue;
    } else throw safeError('UNSUPPORTED_MESSAGE');
    text += content;
    elements.push({ elementType: 1, elementId: '', textElement: { content, atType, atUid, atTinyId: '', atNtUid } });
  }
  if (!text.trim() || text.length > 4000 || Buffer.byteLength(text, 'utf8') > 16000 || text.includes('\0')) throw safeError('TEXT_LIMIT');
  return { text, elements, segments };
}

/**
 * 将已初始化原生会话接入文字 OneBot 语义；构造不注册监听、不读取好友或历史。
 * @param {object} options session/self 为宿主提供；scope为明确选择的范围，否则沿用friendUins/groupUins白名单，空表拒绝。
 *   allowReceive/allowSend 是独立技术开关，不替代人类授权；maxSends 可限制本批真实调用次数。
 *   allowReadSelfAvatar仅允许当前已观察授权会话核验自身头像主体，缺省关闭，不开放资料修改。
 *   allowGenerateImages缺省关闭，仅允许当前已观察授权会话核验生成资格，必须同时允许文字和图片发送。
 *   groupAdmin/friendRequests/qzoneSettings/selfProfile分别为独立群管理、新申请、说说及自身资料许可，缺省关闭。
 *   profileAvatarRoot为监督器本次专属暂存根；头像需已有收图或发图许可。构造不注册监听、读文件或联网。
 *   qzoneTransport仅供合成测试替换，不属于操作员配置或OneBot参数。
 *   idleSettings为独立冷场闸门，缺省关闭；idleNow仅用于隔离时钟，生产沿用Date.now。
 * @returns {object} start/stop/sendText/getMessage/getStatus/getLoginInfo/snapshot/on/off 接口。
 * @note 单JS线程；只读白名单在线消息正文。发送须同时收到原生受理成功和匹配的状态2回执；
 *       超时、掉线或不确定返回均不自动重试。诊断快照不含身份/正文，私有缓存只留内存。
 */
export function createNativeTextBridge({ session, self, friendUins = [], groupUins = [], scope = null, allowReceive = false,
  allowSend = false, allowReadSelfAvatar = false, allowGenerateImages = false, allowUseStickers = false, allowCollectStickers = false,
  stickerRoot = null, groupAdmin = null, friendRequests = null,
  qzoneSettings = null, qzoneTransport, selfProfile = null, profileAvatarRoot = null, profileAvatarBackupRoot = null, profileAvatarCurrentReader = null,
  idleSettings = null, idleNow = Date.now,
  sessionInitialized = false, maxSends = 2, sendTimeoutMs = 10000, imageOptions = null, voiceOptions = null,
  configurationRevision = 1,phoneFactory = createNativePhone }) {
  const selfUin = idString(self?.uin), selfUid = uidString(self?.uid);
  if (!selfUin || !selfUid || sessionInitialized !== true) throw safeError('SESSION_NOT_READY');
  if (typeof allowReadSelfAvatar !== 'boolean') throw safeError('PERMISSION_INVALID');
  if (typeof allowGenerateImages !== 'boolean' || allowGenerateImages && (!allowSend || imageOptions?.sendEnabled !== true)) throw safeError('PERMISSION_INVALID');
  if (typeof allowUseStickers !== 'boolean' || typeof allowCollectStickers !== 'boolean' || allowCollectStickers && imageOptions?.receiveEnabled !== true) throw safeError('PERMISSION_INVALID');
  for (const values of [friendUins, groupUins]) {
    if (!Array.isArray(values) || values.length > 64 || values.some((value) => !idString(value))) throw safeError('SCOPE_INVALID');
  }
  if (!Number.isSafeInteger(maxSends) || maxSends < 0 || maxSends > 100000 || !Number.isSafeInteger(sendTimeoutMs) || sendTimeoutMs < 10 || sendTimeoutMs > 30000) throw safeError('LIMIT_INVALID');
  if (scope !== null && (friendUins.length || groupUins.length)) throw safeError('SCOPE_INVALID');
  let scopeRules = scope === null ? nativeScopeFromLists(friendUins.map(idString), groupUins.map(idString)) : normalizeNativeScope(scope, { allowEmpty: true });
  let reconfiguring = false, configurationFailed = false, mediaGeneration = 0;
  const authorized = () => !reconfiguring && !configurationFailed;
  const targetAllowed = (kind, target) => authorized() && nativeScopeAllows(scopeRules, kind, target);
  const events = new EventEmitter(); events.on('error', () => {});
  const peers = new Map(), blockedPeers = new Set(), pending = new Map(), cached = new Map(), nativeKeys = new Map();
  let phoneVoiceReceive=voiceOptions?.receiveEnabled===true,phoneVoiceSend=voiceOptions?.sendEnabled===true;
  let phoneCleanup=null,phoneCleanupFailed=false;
  const groupMembers = new Map(), conflictedGroups = new Set(), observedGroups = new Set();
  const friendRequestReviews = new Map();
  let idleConfig = normalizeIdleSettings(idleSettings);
  let groupPermissions = normalizeGroupAdminPermissions(groupAdmin ?? undefined);
  let friendPermissions = normalizeFriendRequestPermissions(friendRequests ?? undefined);
  let qzoneConfig = normalizeQzoneSettings(qzoneSettings ?? undefined);
  let profilePermissions = normalizeSelfProfilePermissions(selfProfile ?? undefined);
  if (groupPermissions.atAll && !allowSend || Object.values(groupPermissions).some(Boolean) && scopeRules.groups.mode === 'disabled') throw safeError('PERMISSION_INVALID');
  let service = null, state = 'idle', startAttempted = false, listenerHandle = null, listenerRemovalVerified = false, cleanupRequired = false;
  let socialCleanup = null, socialCleanupFailed = false;
  let qzoneSource = null, qzoneTask = null;
  let profileSource = null, profileTask = null, profileStager = null, profileCleanup = null, profileCleanupFailed = false;
  const profileContext = field => {
    if (!profileSource || state !== 'active' || !allowReceive || profilePermissions[field] !== true
        || !targetAllowed(profileSource.kind, profileSource.peer)) return null;
    const observed = profileSource.kind === 'private' ? peers.has(profileSource.peer) && !blockedPeers.has(profileSource.peer)
      : profileSource.kind === 'group' && observedGroups.has(profileSource.peer) && !conflictedGroups.has(profileSource.peer);
    return observed ? 'native-self-profile:' + configurationRevision + ':' + profileSource.kind + ':' + profileSource.peer + ':' + field : null;
  };
  const profile = createNativeSelfProfile({ session, self: { uin: selfUin, uid: selfUid }, permissions: profilePermissions,
    authorize: profileContext, avatarTimeoutMs: 25000, avatarStager: { prepare: (...args) => {
      if (!profileStager) throw safeError('SELF_PROFILE_AVATAR_UNAVAILABLE'); return profileStager.prepare(...args);
    } }, contentAllowed: text => {
      if (/u_[A-Za-z0-9_-]{1,128}/.test(text)) return false;
      for (const peer of peers.keys()) if (text.includes(peer)) return false;
      for (const [group, members] of groupMembers) {
        if (text.includes(group)) return false;
        for (const member of members.keys()) if (text.includes(member)) return false;
      }
      return true;
    } });
  const qzoneContext = () => {
    if (!qzoneSource || state !== 'active' || !allowReceive || !qzoneConfig.enabled
        || !targetAllowed(qzoneSource.kind, qzoneSource.peer)) return null;
    const observed = qzoneSource.kind === 'private' ? peers.has(qzoneSource.peer) && !blockedPeers.has(qzoneSource.peer)
      : qzoneSource.kind === 'group' && observedGroups.has(qzoneSource.peer) && !conflictedGroups.has(qzoneSource.peer);
    return observed ? 'current-native-qzone:' + configurationRevision + ':' + qzoneSource.kind + ':' + qzoneSource.peer : null;
  };
  const qzone = createNativeQzonePublisher({ session, self: { uin: selfUin, uid: selfUid }, settings: qzoneConfig,
    authorize: qzoneContext, transport: qzoneTransport, contentAllowed: text => {
      if (/u_[A-Za-z0-9_-]{1,128}/.test(text)) return false;
      for (const id of peers.keys()) if (text.includes(id)) return false;
      for (const [group, members] of groupMembers) {
        if (text.includes(group)) return false;
        for (const member of members.keys()) if (text.includes(member)) return false;
      }
      return true;
    } });
  let atAllAttempts = 0, atAllNext = 0;
  const atAllGroups = new Map();
  const adminContext = (action, group, user = null) => state === 'active' && allowReceive && groupPermissions[action] === true
    && (action !== 'atAll' || allowSend) && targetAllowed('group', group) && observedGroups.has(group)
    && !conflictedGroups.has(group) && (user === null || groupMembers.get(group)?.has(user)) ? 'current-native-group-session:' + configurationRevision : null;
  const admin = createNativeGroupAdmin({ session, self: { uin: selfUin, uid: selfUid }, permissions: groupPermissions,
    authorize: adminContext, resolveMember: (group, user) => {
      const member = !conflictedGroups.has(group) && groupMembers.get(group)?.get(user);
      return member ? { uin: user, uid: member.uid } : null;
    } });
  const requests = createNativeFriendRequests({ session, permissions: friendPermissions,
    authorize: action => state === 'active' && authorized() && allowReceive && friendPermissions.receiveRequests
      && (action !== 'accept' || friendPermissions.autoAccept) ? 'current-native-friend-session:' + configurationRevision : null });
  const idlePolicy = createIdleGroupPolicy({ settings: idleConfig, now: idleNow,
    allowed: group => state === 'active' && allowSend && allowReceive && targetAllowed('group', group)
      && (scopeRules.groups.mode === 'selected' || observedGroups.has(group)) });
  let listenerHandleKind = 'unobserved', nextMessageId = 1, startStage = 'not_started', startFailureCode = null;
  let imageStore = null, voiceStore = null, mediaCleanup = null, mediaCleanupFailed = false;
  let stickers = null, stickerCleanup = null, stickerCleanupFailed = false;
  const stickerContext = (key, operation) => {
    const match = /^(private|group):([1-9]\d{0,19})$/.exec(key ?? '');
    if (!match || state !== 'active' || !allowReceive || !(operation === 'collect' ? allowCollectStickers && imageStore : allowUseStickers || allowCollectStickers)) return null;
    const [kind, target] = match.slice(1);
    const observed = kind === 'private' ? peers.has(target) && !blockedPeers.has(target)
      : !conflictedGroups.has(target) && groupMembers.get(target)?.size > 0;
    return observed && targetAllowed(kind, target) ? 'native-sticker:' + configurationRevision + ':' + key + ':' + operation : null;
  };
  const nativeStickers = () => {
    if (!stickers) stickers = createNativeStickers({ service, root: stickerRoot, authorize: stickerContext,
      copyImage: (file, key) => { const [kind, target] = key.split(':');
        if (!imageStore || !stickerContext(key, 'collect')) throw safeError('STICKER_DISABLED');
        return imageStore.copyForAvatar(file, kind === 'private' ? '1:' + peers.get(target) : '2:' + target);
      } });
    return stickers;
  };
  const stickerInput = (params, fields) => {
    if (!params || Object.keys(params).some(key => !['kind', 'peer_id', ...fields].includes(key))) throw safeError('STICKER_INPUT_INVALID');
    const kind = field(params, 'kind'), target = idString(field(params, 'peer_id'));
    if (!['private', 'group'].includes(kind) || !target) throw safeError('STICKER_INPUT_INVALID');
    return kind + ':' + target;
  };
  const retiredMedia = new Set();
  const retireMedia = store => {
    if (!store) return;
    const task = store.close(); retiredMedia.add(task);
    task.then(() => retiredMedia.delete(task), () => { mediaCleanupFailed = true; });
  };
  function makeImageStore(options) {
    const generation = mediaGeneration;
    return createNativeImageStore({ ...options, service,
      isActive: () => state === 'active' && authorized() && mediaGeneration === generation,
      authorizeTarget: (kind, target) => { const prepared = prepareSend(kind, target, 'image-upload-validation'); return prepared.chatType + ':' + prepared.peerUid; } });
  }
  function makeVoiceStore(options) {
    const generation = mediaGeneration;
    return createNativeVoiceStore({ ...options, service,
      isActive: () => state === 'active' && authorized() && mediaGeneration === generation,
      authorizeTarget: (kind, target) => { const prepared = prepareSend(kind, target, 'voice-upload-validation'); return prepared.chatType + ':' + prepared.peerUid; } });
  }
  function ensureAvatarStage() {
    if (!profilePermissions.avatar || profileStager) return;
    // 缺少持久备份根时不降级为无备份改头像；测试夹具和旧启动器仍能正常启动其它能力。
    if (!profileAvatarBackupRoot) return;
    const imageKey = () => profileSource.kind === 'private' ? '1:' + peers.get(profileSource.peer) : '2:' + profileSource.peer;
    profileStager = createProfileAvatarWorkflow({ root: profileAvatarBackupRoot, stageRoot: profileAvatarRoot,
      subject: selfUin + ':' + selfUid,
      isCurrent: revision => profileContext('avatar') === revision,
      readImage: (handle, revision) => {
        if (profileContext('avatar') !== revision || !imageStore || !profileSource) throw safeError('SELF_PROFILE_NOT_ALLOWED');
        return imageStore.copyForAvatar(handle, imageKey());
      },
      registerImage: (bytes, revision) => {
        if (profileContext('avatar') !== revision || !imageStore || !profileSource) throw safeError('SELF_PROFILE_NOT_ALLOWED');
        return imageStore.registerProfileImage(bytes, imageKey());
      },
      readCurrent: profileAvatarCurrentReader ?? createSelfAvatarSnapshotReader({ selfUin,
        isCurrent: revision => profileContext('avatar') === revision }) });
  }
  let idleSendsConfirmed = 0, idleSendsUnknown = 0;
  const counters = { privateReceived: 0, groupReceived: 0, malformed: 0, ignored: 0, sendsAttempted: 0,
    sendsConfirmed: 0, sendsRejected: 0, sendsUnknown: 0, duplicates: 0, eventConsumerErrors: 0 };
  const phone=phoneFactory({session,identity:{uid:selfUid,uin:selfUin},
    context:()=>({allowed:state==='active'&&authorized()&&allowReceive&&allowSend&&phoneVoiceReceive&&phoneVoiceSend&&scopeRules.private.mode!=='disabled',
      revision:configurationRevision}),
    allowsPeer:key=>{const match=/^private:([1-9]\d{0,19})$/.exec(key??'');return !!match&&match[1]!==selfUin
      &&targetAllowed('private',match[1])&&peers.has(match[1])&&!blockedPeers.has(match[1]);},
    resolveCaller:uid=>{const candidates=[...peers].filter(([uin,found])=>found===uid&&targetAllowed('private',uin)&&!blockedPeers.has(uin));
      return candidates.length===1?'private:'+candidates[0][0]:null;},
  });
  const notify = (name, value) => { try { events.emit(name, value); } catch { counters.eventConsumerErrors++; } };
  const snapshot = () => ({ state, configurationRevision, configurationFailed, ...counters, pendingSends: pending.size, cachedMessages: cached.size,
    listenerHandleKind, listenerRemovalVerified, cleanupRequired, startStage, startFailureCode, nativeCompatibilityVerified: false,
    idleMessages: { ...idlePolicy.snapshot(), sendsConfirmed: idleSendsConfirmed, sendsUnknown: idleSendsUnknown },
    groupAdmin: { ...admin.snapshot(), atAllAttempts }, friendRequests: requests.snapshot(), socialCleanupFailed,
    qzone: qzone.snapshot(), selfProfile: profile.snapshot(), profileAvatarStage: profileStager?.snapshot() ?? null, profileCleanupFailed,
    stickers: stickers?.snapshot() ?? null, stickerCleanupFailed,
    phone:phone.snapshot(),phoneCleanupFailed,
    ...(imageStore ? { images: imageStore.snapshot(), mediaCleanupFailed } : {}),
    ...(voiceStore ? { voices: voiceStore.snapshot() } : {}) });
  const getStatus = () => ({ online: state === 'active', good: state === 'active' });
  let ownNickname = '', ownNicknameAt = 0, nicknameTask = null;
  const getLoginInfo = () => ({ user_id: protocolId(selfUin), nickname: ownNickname,
    nicknameAvailable: ownNickname.length > 0 });
  /**
   * 定向读取本次登录账号的真实昵称；不读取联系人，不把默认标签或角色名当资料。
   * @returns {Promise<object>} 登录UIN、昵称及是否可读；失败返回空昵称，原生诊断不外传。
   * @note 单线程合并并发读取，缓存一分钟；超时一秒，停止或许可代次变化后丢弃结果。
   */
  async function readLoginInfo() {
    if (state !== 'active') throw safeError('SELF_PROFILE_NOT_ALLOWED');
    if (ownNickname && Date.now() - ownNicknameAt < 60000) return getLoginInfo();
    if (nicknameTask) return nicknameTask;
    const revision = configurationRevision;
    nicknameTask = (async () => {
      let timer;
      try {
        const service = nativeMethod(session, 'getProfileService')();
        const result = await Promise.race([
          Promise.resolve().then(() => nativeMethod(service, 'fetchUserDetailInfo')('QQBridgeSelfIdentity', [selfUid], 1, [0])),
          new Promise((_, reject) => { timer = setTimeout(() => reject(safeError('SELF_PROFILE_TIMEOUT')), 1000); }),
        ]);
        if (state !== 'active' || configurationRevision !== revision) throw safeError('SELF_PROFILE_NOT_ALLOWED');
        const detail = field(result, 'detail'), raw = detail instanceof Map ? detail.get(selfUid) : null;
        const core = field(field(raw, 'simpleInfo'), 'coreInfo');
        if (field(result, 'result') !== 0 || field(result, 'source') !== 1 || field(raw, 'uid') !== selfUid
            || idString(field(raw, 'uin')) !== selfUin || field(core, 'uid') !== selfUid || idString(field(core, 'uin')) !== selfUin) {
          throw safeError('SELF_PROFILE_SUBJECT_UNVERIFIED');
        }
        const name = displayName(field(core, 'nick'));
        if (!name) throw safeError('SELF_PROFILE_SUBJECT_UNVERIFIED');
        ownNickname = name; ownNicknameAt = Date.now();
      } catch { ownNickname = ''; ownNicknameAt = 0; }
      finally { clearTimeout(timer); }
      return getLoginInfo();
    })().finally(() => { nicknameTask = null; });
    return nicknameTask;
  }
  const noteGroupActivity = (group, nativeId) => {
    idlePolicy.observe(group, nativeId);
    if (idleConfig.enabled) notify('activity', { post_type: 'notice', notice_type: 'native_group_activity',
      self_id: protocolId(selfUin), group_id: protocolId(group), time: Math.floor(idleNow() / 1000) });
  };

  function remember(nativeKey, event, reply = null) {
    if (nativeKeys.has(nativeKey)) return { id: nativeKeys.get(nativeKey), fresh: false };
    if (nextMessageId > 2147483647) throw safeError('MESSAGE_ID_EXHAUSTED');
    const id = nextMessageId++;
    const saved = structuredClone({ ...event, message_id: id });
    cached.set(id, { key: nativeKey, event: saved, reply }); nativeKeys.set(nativeKey, id);
    if (cached.size > 128) {
      const oldest = cached.keys().next().value;
      nativeKeys.delete(cached.get(oldest).key); cached.delete(oldest);
    }
    return { id, fresh: true };
  }

  function receive(batch) {
    if (state !== 'active' || !allowReceive) return;
    if (!Array.isArray(batch) || batch.length > 128) { counters.malformed++; return; }
    for (const raw of batch) {
      if (state !== 'active') break;
      try {
        const chatType = field(raw, 'chatType');
        const peerUin = idString(field(raw, 'peerUin')), senderUin = idString(field(raw, 'senderUin'));
        if (field(raw, 'isOnlineMsg') === true && chatType === 2 && senderUin === selfUin && targetAllowed('group', peerUin)
            && field(raw, 'peerUid') === peerUin && idString(field(raw, 'msgId'))) noteGroupActivity(peerUin, field(raw, 'msgId'));
        if (field(raw, 'isOnlineMsg') !== true || !senderUin || senderUin === selfUin ||
          !((chatType === 1 && targetAllowed('private', peerUin) && senderUin === peerUin) || (chatType === 2 && targetAllowed('group', peerUin)))) { counters.ignored++; continue; }
        // 全范围仍保持会话映射有界，容量用尽时拒绝新会话，不驱逐后重映射已有身份。
        if (!(chatType === 1 ? peers.has(peerUin) : observedGroups.has(peerUin)) &&
            (peers.size + observedGroups.size >= 128 || blockedPeers.size >= 128)) { counters.ignored++; continue; }
        const peerUid = field(raw, 'peerUid');
        if (chatType === 1 && (!uidString(peerUid) || field(raw, 'senderUid') !== peerUid)) { counters.malformed++; continue; }
        if (chatType === 1) {
          const conflicting = [...peers].find(([uin, uid]) => uin !== peerUin && uid === peerUid);
          if (blockedPeers.has(peerUin) || (peers.has(peerUin) && peers.get(peerUin) !== peerUid) || conflicting) {
            blockedPeers.add(peerUin);
            if (conflicting) blockedPeers.add(conflicting[0]);
            counters.malformed++; continue;
          }
        }
        if (chatType === 2 && peerUid !== peerUin) { counters.malformed++; continue; }
        const nativeId = idString(field(raw, 'msgId'));
        const seconds = Number(field(raw, 'msgTime'));
        const elements = field(raw, 'elements');
        if (!nativeId || !Number.isSafeInteger(seconds) || seconds < 1 || !Array.isArray(elements) || elements.length > 64) { counters.malformed++; continue; }
        if (chatType === 2) noteGroupActivity(peerUin, nativeId);
        const segments = [];
        let plain = '';
        let imageCount = 0;
        for (const element of elements) {
          if (field(element, 'elementType') === 4 && voiceStore && voiceOptions.receiveEnabled === true) {
            try {
              if (segments.some((s) => s.type === 'record')) throw safeError('VOICE_LIMIT');
              const segment = voiceStore.observe({ chatType, peerUid, msgId: nativeId,
                elementId: field(element, 'elementId'), voice: field(element, 'pttElement') });
              if (segment) { segments.push(segment); plain += '[语音]'; }
            } catch { counters.malformed++; segments.push({ type: 'text', data: { text: '[语音暂不可读：格式或时长超限]' } }); plain += '[语音暂不可读]'; }
            continue;
          }
          if (field(element, 'elementType') === 2 && imageStore && imageOptions.receiveEnabled === true) {
            if (++imageCount > 4) { counters.malformed++; continue; }
            try {
              const segment = imageStore.observe({ chatType, peerUid, msgId: nativeId,
                elementId: field(element, 'elementId'), picture: field(element, 'picElement') });
              if (segment) { segments.push(segment); plain += '[图片]'; }
            } catch {
              counters.malformed++;
              const unavailable = '[图片暂不可读：大小或格式信息不符合限制]';
              segments.push({ type: 'text', data: { text: unavailable } }); plain += unavailable;
            }
            continue;
          }
          if (field(element, 'elementType') !== 1) continue;
          const textElement = field(element, 'textElement');
          const content = field(textElement, 'content');
          if (typeof content !== 'string' || content.length > 4000) throw safeError('TEXT_LIMIT');
          if (chatType === 2 && (field(textElement, 'atUid') === selfUid || field(textElement, 'atNtUid') === selfUid)) segments.push({ type: 'at', data: { qq: selfUin } });
          if (content) { segments.push({ type: 'text', data: { text: content } }); plain += content; }
        }
        if (!segments.length) { counters.ignored++; continue; }
        if (plain.length > 4000 || Buffer.byteLength(plain, 'utf8') > 16000) throw safeError('TEXT_LIMIT');
        const nickname = displayName(field(raw, 'sendNickName'));
        const card = chatType === 2 ? displayName(field(raw, 'sendMemberName')) : '';
        const event = { time: seconds, self_id: protocolId(selfUin), post_type: 'message', message_type: chatType === 1 ? 'private' : 'group',
          sub_type: chatType === 1 ? 'friend' : 'normal', user_id: protocolId(senderUin),
          message: segments, raw_message: plain, font: 0, sender: { user_id: protocolId(senderUin), nickname, ...(chatType === 2 ? { card } : {}) } };
        if (chatType === 2) event.group_id = protocolId(peerUin);
        // 原生引用字段只来自已授权在线回调，缺失不妨碍收消息，但不能据此猜造引用。
        const msgSeq = sequenceString(field(raw, 'msgSeq')), clientSeq = sequenceString(field(raw, 'clientSeq'));
        const reply = msgSeq !== null && clientSeq !== null ? { chatType, peerUid, nativeId, msgSeq, clientSeq, senderUin } : null;
        const saved = remember(chatType + ':' + peerUid + ':' + nativeId, event, reply);
        if (!saved.fresh) { counters.duplicates++; continue; }
        if (chatType === 1) { peers.set(peerUin, peerUid); counters.privateReceived++; }
        else {
          observedGroups.add(peerUin);
          counters.groupReceived++;
          const uid = uidString(field(raw, 'senderUid'));
          if (uid && !conflictedGroups.has(peerUin)) {
            const members = groupMembers.get(peerUin) ?? new Map();
            if ((members.has(senderUin) && members.get(senderUin).uid !== uid) ||
                [...members].some(([uin, member]) => uin !== senderUin && member.uid === uid)) {
              conflictedGroups.add(peerUin); groupMembers.delete(peerUin);
            } else {
              members.delete(senderUin); members.set(senderUin, { uid, nickname, card });
              if (members.size > 128) members.delete(members.keys().next().value);
              groupMembers.set(peerUin, members);
            }
          }
        }
        notify('message', structuredClone(cached.get(saved.id).event));
      } catch { counters.malformed++; }
    }
  }

  function acknowledge(batch) {
    if (state !== 'active' || !Array.isArray(batch) || batch.length > 128) return;
    for (const raw of batch) {
      try {
        const entry = pending.get(field(raw, 'guildId'));
        if (!entry || field(raw, 'chatType') !== entry.chatType || field(raw, 'peerUid') !== entry.peerUid ||
          field(raw, 'senderUid') !== selfUid || idString(field(raw, 'senderUin')) !== selfUin) continue;
        const status = field(raw, 'sendStatus');
        if (status === 0) entry.finish('SEND_REJECTED');
        else if (status === 2) {
          const nativeId = idString(field(raw, 'msgId'));
          if (!nativeId) continue;
          entry.nativeId = nativeId; entry.confirmed = true; entry.check();
        }
      } catch { counters.malformed++; }
    }
  }

  const listener = new Proxy({ onRecvMsg: receive, onMsgInfoListUpdate: acknowledge, onKickedOffLine: () => stop('offline'),
    onRichMediaDownloadComplete: (value) => { imageStore?.complete(value); voiceStore?.complete(value); } }, {
    get(target, key) { return Object.hasOwn(target, key) ? target[key] : typeof key === 'string' && /^on[A-Za-z]/.test(key) ? () => {} : undefined; },
  });
  function start() {
    if (startAttempted || state !== 'idle' || (!allowReceive && !allowSend)) throw safeError('LISTENER_START_REFUSED');
    startAttempted = true;
    try {
      startStage = 'message_service';
      service = nativeMethod(session, 'getMsgService')();
      startStage = 'listener_remove_lookup';
      nativeMethod(service, 'removeKernelMsgListener');
      startStage = 'image_store';
      if (imageOptions?.receiveEnabled === true || imageOptions?.sendEnabled === true) imageStore = makeImageStore(imageOptions);
      startStage = 'voice_store';
      if (voiceOptions?.receiveEnabled === true || voiceOptions?.sendEnabled === true) voiceStore = makeVoiceStore(voiceOptions);
      startStage = 'avatar_stage';
      ensureAvatarStage();
      state = 'registering';
      startStage = 'listener_registration';
      const handle = nativeMethod(service, 'addKernelMsgListener')(listener);
      listenerHandleKind = handle === null ? 'null' : typeof handle;
      if (isNativeListenerHandle(handle)) listenerHandle = String(handle);
      cleanupRequired = true;
      if (handle instanceof Promise) { handle.catch(() => {}); throw safeError('ASYNC_REGISTRATION_UNSUPPORTED'); }
      if (state === 'offline' || state === 'stopped') { stop(state); return snapshot(); }
      state = 'active';
      startStage = 'group_admin'; admin.start();
      startStage = 'friend_requests'; requests.start();
      startStage = 'self_profile'; profile.start();
      startStage = 'idle_observe';
      if (scopeRules.groups.mode === 'selected') for (const group of scopeRules.groups.ids) if (targetAllowed('group', group)) idlePolicy.observe(group);
      startStage = 'active'; return snapshot();
    } catch (error) { startFailureCode = gatewayFailureCode(error); state = 'failed'; cleanupRequired = true; throw safeError('LISTENER_START_FAILED'); }
  }
  /**
   * 在同一账号会话中热改权限；保留所有发送/管理/资料/说说/冷场预算与熔断。
   * @param {object} next 来自网关规范化后的完整配置。
   * @param {object|null} media 本实例宿主提供的受控缓存根，不接收模型路径。
   * @param {number} revision 单调递增版本；失败后全局拒绝新提交，需重新应用或连接。
   * @returns {void} 同步更新，不登录、不发消息；旧媒体及操作资格立即失效。
   */
  function reconfigure(next, media, revision = configurationRevision + 1) {
    if (state !== 'active' || !Number.isSafeInteger(revision) || revision <= configurationRevision
        || next.targets.private.ids.includes(selfUin)) throw safeError('PERMISSION_INVALID');
    reconfiguring = true; configurationRevision = revision; mediaGeneration++;
    phoneCleanup=phone.close();phoneCleanup.catch(()=>{phoneCleanupFailed=true;});
    notify('permissions', { configurationRevision });
    try {
      retireMedia(imageStore); retireMedia(voiceStore); imageStore = null; voiceStore = null;
      // 旧缓存不因重新授权复活；必须收到当前版本的新在线消息后才能使用。
      peers.clear(); blockedPeers.clear(); cached.clear(); nativeKeys.clear(); groupMembers.clear(); conflictedGroups.clear(); observedGroups.clear(); friendRequestReviews.clear();
      scopeRules = next.targets; allowSend = next.allowSend; allowReadSelfAvatar = next.readSelfAvatar; allowGenerateImages = next.generateImages;
      phoneVoiceReceive=next.receiveVoice===true;phoneVoiceSend=next.sendVoice===true;
      allowUseStickers = next.useStickers; allowCollectStickers = next.collectStickers;
      idleConfig = next.idleMessages; groupPermissions = next.groupAdmin; friendPermissions = next.friendRequests;
      qzoneConfig = next.qzone; profilePermissions = next.selfProfile;
      admin.configure(groupPermissions); requests.configure(friendPermissions); profile.configure(profilePermissions);
      qzone.configure(qzoneConfig); idlePolicy.configure(idleConfig);
      profileAvatarRoot ??= media?.profileAvatarRoot;
      profileAvatarBackupRoot ??= media?.profileAvatarBackupRoot;
      const common = { root: media?.root, nativeRoots: media?.nativeRoots };
      if (next.receiveImages || next.sendImages) imageStore = makeImageStore({ ...common, receiveEnabled: next.receiveImages, sendEnabled: next.sendImages });
      if (next.receiveVoice || next.sendVoice) voiceStore = makeVoiceStore({ ...common, receiveEnabled: next.receiveVoice, sendEnabled: next.sendVoice });
      ensureAvatarStage(); configurationFailed = false;
    } catch { configurationFailed = true; throw safeError('PERMISSION_INVALID'); }
    finally { reconfiguring = false; }
    if (scopeRules.groups.mode === 'selected') for (const group of scopeRules.groups.ids) if (targetAllowed('group', group)) idlePolicy.observe(group);
  }
  function stop(reason = 'stopped') {
    state = reason === 'offline' ? 'offline' : 'stopped';
    phoneCleanup=phone.close();phoneCleanup.catch(()=>{phoneCleanupFailed=true;});
    friendRequestReviews.clear();
    qzone.close();
    if (!profileCleanup) {
      profileCleanup = profile.stop().then(async () => {
        await profileStager?.close();
        const info = profile.snapshot();
        if (info.cleanupRequired && !info.removalVerified || info.releaseFailures > 0 || profileStager?.snapshot().cleanupFailed) {
          throw safeError('SELF_PROFILE_CLEANUP_FAILED');
        }
      }); profileCleanup.catch(() => { profileCleanupFailed = true; });
    }
    if (!socialCleanup) {
      socialCleanup = Promise.all([admin.stop(), requests.stop()]).then(() => {
        socialCleanupFailed = admin.snapshot().cleanupRequired || requests.snapshot().cleanupRequired;
        if (socialCleanupFailed) throw safeError('SOCIAL_CLEANUP_FAILED');
      }); socialCleanup.catch(() => { socialCleanupFailed = true; });
    }
    for (const entry of [...pending.values()]) entry.finish('SEND_OUTCOME_UNKNOWN');
    peers.clear(); blockedPeers.clear(); cached.clear(); nativeKeys.clear(); scopeRules = null;
    if (stickers && !stickerCleanup) { stickerCleanup = stickers.close(); stickerCleanup.catch(() => { stickerCleanupFailed = true; }); }
    groupMembers.clear(); conflictedGroups.clear(); observedGroups.clear();
    idlePolicy.close();
    if ((imageStore || voiceStore) && !mediaCleanup) {
      mediaCleanup = Promise.all([imageStore?.close(), voiceStore?.close()]); mediaCleanup.catch(() => { mediaCleanupFailed = true; });
    }
    if (listenerHandle !== null) {
      try {
        const returned = nativeMethod(service, 'removeKernelMsgListener')(listenerHandle);
        if (returned === undefined) { listenerRemovalVerified = true; cleanupRequired = false; listenerHandle = null; }
        else if (returned instanceof Promise) returned.catch(() => {});
      } catch { cleanupRequired = true; }
    }
    notify('status', getStatus()); return snapshot();
  }

  function prepareSend(kind, target, message, preparedImages = null) {
    const targetUin = idString(target), chatType = kind === 'private' ? 1 : kind === 'group' ? 2 : 0;
    if (!allowSend || state !== 'active' || !authorized()) throw safeError('SEND_DISABLED');
    if (!targetUin || (chatType === 1 && targetUin === selfUin) || !targetAllowed(kind, targetUin) ||
        (chatType === 2 && scopeRules.groups.mode === 'all' && !observedGroups.has(targetUin))) throw safeError('TARGET_NOT_ALLOWED');
    if (chatType === 1 && blockedPeers.has(targetUin)) throw safeError('TARGET_NOT_ALLOWED');
    if (counters.sendsAttempted >= maxSends || pending.size >= 4) throw safeError('SEND_LIMIT');
    const peerUid = chatType === 1 ? peers.get(targetUin) : targetUin;
    if (!peerUid) throw safeError('FRIEND_NOT_OBSERVED');
    const payload = encodeNativeText(message, { resolveImage: imageStore ? (file) => {
      const placeholder = imageStore.validateSend(file, chatType + ':' + peerUid);
      return preparedImages?.get(file) ?? placeholder;
    } : undefined, resolveRecord: voiceStore ? (file) => {
      const placeholder = voiceStore.validateSend(file, chatType + ':' + peerUid);
      return preparedImages?.get(file) ?? placeholder;
    } : undefined, resolveReply: (id) => {
      const reply = cached.get(Number(id))?.reply;
      if (!Number.isSafeInteger(Number(id)) || !reply || reply.chatType !== chatType || reply.peerUid !== peerUid)
        throw safeError('REPLY_NOT_OBSERVED');
      if (chatType === 2 && conflictedGroups.has(targetUin)) throw safeError('MENTION_MAPPING_CONFLICT');
      // NapCat v4.18.41固定结构；不接受调用方提供原生ID、UID或序号。
      return { elementType: 7, elementId: '', replyElement: { replayMsgSeq: reply.msgSeq, replayMsgId: reply.nativeId,
        senderUin: reply.senderUin, senderUinStr: reply.senderUin, replyMsgClientSeq: reply.clientSeq,
        _replyMsgPeer: { chatType, peerUid, guildId: '' } } };
    }, resolveAtAll: () => {
      if (!groupPermissions.atAll) throw safeError('MENTION_NOT_OBSERVED');
      if (chatType !== 2 || !adminContext('atAll', targetUin)) throw safeError('GROUP_ADMIN_NOT_ALLOWED');
      return true;
    }, resolveMention: (uin) => {
      if (chatType !== 2) throw safeError('MENTION_PRIVATE');
      if (conflictedGroups.has(targetUin)) throw safeError('MENTION_MAPPING_CONFLICT');
      return groupMembers.get(targetUin)?.get(uin);
    } });
    return { targetUin, chatType, peerUid, payload };
  }
  function validateMessage(kind, target, message) { prepareSend(kind, target, message); }
  /**
   * 核验当前授权会话中的已观察成员；不读取全群资料或历史，不返回原生UID。
   * @param {string} kind private或group。
   * @param {string|number} target 授权会话标识。
   * @param {string|number} user 成员号码；群成员必须本次运行中实际发言且映射无冲突。
   * @returns {object} 最小成员标识与已收消息中的显示名。
   * @throws {Error} 离线、越界、未知成员或冲突时以固定错误拒绝；单线程同步。
   */
  function getObservedMember(kind, target, user) {
    const peer = idString(target), uin = idString(user);
    if (state !== 'active' || !allowReceive) throw safeError('MEMBER_NOT_OBSERVED');
    if (kind === 'private' && peer && targetAllowed(kind, peer) && uin === peer && peers.has(peer) && !blockedPeers.has(peer))
      return { user_id: uin, nickname: '', card: '' };
    if (kind !== 'group' || !peer || !targetAllowed(kind, peer)) throw safeError('TARGET_NOT_ALLOWED');
    const member = !conflictedGroups.has(peer) && groupMembers.get(peer)?.get(uin);
    if (!member) throw safeError('MEMBER_NOT_OBSERVED');
    return { user_id: uin, nickname: member.nickname, card: member.card };
  }
  /**
   * 读取当前授权群中本次在线消息已核验的成员；始终标记partial，不冒充全群名册。
   * @param {string|number} target 已收到消息的当前群。
   * @param {number} limit 最多1到100名；不读取其它群或历史。
   * @returns {object} 仅公开UIN、昵称、名片与部分列表标志，不返回原生UID；同步、无原生调用。
   * @throws {Error} 群范围、状态、身份冲突或参数不符时固定错误。
   */
  function getObservedGroupMembers(target, limit = 50) {
    const peer = idString(target);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw safeError('GROUP_MEMBER_INPUT_INVALID');
    if (state !== 'active' || !allowReceive || !peer || !targetAllowed('group', peer) || !observedGroups.has(peer)
      || conflictedGroups.has(peer)) throw safeError('MEMBER_NOT_OBSERVED');
    const members = [...(groupMembers.get(peer) ?? new Map())].slice(0, limit).map(([user_id, member]) => ({
      userId: user_id, nickname: member.nickname, card: member.card }));
    return { members, partial: true, observedCount: groupMembers.get(peer)?.size ?? 0,
      source: 'current_online_messages', instruction: '仅列出本次连接实际发过言且身份核验无冲突的成员，不是完整群名单。' };
  }
  /**
   * 查询当前聊天已核验成员是否为本账号好友；不枚举好友、不发送申请。
   * @param {string} kind private或group。@param {string|number} target 当前会话。@param {string|number} user 已观察成员UIN。
   * @returns {object} isFriend为原生同步布尔结果；异常不当作false；单线程只读。
   * @throws {Error} 好友接收许可关闭、身份不可核验或原生返回异常时固定错误。
   */
  function getObservedFriendStatus(kind, target, user) {
    if (!friendPermissions.receiveRequests) throw safeError('FRIEND_STATUS_NOT_ALLOWED');
    const member = getObservedMember(kind, target, user), peer = idString(target);
    const uid = kind === 'private' ? peers.get(peer) : groupMembers.get(peer)?.get(String(member.user_id))?.uid;
    if (!uidString(uid)) throw safeError('MEMBER_NOT_OBSERVED');
    try {
      const result = nativeMethod(nativeMethod(session, 'getBuddyService')(), 'isBuddy')(uid);
      if (result instanceof Promise) result.catch(() => {});
      if (typeof result !== 'boolean') throw safeError('FRIEND_STATUS_UNAVAILABLE');
      return { isFriend: result, source: 'current_native_buddy_cache', requestSent: false };
    } catch { throw safeError('FRIEND_STATUS_UNAVAILABLE'); }
  }
  /** 只读刷新当前已观察成员的一条好友申请结构，不返回UID/正文或提交审批。@param {string} kind 当前聊天类型。@param {string|number} target 当前会话。@param {string|number} user 已观察成员UIN。@returns {Promise<object>} 类型、标志、过滤原因及可选短期人审资格；资格本身不构成人工批准。查询失败不猜测不存在。 */
  async function inspectObservedFriendRequest(kind, target, user) {
    if (!friendPermissions.receiveRequests) throw safeError('FRIEND_STATUS_NOT_ALLOWED');
    const member = getObservedMember(kind, target, user), peer = idString(target);
    const uid = kind === 'private' ? peers.get(peer) : groupMembers.get(peer)?.get(String(member.user_id))?.uid;
    if (!uidString(uid)) throw safeError('MEMBER_NOT_OBSERVED');
    const revision = configurationRevision, result = await requests.inspectTarget(uid);
    getObservedMember(kind, target, user);
    const currentUid = kind === 'private' ? peers.get(peer) : groupMembers.get(peer)?.get(String(member.user_id))?.uid;
    if (currentUid !== uid || configurationRevision !== revision) throw safeError('MEMBER_NOT_OBSERVED');
    for (const [id, item] of friendRequestReviews) if (item.expiresAt <= Date.now()) friendRequestReviews.delete(id);
    if (/^qqreq_[a-f0-9]{48}$/.test(result.reviewId ?? '') && Number.isSafeInteger(result.reviewExpiresAt)) {
      if (friendRequestReviews.size >= 16) throw safeError('FRIEND_REQUEST_REVIEW_LIMIT');
      friendRequestReviews.set(result.reviewId, { kind, peer, user: String(member.user_id), uid, revision, expiresAt: result.reviewExpiresAt });
    }
    return result;
  }
  /** 仅由本机操作员明确批准已核对的指定申请，身份/权限变化时拒绝。@param {string} reviewId 当前十分钟一次性核对资格，不接受UID。@returns {Promise<object>} 实际审批与好友确认结果，不重试；不向模型开放此原生动作。 */
  function approveInspectedFriendRequest(reviewId) {
    const item = friendRequestReviews.get(reviewId);
    if (!item || !friendPermissions.autoAccept || item.expiresAt <= Date.now() || item.revision !== configurationRevision) throw safeError('FRIEND_REQUEST_REVIEW_NOT_ALLOWED');
    getObservedMember(item.kind, item.peer, item.user);
    const uid = item.kind === 'private' ? peers.get(item.peer) : groupMembers.get(item.peer)?.get(item.user)?.uid;
    if (uid !== item.uid) throw safeError('FRIEND_REQUEST_REVIEW_NOT_ALLOWED');
    friendRequestReviews.delete(reviewId); return requests.approveInspected(reviewId);
  }
  /**
   * 为当前已观察授权会话返回本次登录账号的头像主体；不返回原生UID。
   * @param {string} kind private或group。@param {string|number} target 当前授权会话。
   * @returns {object} 当前自身标记、UIN及已核验昵称；同步只读。
   * @throws {Error} 未授权、离线、未观察会话或映射冲突时固定错误。
   */
  function getSelfAvatarSubject(kind, target) {
    const peer = idString(target);
    const allowed = kind === 'private' ? peer && targetAllowed(kind, peer) && peers.has(peer) && !blockedPeers.has(peer)
      : kind === 'group' && peer && targetAllowed(kind, peer) && !conflictedGroups.has(peer) && groupMembers.get(peer)?.size > 0;
    if (state !== 'active' || !allowReceive || !allowReadSelfAvatar || !allowed) throw safeError('SELF_AVATAR_UNAVAILABLE');
    return { user_id: selfUin, nickname: ownNickname, nicknameAvailable: ownNickname.length > 0, card: '', is_self: true };
  }
  /** 核验头像范围后刷新真实昵称；异步返回前重核会话代次和权限。@returns {Promise<object>} 与同步头像主体相同的最小字段。 */
  async function readSelfAvatarSubject(kind, target) {
    getSelfAvatarSubject(kind, target); const revision = configurationRevision;
    await readLoginInfo();
    if (configurationRevision !== revision) throw safeError('SELF_AVATAR_UNAVAILABLE');
    return getSelfAvatarSubject(kind, target);
  }
  /**
   * 只为本次已观察且允许发图的会话核验API生成资格，不调用生成API或发送消息。
   * @param {string} kind private/group。@param {string} target 当前会话号码。
   * @returns {object} 固定authorized=true，不返回账号、成员、原生UID或文件信息。
   * @throws {Error} 独立许可关闭、掉线、范围/映射不符时固定拒绝；同步，无副作用。
   */
  function getImageGenerationSubject(kind, target) {
    const peer = idString(target);
    const observed = kind === 'private' ? peer && peers.has(peer) && !blockedPeers.has(peer)
      : kind === 'group' && peer && !conflictedGroups.has(peer) && groupMembers.get(peer)?.size > 0;
    if (state !== 'active' || !allowReceive || !allowSend || !allowGenerateImages || !imageStore ||
        !observed || !targetAllowed(kind, peer)) throw safeError('IMAGE_GENERATION_NOT_ALLOWED');
    return { authorized: true };
  }
  /** 本次群管理同步范围预检；不代替execute中的当前身份核验。@param {string} action atAll/mute/kick。@param {string} group 当前群。@returns {object} 不含身份的授权标记；失败抛固定错误。 */
  function getGroupAdminSubject(action, group) {
    if (!adminContext(action, idString(group))) throw safeError('GROUP_ADMIN_NOT_ALLOWED');
    return { authorized: true };
  }
  /** 对本次已观察成员执行一次独立授权的禁言/踢人；原生accepted不等于已生效。@param {object} input action/group/user/duration。@returns {Promise<object>} 固定结果，不重试；目标/在线/角色由核心重验。 */
  function executeGroupAction(input) { return admin.execute(input); }
  /** 对当前已观察聊天核验账号级说说发布资格；不会读取授权票据或发帖。@param {string} kind private/group。@param {string} target 当前聊天。@returns {object} 固定资格与操作员选择的可见范围，拒绝任意目标。 */
  function getQzoneSubject(kind, target) {
    const peer = idString(target), observed = kind === 'private' ? peers.has(peer) && !blockedPeers.has(peer)
      : kind === 'group' && observedGroups.has(peer) && !conflictedGroups.has(peer);
    if (state !== 'active' || !allowReceive || !qzoneConfig.enabled || !peer || !observed || !targetAllowed(kind, peer)) throw safeError('QZONE_NOT_ALLOWED');
    return { authorized: true, audience: qzoneConfig.audience };
  }
  /** 从当前已观察会话触发一次账号级说说；可见范围由本机配置决定，不接受模型指定目标。@param {string} kind 当前会话类型。@param {string} target 当前会话。@param {string} text 原创文字。@returns {Promise<object>} 发布接口回执，未知不重试。 */
  function publishQzone(kind, target, text) {
    if (qzoneTask) throw safeError('QZONE_BUSY');
    getQzoneSubject(kind, target); qzoneSource = { kind, peer: idString(target) };
    const task = qzone.publish(text); qzoneTask = task;
    return task.finally(() => { if (qzoneTask === task) { qzoneTask = null; qzoneSource = null; } });
  }
  /** 核验当前已观察聊天的单项自身资料许可，不读取资料。@param {string} kind private/group。@param {string} target 当前聊天。@param {string} field 固定字段。@returns {object} authorized/field；不接受目标账号。 */
  function getSelfProfileSubject(kind, target, field) {
    const peer = idString(target), observed = kind === 'private' ? peers.has(peer) && !blockedPeers.has(peer)
      : kind === 'group' && observedGroups.has(peer) && !conflictedGroups.has(peer);
    if (state !== 'active' || !allowReceive || profilePermissions[field] !== true || !peer || !observed || !targetAllowed(kind, peer)) {
      throw safeError('SELF_PROFILE_NOT_ALLOWED');
    }
    return { authorized: true, field };
  }
  /** 只修改本次登录账号，字段/图片仍由核心及缓存重验。@param {string} kind 当前聊天类型。@param {string} target 当前聊天。@param {object} input 单字段请求。@returns {Promise<object>} 最小结果；头像受理不等于实际显示更新。 */
  function updateSelfProfile(kind, target, input) {
    if (profileTask) throw safeError('SELF_PROFILE_BUSY');
    getSelfProfileSubject(kind, target, field(input, 'field')); profileSource = { kind, peer: idString(target) };
    const task = profile.execute(input).then(result => {
      if (field(input, 'field') === 'nickname' && ['observed', 'unchanged'].includes(result.outcome)) {
        ownNickname = displayName(field(input, 'value')); ownNicknameAt = Date.now();
      }
      return result;
    }); profileTask = task;
    return task.finally(() => { if (profileTask === task) { profileTask = null; profileSource = null; } });
  }
  /** 强制定向读取当前登录账号的一项已勾选资料，不改QQ。@param {string} kind 当前聊天类型。@param {string} target 当前已观察会话。@param {string} field nickname/signature/birthday。@returns {Promise<object>} 最小字段和值；同一时刻只允许一个资料任务。 */
  function readSelfProfile(kind, target, field) {
    if (profileTask) throw safeError('SELF_PROFILE_BUSY');
    if (!['nickname','signature','birthday'].includes(field)) throw safeError('SELF_PROFILE_REQUEST_INVALID');
    getSelfProfileSubject(kind, target, field); profileSource = { kind, peer: idString(target) };
    const task = profile.readField(field); profileTask = task;
    return task.finally(() => { if (profileTask === task) { profileTask = null; profileSource = null; } });
  }
  /** 裁剪预览或列出自身头像备份，不写QQ头像。@param {string} kind 当前会话类型。@param {string} target 当前会话。@param {object} input operation及可选file/crop。@returns {Promise<object>} 无路径的预览/备份编号；仍须头像独立许可。 */
  function prepareSelfAvatar(kind, target, input) {
    if (profileTask) throw safeError('SELF_PROFILE_BUSY');
    getSelfProfileSubject(kind, target, 'avatar');
    if (!input || typeof input !== 'object' || !['preview','backups'].includes(field(input, 'operation'))
        || Object.keys(input).some(key => !(input.operation === 'preview' ? ['operation','file','crop'] : ['operation']).includes(key)))
      throw safeError('SELF_PROFILE_REQUEST_INVALID');
    if (!profileStager) throw safeError('SELF_PROFILE_AVATAR_UNAVAILABLE');
    profileSource = { kind, peer: idString(target) };
    const revision = profileContext('avatar');
    const task = Promise.resolve().then(() => input.operation === 'backups' ? profileStager.list(revision)
      : profileStager.preview(input.file, input.crop, revision));
    profileTask = task;
    return task.finally(() => { if (profileTask === task) { profileTask = null; profileSource = null; } });
  }
  async function sendText(kind, target, message) {
    const revision = configurationRevision;
    let prepared = prepareSend(kind, target, message);
    if (prepared.payload.segments.some((segment) => ['image', 'record'].includes(segment.type))) {
      const images = new Map();
      for (const segment of prepared.payload.segments) if (segment.type === 'image' && !images.has(segment.data.file))
        images.set(segment.data.file, await imageStore.prepareSend(segment.data.file, prepared.chatType + ':' + prepared.peerUid));
      for (const segment of prepared.payload.segments) if (segment.type === 'record')
        images.set(segment.data.file, await voiceStore.prepareSend(segment.data.file, prepared.chatType + ':' + prepared.peerUid));
      prepared = prepareSend(kind, target, message, images);
    }
    const hasAtAll = prepared.payload.segments.some(segment => segment.type === 'at' && segment.data.qq === 'all');
    if (hasAtAll) {
      const time = Date.now();
      if (atAllAttempts >= 3 || time < atAllNext || time < (atAllGroups.get(prepared.targetUin) ?? 0)) throw safeError('SEND_LIMIT');
      await admin.checkAtAll(prepared.targetUin);
      prepared = prepareSend(kind, target, message);
    }
    const { targetUin, chatType, peerUid, payload } = prepared;
    let correlation;
    try {
      const time = nativeMethod(nativeMethod(session, 'getMSFService')(), 'getServerTime')();
      if (typeof time !== 'string' || !/^\d{1,20}$/.test(time)) throw safeError('SERVER_TIME_INVALID');
      correlation = nativeMethod(service, 'generateMsgUniqueId')(chatType, time);
      if (!idString(correlation) || typeof correlation !== 'string' || pending.has(correlation)) throw safeError('CORRELATION_INVALID');
    } catch { throw safeError('SEND_PREPARATION_FAILED'); }
    if (state !== 'active' || revision !== configurationRevision || !authorized()) throw safeError('SEND_DISABLED');
    if (chatType === 2) noteGroupActivity(targetUin);
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const entry = { chatType, peerUid, accepted: false, confirmed: false, nativeId: null,
        finish(code = null) {
          if (done) return; done = true; clearTimeout(timer); pending.delete(correlation);
          if (code) {
            if (code === 'SEND_REJECTED') counters.sendsRejected++; else counters.sendsUnknown++;
            reject(safeError(code)); return;
          }
          const event = { time: Math.floor(Date.now() / 1000), self_id: protocolId(selfUin), post_type: 'message',
            message_type: kind, sub_type: chatType === 1 ? 'friend' : 'normal', user_id: protocolId(selfUin),
            message: payload.segments, raw_message: payload.text,
            sender: { user_id: protocolId(selfUin), nickname: ownNickname } };
          if (chatType === 2) event.group_id = protocolId(targetUin);
          try {
            const saved = remember(chatType + ':' + peerUid + ':' + entry.nativeId, event);
            counters.sendsConfirmed++; resolve({ message_id: saved.id });
          } catch { counters.sendsUnknown++; reject(safeError('SEND_OUTCOME_UNKNOWN')); }
        },
        check() { if (entry.accepted && entry.confirmed) entry.finish(); },
      };
      pending.set(correlation, entry);
      timer = setTimeout(() => entry.finish('SEND_OUTCOME_UNKNOWN'), sendTimeoutMs);
      counters.sendsAttempted++;
      if (hasAtAll) { const time = Date.now(); atAllAttempts++; atAllNext = time + 60000; atAllGroups.set(targetUin, time + 3600000); }
      try {
        const result = nativeMethod(service, 'sendMsg')('0', { chatType, peerUid, guildId: correlation }, payload.elements, new Map());
        Promise.resolve(result).then((returned) => {
          if (done) return;
          const code = field(returned, 'result');
          if (code === 0) { entry.accepted = true; entry.check(); }
          else entry.finish(typeof code === 'number' && !entry.confirmed ? 'SEND_REJECTED' : 'SEND_OUTCOME_UNKNOWN');
        }, () => entry.finish('SEND_OUTCOME_UNKNOWN')).catch(() => entry.finish('SEND_OUTCOME_UNKNOWN'));
      } catch { entry.finish('SEND_OUTCOME_UNKNOWN'); }
    });
  }
  function getMessage(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || !cached.has(Number(id))) throw safeError('MESSAGE_NOT_CACHED');
    return structuredClone(cached.get(Number(id)).event);
  }
  /** 核验冷场一次性资格和280字符以内的单条文字；不允许提及、图片、语音或数组。@param {string} target 当前群。@param {string} claim 内存资格。@param {string} message 草稿。@returns {void} 不满足则抛固定错误，无发送。 */
  function validateIdleMessage(target, claim, message) {
    if (typeof message !== 'string' || Array.from(message).length > 280) throw safeError('TEXT_LIMIT');
    prepareSend('group', target, message); idlePolicy.validate(String(target), claim);
  }
  /** 消耗一次资格后沿用普通发送回执；失败不返还预算。@param {string} target 群。@param {string} claim 一次性资格。@param {string} message 文字。@returns {Promise<object>} 实际原生回执，未知结果不重试。 */
  function sendIdleText(target, claim, message) {
    validateIdleMessage(target, claim, message); idlePolicy.consume(String(target), claim);
    return sendText('group', target, message).then(result => { idleSendsConfirmed++; return result; }, error => {
      if (error?.code === 'SEND_OUTCOME_UNKNOWN') idleSendsUnknown++; throw error;
    });
  }
  return Object.freeze({ start, stop, reconfigure, sendText, validateMessage, getObservedMember, getObservedGroupMembers, getObservedFriendStatus, getSelfAvatarSubject, readSelfAvatarSubject, getImageGenerationSubject, getGroupAdminSubject, executeGroupAction, getQzoneSubject, publishQzone, getSelfProfileSubject, updateSelfProfile, getMessage, getStatus, getLoginInfo, readLoginInfo, snapshot,
    /** 电话准备只启用本次原生会话；恢复前先等待旧电话资源实际清理。@param {object} input auto_answer布尔。@returns {Promise<object>} accepted不代表已接通。 */
    preparePhone:async input=>{await phoneCleanup;phoneCleanupFailed=false;return phone.prepare(input);},
    pollPhone:phone.poll,closePhone:phone.close,readPhoneAudio:phone.readAudio,writePhoneAudio:phone.writeAudio,
    clearPhoneAudio:phone.clearAudio,phoneMediaStatus:phone.mediaStatus,acceptPhoneCall:phone.accept,startPhoneCall:phone.start,endPhoneCall:phone.end,
    idleCandidates: () => idlePolicy.candidates(), claimIdleGroup: group => idlePolicy.claim(group), validateIdleMessage, sendIdleText,
    prepareSelfAvatar, readSelfProfile, inspectObservedFriendRequest, approveInspectedFriendRequest,
    /** 只读QQ自身收藏列表，仍核验本次实际观察且授权的目标。@param {object} params kind/peer_id/query/count。@returns {Promise<object>} 不含原生账号/路径/URL的列表。 */
    listFavoriteStickers: params => { const key = stickerInput(params, ['query', 'count']);
      if (!stickerContext(key, 'read')) throw safeError('STICKER_DISABLED');
      return nativeStickers().list(key, { query: params.query ?? '', count: params.count ?? 48 }); },
    /** 仅向所属桥接返回已收藏图片的下载源，模型路由不可透传。@param {object} params kind/peer_id/sticker_id。@returns {Promise<object>} QQ强制读回的单项元数据。 */
    getFavoriteStickerSource: params => { const key = stickerInput(params, ['sticker_id']);
      if (!stickerContext(key, 'read')) throw safeError('STICKER_DISABLED'); return nativeStickers().source(key, params.sticker_id); },
    /** 将当前会话有效图片一次性加入真实QQ收藏，强制读回后才确认。@param {object} params kind/peer_id/file。@returns {Promise<object>} confirmed或固定未知错误，不重试。 */
    collectFavoriteSticker: params => { const key = stickerInput(params, ['file']);
      if (!stickerContext(key, 'collect')) throw safeError('STICKER_DISABLED'); return nativeStickers().collect(key, params.file); },
    getImage: (params) => { if (!imageStore) throw safeError('IMAGE_DISABLED'); return imageStore.getImage(field(params, 'file'), field(params, 'offset')); },
    uploadImage: (params) => { if (!imageStore) throw safeError('IMAGE_DISABLED'); return imageStore.upload(params); },
    getRecord: (params) => { if (!voiceStore) throw safeError('VOICE_DISABLED'); return voiceStore.getRecord(params); },
    uploadRecord: (params) => { if (!voiceStore) throw safeError('VOICE_DISABLED'); return voiceStore.upload(params); },
    closeMedia: () => Promise.all([mediaCleanup, socialCleanup, profileCleanup, stickerCleanup, phoneCleanup, ...retiredMedia, profileTask?.catch(() => {}), qzoneTask?.catch(() => {})]),
    on: (name, callback) => { events.on(name, callback); return () => events.off(name, callback); } });
}
