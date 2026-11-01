import type {StoredMessage, StoredMedia, StoredTopic} from './v2-store.js';
/** 外部媒体输入只描述已访问的键，字段值仍由原转换规则规范化。 */
interface IncomingMedia {kind?: unknown; file?: unknown; url?: unknown; faceId?: unknown; emojiId?: unknown; summary?: unknown; subType?: unknown;}
/** 消息记账需要的状态切片，不持有会话表或定时器。 */
export interface V2MessageState {
  lastUnreadSeq: number; lastIncomingAt: number; preSleepWaitSatisfiedAt: number;
  preSleepWaitObservedAt: number; preSleepWaitAccumMs: number;
  recentMessages: StoredMessage[]; unread: StoredMessage[]; activeTopics?: StoredTopic[];
}
/** 拍一拍事件原始字段由原有字符串/布尔转换处理。 */
export interface PokeInput {sender?: unknown; userId?: unknown; targetId?: unknown; targetIsSelf: boolean; isOwner?: boolean; groupId?: unknown; action?: unknown; suffix?: unknown;}
/** 配置只约束本模块读取字段；同步保存不启动服务或模型调用。 */
export interface V2MessageDependencies<State extends V2MessageState> {
  readonly getSocialV2State: (key: string) => State;
  readonly cfg: {ownerQQ?: unknown; socialV2?: {context?: {recentLimit?: unknown; unreadLimit?: unknown}|null}};
  readonly sanitizeMediaSummary: (value: unknown) => string; readonly sanitizeForwardId: (value: unknown) => string;
  readonly seenForwardIds: Pick<Map<string,Set<string>>,'get'|'set'>;
  readonly truncateText: (text: string, limit: number) => string; readonly truncateTextTail: (text: string, limit: number) => string;
  readonly Date: Pick<DateConstructor,'now'>; readonly saveSocialV2State: () => void; readonly redactKnownTokensOnly: (text: string) => string;
}
/**
 * 集中来信、拍一拍和已发送消息的上下文记账，保留消息窗口与媒体字段。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createV2Messages<State extends V2MessageState>(deps: V2MessageDependencies<State>) {


  // ── 二代仿真模式（reserved2）唤醒调度 ──────────────────────────────────
  function appendSocialV2Message(key: string, sender: unknown, textContent: unknown, plainContent: unknown, quoteTargetIsSelf: boolean, isOwner: boolean, messageId: unknown, media: unknown = [], userId: unknown = null, forwardIds: unknown = []): void {
    const st = (0, deps.getSocialV2State)(key);
    const recentLimit = Number(deps.cfg.socialV2?.context?.recentLimit) || 100;
    const unreadLimit = Number(deps.cfg.socialV2?.context?.unreadLimit) || 30;
    // 存储层的归一化**不能只留 kind/file/url/faceId**：reserved2 的图片/表情工具
    // （findMessageMedia → fetchOneBotImage / fetchMediaData）只从这里的产物取字段。
    // 丢了 emojiId/subType，fetchOneBotImage 的 isSticker 判定为假 ⇒ 市场/收藏表情会先走
    // 必然失败的 get_image、且 emoji_id 推出的 CDN 兜底整条失效（见 extractMediaFromSegments
    // 与「部分表情 20 秒超时」的根因）；丢了 summary，模型只看到「[图片1]」而不是「[表情:给你糖吃]」；
    // kind 被拍平还会让 mface（市场表情）被当成普通图片。
    const safeMedia = Array.isArray(media) ? (media as IncomingMedia[]).map((m) => {
      const kind = m?.kind === 'face' ? 'face' : (m?.kind === 'sticker' ? 'sticker' : 'image');
      const item: StoredMedia = { kind };
      if (m?.file) item.file = String(m.file);
      if (m?.url) item.url = String(m.url);
      if (m?.faceId) item.faceId = String(m.faceId);
      if (m?.emojiId) item.emojiId = String(m.emojiId);
      if (m?.summary) item.summary = (0, deps.sanitizeMediaSummary)(m.summary);
      if (m?.subType) item.subType = String(m.subType);
      return item;
    }).filter((m) => (m.kind === 'face' ? !!m.faceId : !!(m.file || m.url || m.emojiId))) : [];
    const safeForwardIds = (Array.isArray(forwardIds) ? forwardIds : []).map(deps.sanitizeForwardId).filter(Boolean);
    if (safeForwardIds.length) {
      let set = deps.seenForwardIds.get(key);
      if (!set) {
        set = new Set();
        deps.seenForwardIds.set(key, set);
      }
      for (const fid of safeForwardIds) set.add(fid);
      // 有界：最多保留 1000 个最近见过的 forward id
      if (set.size > 1000) {
        for (const old of set) {
          set.delete(old);
          if (set.size <= 1000) break;
        }
      }
    }
    const msg = {
      seq: (st.lastUnreadSeq || 0) + 1,
      messageId: messageId != null ? String(messageId) : null,
      sender,
      userId: userId != null ? String(userId) : null,
      text: (0, deps.truncateText)(String(textContent), 200),
      plain: (0, deps.truncateText)(String(plainContent ?? textContent), 200),
      tail: (0, deps.truncateTextTail)(String(plainContent ?? textContent), 200),
      quoteTargetIsSelf: !!quoteTargetIsSelf,
      isOwner: !!isOwner,
      ownerLabel: isOwner ? `管理员（ownerQQ ${deps.cfg.ownerQQ ?? ''}）` : '',
      isSelf: false,
      media: safeMedia,
      hasMedia: safeMedia.length > 0,
      forwardIds: safeForwardIds,
      hasForward: safeForwardIds.length > 0,
      time: deps.Date.now()
    };
    st.lastUnreadSeq = msg.seq;
    st.lastIncomingAt = deps.Date.now();
    st.preSleepWaitSatisfiedAt = 0; // 有新消息进来，之前的“沉睡前已等待/已观察”作废
    st.preSleepWaitObservedAt = 0;
    st.preSleepWaitAccumMs = 0;
    st.recentMessages.push(msg);
    if (st.recentMessages.length > recentLimit) st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
    st.unread.push(msg);
    if (st.unread.length > unreadLimit) st.unread.splice(0, st.unread.length - unreadLimit);
    const lowerPlain = String(plainContent ?? textContent ?? '');
    for (const t of st.activeTopics || []) {
      if (!t || typeof t !== 'object') continue;
      const topicHit = String(t.text || '').length > 0 && lowerPlain.includes(String(t.text || '').slice(0, 10));
      const participantHit = Array.isArray(t.participants) && t.participants.some((p) => p && lowerPlain.includes(String(p)));
      if (topicHit || participantHit) t.lastMentionAt = deps.Date.now();
    }
    (0, deps.saveSocialV2State)();
  }

  // 二代拍一拍事件写入最近/未读消息流，让 AI 能看到“谁拍了拍谁/拍了拍我”。
  function appendSocialV2Poke(key: string, { sender, userId, targetId, targetIsSelf, isOwner = false, groupId = null, action = '', suffix = '' }: PokeInput) {
    const st = (0, deps.getSocialV2State)(key);
    const recentLimit = Number(deps.cfg.socialV2?.context?.recentLimit) || 100;
    const unreadLimit = Number(deps.cfg.socialV2?.context?.unreadLimit) || 30;
    const actor = String(sender || userId || '未知');
    const target = targetIsSelf ? '你' : (String(targetId || '未知'));
    const actionText = action ? String(action) : '拍了拍';
    const suffixText = suffix ? ` ${String(suffix)}` : '';
    const text = `[拍一拍] ${actor} ${actionText} ${target}${suffixText}`.slice(0, 200);
    const msg = {
      seq: (st.lastUnreadSeq || 0) + 1,
      messageId: null,
      sender: actor,
      userId: userId != null ? String(userId) : null,
      text,
      plain: text,
      tail: text,
      kind: 'poke',
      quoteTargetIsSelf: !!targetIsSelf,
      isOwner: !!isOwner,
      ownerLabel: isOwner ? `管理员（ownerQQ ${deps.cfg.ownerQQ ?? ''}）` : '',
      isSelf: false,
      media: [],
      hasMedia: false,
      forwardIds: [],
      hasForward: false,
      poke: { targetId: targetId != null ? String(targetId) : null, targetIsSelf: !!targetIsSelf, groupId: groupId != null ? String(groupId) : null },
      time: deps.Date.now()
    };
    st.lastUnreadSeq = msg.seq;
    st.lastIncomingAt = deps.Date.now();
    st.preSleepWaitSatisfiedAt = 0;
    st.preSleepWaitObservedAt = 0;
    st.preSleepWaitAccumMs = 0;
    st.recentMessages.push(msg);
    if (st.recentMessages.length > recentLimit) st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
    st.unread.push(msg);
    if (st.unread.length > unreadLimit) st.unread.splice(0, st.unread.length - unreadLimit);
    (0, deps.saveSocialV2State)();
    return msg;
  }

  function recordSentMessagesV2(key: string, messages: unknown): void {
    const st = (0, deps.getSocialV2State)(key);
    const now = deps.Date.now();
    const recentLimit = Number(deps.cfg.socialV2?.context?.recentLimit) || 100;
    const list = Array.isArray(messages) ? messages : [];
    for (let i = 0;i < list.length;i++) {
      const text = (0, deps.redactKnownTokensOnly)(String(list[i] ?? '')).slice(0, 200);
      st.recentMessages.push({
        sender: '我',
        text,
        plain: text,
        quoteTargetIsSelf: false,
        isOwner: true,
        ownerLabel: '我',
        isSelf: true,
        time: now + i * 1000
      });
    }
    if (st.recentMessages.length > recentLimit) st.recentMessages.splice(0, st.recentMessages.length - recentLimit);
    // AI 实际发言/参与了，说明这轮选择“继续回复”，沉睡前观察状态作废；下次想睡需重新走 5 分钟等待。
    st.preSleepWaitSatisfiedAt = 0;
    st.preSleepWaitObservedAt = 0;
    st.preSleepWaitAccumMs = 0;
    (0, deps.saveSocialV2State)();
  }
  return { appendSocialV2Message, appendSocialV2Poke, recordSentMessagesV2 };
}
