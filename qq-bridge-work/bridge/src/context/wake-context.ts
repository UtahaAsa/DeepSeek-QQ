import type {ReadReceiptState, ReceiptMessage} from './read-receipts.js';
import type {StoredMessage} from '../social/v2-store.js';
import type {WakeConfig} from '../wake/configuration.js';
/** 提示构建只读取所需状态，不取得已读确认或发送权限。 */
export interface WakeContextState<Message extends StoredMessage = StoredMessage> extends ReadReceiptState<Message> {
  recentMessages: Message[]; agentToken: string; wakeConfig?: WakeConfig;
  lastAiReplyAt?: number; lastIncomingAt?: number;
}
/** 模型视图可以删除原字段；通过泛型保留压缩器声明的实际消息类型。 */
export interface WakeSnapshot<Message extends ReceiptMessage> {
  messages: Message[]; recent: Message[]; now: string; newestAgo?: string; unreadCount: number;
  includedUnreadCount: number; readThroughSeq: number; partial: boolean;
}
/** 外部配置数字仍沿用既有转换与限幅。 */
export interface WakeContextConfiguration {socialV2?: {
  wait?: {defaultQuietMs?: unknown; minQuietAfterNewMs?: unknown; maxMs?: unknown}|null;
  wake?: {staleChatMinutes?: unknown; staleSilentMinutes?: unknown; preSleepWaitMs?: unknown}|null;
  context?: {inlineWakeMessages?: unknown; wakeMaxChars?: unknown; wakeMessageLimit?: unknown; wakeRecentLimit?: unknown}|null;
  sticker?: {enabled?: unknown; includeInPrompt?: unknown; promptMaxStickers?: unknown};
};}
/** 状态、存储消息、模型视图及表情表类型分别保留，不以压缩视图覆盖原消息。 */
export interface WakeContextDependencies<Message extends StoredMessage, State extends WakeContextState<Message>, Compact extends ReceiptMessage, Stickers> {
  readonly cfg: WakeContextConfiguration; readonly Date: DateConstructor; readonly Math: Pick<Math,'max'|'min'|'round'|'floor'|'ceil'>;
  readonly isDirectedAtAi: (text: string) => boolean; readonly looksLikeUnfinished: (text: string) => boolean;
  readonly describeAge: (time: unknown, now: number) => string;
  readonly v2ToolEnabled: (tool: 'getUnread'|'getRecent') => boolean; readonly getSocialV2State: (key: string) => State;
  readonly readThroughSeqV2: (state: State, additional?: readonly Compact[]) => number;
  readonly compactModelMessage: (message: Message, options: {now: number}) => Compact;
  readonly selfDisplayName: unknown; readonly selfUserId: unknown;
  readonly readRoleState: () => {role?: unknown}; readonly formatMemoryV2: (state: State) => string;
  readonly buildStickerStrategyHint: () => string; readonly stickerEntries: Stickers;
  readonly buildStickerContext: (entries: Stickers, max: unknown) => string; readonly formatInitialPromptV2: (key: string) => string;
}
/**
 * 构建限长消息快照、时间感及唤醒提示词；构建快照本身不授予已读回执。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createWakeContext<Message extends StoredMessage, State extends WakeContextState<Message>, Compact extends ReceiptMessage, Stickers>(deps: WakeContextDependencies<Message,State,Compact,Stickers>) {
  const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

  function formatParticipationV2(st: State | null | undefined): string {
    if (!st) return '';
    const now = deps.Date.now();
    const hour = 60 * 60 * 1000;
    const fiveMin = 5 * 60 * 1000;
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const aiCount = recent.filter((m) => m && m.isSelf && now - (Number(m.time) || 0) < hour).length;
    const otherCount = recent.filter((m) => m && !m.isSelf && now - (Number(m.time) || 0) < hour).length;
    if (!aiCount && !otherCount) return '';
    const fiveMinOthers = recent.filter((m) => m && !m.isSelf && now - (Number(m.time) || 0) < fiveMin);
    const activeSenders = new Set(fiveMinOthers.map((m) => m && (m.sender || m.user_id || '?'))).size;
    const directUnread = Array.isArray(st.unread) ? st.unread.filter((m) => m && (0, deps.isDirectedAtAi)(String(m.plain || m.text || ''))).length : 0;
    const lastAiGap = now - (Number(st.lastAiReplyAt) || 0);
    const recentAi2m = recent.filter((m) => m && m.isSelf && now - (Number(m.time) || 0) < 2 * 60 * 1000).length;
    let hint = '';
    if (directUnread > 0) {
      hint = '有人直接找你，优先回应；其余热闹可以挑着参与。';
    } else if (recentAi2m >= 2) {
      hint = '你刚刚已经连回过好几次了，这轮可以少说，但别直接消失；有值得接的仍要自然接一句。';
    } else if (lastAiGap < 120000) {
      hint = '你刚说过话，先听一会儿；有能接住的话再自然接，不用硬等点名。';
    } else if (aiCount >= 5) {
      hint = '你最近发言偏多，这轮可以少说，但遇到真正想说的仍主动说。';
    } else if (fiveMinOthers.length >= 10 || (fiveMinOthers.length >= 6 && activeSenders >= 3)) {
      hint = `群聊正热（近5分钟${fiveMinOthers.length}条${activeSenders ? `/${activeSenders}人` : ''}在聊），不用逐条关注；挑最值得接的一句主动参与，插不上再潜水。`;
    } else if (otherCount >= 10 && aiCount === 0) {
      hint = '群聊很热闹但没叫你，可以插一句有趣的，或只看不说。';
    } else if (otherCount < 3 && aiCount > 0) {
      hint = '群聊有点冷，不要一个人撑场；但有想法时仍可主动抛一句。';
    } else if (aiCount <= 1 && otherCount >= 10) {
      hint = '这轮可以简短接一句，别潜水；挑一个点参与。';
    }
    const burstText = fiveMinOthers.length ? `；近5分钟群聊 ${fiveMinOthers.length} 条${activeSenders ? `/${activeSenders}人` : ''}` : '';
    return `【参与度参考】你最近 1 小时发言 ${aiCount} 次，群友发言 ${otherCount} 条${burstText}。${hint}`;
  }

  function suggestQuietMsV2(st: State | null | undefined): number {
    const defaultMs = Number(deps.cfg.socialV2?.wait?.defaultQuietMs) || 3000;
    if (!st) return defaultMs;
    const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
    const last = [...recent].reverse().find((m) => m && !m.isSelf);
    if (!last) return defaultMs;
    const text = String(last.tail || last.plain || last.text || '').trim();
    if ((0, deps.looksLikeUnfinished)(text)) return 6000;
    const burst = recent.filter((m) => m && !m.isSelf && deps.Date.now() - Number(m.time || 0) < 15000).length;
    if (burst >= 3) return 4000;
    return defaultMs;
  }

  /** 本地 HH:MM（与消息 at 字段同一口径）。 */
  function localClockText(ms: unknown): string {
    const d = new deps.Date(Number(ms));
    if (!Number.isFinite(d.getTime())) return '';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function timeSenseCfg() {
    const wake = deps.cfg.socialV2?.wake ?? {};
    const boundedMin = (value: unknown, fallback: number, min: number, max: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= min ? deps.Math.min(max, deps.Math.round(n)) : fallback;
    };
    const chatMin = boundedMin(wake.staleChatMinutes, 10, 1, 600);
    // 「默认不回」必须不早于「不算实时对话」，否则两档规则会互相打架。
    const silentMin = deps.Math.max(chatMin, boundedMin(wake.staleSilentMinutes, 120, 5, 2880));
    return { chatMin, silentMin };
  }

  /** 唤醒原因里带的本地 seq（形如 `atMention@seq194`），没有就 null。 */
  function wakeReasonSeq(reason: unknown): number | null {
    const match = /@seq(\d+)$/.exec(String(reason ?? '').trim());
    if (!match) return null;
    const seq = Number(match[1]);
    return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
  }

  function findV2MessageBySeq(st: State | null | undefined, seq: unknown): Message | null {
    if (!st || !Number.isSafeInteger(seq)) return null;
    for (const list of [st.unread, st.recentMessages]) {
      const hit = (Array.isArray(list) ? list : []).find((m) => m && m.seq === seq);
      if (hit) return hit;
    }
    return null;
  }

  /**
     * 【时间感】规则块。没有可判断的消息时返回空串（引导/定时唤醒不必背这段）。
     *
     * 注意阈值必须和 §timeSenseCfg 一致，否则模型会看到自相矛盾的两档。
     */
  function buildTimeSenseLine(st: State): string {
    const now = deps.Date.now();
    const newest = [...(Array.isArray(st.unread) ? st.unread : [])].reverse().find((m) => m && !m.isSelf)
      || [...(Array.isArray(st.recentMessages) ? st.recentMessages : [])].reverse().find((m) => m && !m.isSelf)
      || null;
    if (!newest) return '';
    const ageText = (0, deps.describeAge)(newest.time, now);
    if (!ageText) return '';
    const { chatMin, silentMin } = timeSenseCfg();
    const sender = String(newest.sender || '未知');
    const ageMin = deps.Math.max(0, deps.Math.floor((now - Number(newest.time)) / 60000));
    const staleNow = ageMin >= chatMin;
    const tooOld = ageMin >= silentMin;
    const lines = [
      `【时间感：先看消息多旧，再决定怎么开口】现在 ${localClockText(now)}；最新一条来自「${sender}」，是 ${ageText} 之前发的（${localClockText(newest.time)}）。`,
      '- 消息里的 at 是本地时间、ago 是距现在多久；开口前先确认最新那条的 ago，不要凭感觉当成"刚刚"。',
      `- ${chatMin} 分钟以内：正常接，当实时对话。`
    ];
    // 中间档只在两档阈值真的分开时才写：silentMin === chatMin 时写「60～60 分钟」是自相矛盾的废话。
    if (silentMin > chatMin) {
      lines.push(`- ${chatMin}～${silentMin} 分钟：可以接，但别用"刚""哈哈哈刚看到"这类实时语气；先确认这个话题还在不在、对方还在不在。`);
    }
    lines.push(`- 超过 ${silentMin} 分钟：默认不回，直接 qq_mark_read 收尾；只有当那条明确是找你/提问你、而且回答现在仍然有用时才回，并且开头要带时间感（"这条我才看到""过了挺久才看到"）。`);
    if (staleNow) {
      lines.push(`⚠️ 本次属于「旧账」：最新消息已经是 ${ageText} 前，${tooOld ? `超过 ${silentMin} 分钟` : `超过 ${chatMin} 分钟`}。不要用秒回语气，也不要把别人的旧话题当现在的事接。`);
    }
    return `${lines.join('\n')}\n\n`;
  }

  function buildWakeSnapshotV2(key: string): WakeSnapshot<Compact> | null {
    const context = deps.cfg.socialV2?.context ?? {};
    if (context.inlineWakeMessages === false || (!(0, deps.v2ToolEnabled)('getUnread') && !(0, deps.v2ToolEnabled)('getRecent'))) return null;
    const st = (0, deps.getSocialV2State)(key);
    const bounded = (name: 'wakeMaxChars'|'wakeMessageLimit'|'wakeRecentLimit', fallback: number, min: number, max: number) => {
      const value = Number(context[name] ?? fallback);
      return Number.isFinite(value) ? deps.Math.min(max, deps.Math.max(min, deps.Math.round(value))) : fallback;
    };
    const maxChars = bounded('wakeMaxChars', 6000, 500, 20000);
    const maxUnread = bounded('wakeMessageLimit', 12, 1, 100);
    const maxRecent = bounded('wakeRecentLimit', 4, 0, 20);
    // 一次快照只取一次 now：同一批消息的 ago 必须彼此可比。
    const now = deps.Date.now();
    const newestIncoming = [...(Array.isArray(st.unread) ? st.unread : [])].reverse()
      .find((m) => m && !m.isSelf) || null;
    const newestAgo = newestIncoming ? (0, deps.describeAge)(newestIncoming.time, now) : '';
    const packet: WakeSnapshot<Compact> = {
      messages: [],
      recent: [],
      // now / newestAgo 让模型不必自己换算：最新一条多旧，直接写在快照头上。
      now: localClockText(now),
      ...(newestAgo ? { newestAgo } : {}),
      unreadCount: st.unread.length,
      includedUnreadCount: 0,
      readThroughSeq: (0, deps.readThroughSeqV2)(st),
      partial: st.unread.length > 0
    };
    const tryAdd = (field: 'messages'|'recent', msg: Message) => {
      const previousThrough = packet.readThroughSeq;
      packet[field].push((0, deps.compactModelMessage)(msg, { now }));
      packet.includedUnreadCount = packet.messages.length;
      packet.readThroughSeq = (0, deps.readThroughSeqV2)(st, [...packet.messages, ...packet.recent]);
      packet.partial = packet.messages.length < st.unread.length;
      if (JSON.stringify(packet).length <= maxChars) return true;
      packet[field].pop();
      packet.includedUnreadCount = packet.messages.length;
      packet.readThroughSeq = previousThrough;
      packet.partial = packet.messages.length < st.unread.length;
      return false;
    };
    if ((0, deps.v2ToolEnabled)('getUnread')) {
      // Oldest unread first: a budget cutoff must not silently acknowledge unseen messages.
      for (const msg of st.unread.slice(0, maxUnread)) if (!tryAdd('messages', msg)) break;
    }
    if ((0, deps.v2ToolEnabled)('getRecent') && maxRecent > 0) {
      const unread = new Set(st.unread.map((m) => m.seq));
      const recent = st.recentMessages.filter((m) => !Number.isSafeInteger(m.seq) || !unread.has(m.seq)).slice(-maxRecent);
      for (const msg of recent.reverse()) if (!tryAdd('recent', msg)) break;
      packet.recent.reverse();
    }
    return packet;
  }

  function replyTimingV2(st: State): {purpose: 'reply'; quietMs: number; remainingQuietMs: number} {
    const minimum = Number(deps.cfg.socialV2?.wait?.minQuietAfterNewMs);
    const minQuietMs = Number.isFinite(minimum) ? deps.Math.max(0, minimum) : 3000;
    const maxQuietMs = deps.Math.max(minQuietMs, deps.Math.min(120000, Number(deps.cfg.socialV2?.wait?.maxMs) || 600000));
    const quietMs = deps.Math.min(maxQuietMs, deps.Math.max(minQuietMs, deps.Math.round(suggestQuietMsV2(st)) || 0));
    const value = Number(st.lastIncomingAt);
    const elapsedMs = Number.isFinite(value) && value > 0 ? deps.Math.max(0, deps.Date.now() - value) : 0;
    return { purpose: 'reply', quietMs, remainingQuietMs: deps.Math.max(0, quietMs - elapsedMs) };
  }

  // 机器人自己的身份（昵称 + QQ 号）。**必须显式写进 prompt**：
  // agent 能看到的消息里只有 "@樰" 这串文本，没人告诉它"樰"就是它自己，于是它会把
  // @自己 当成 @别人、已读不回（issue #29）。群名片可能与昵称不同，但 at/引用段里
  // 带的是 QQ 号，所以两条都给。
  function selfIdentityTextV2() {
    const name = String(deps.selfDisplayName || '').trim();
    const id = String(deps.selfUserId || '').trim();
    if (!name && !id) return '';
    const label = name ? `「${name}」` : '（昵称未取到）';
    const idText = id ? `（QQ ${id}）` : '';
    const callBits = name
      ? `消息里出现「@${name}」、有人叫「${name}」、或引用你的消息，指的都是你 —— 不要当成别人`
      : '被 @、被叫到你的昵称、或引用你的消息，指的都是你 —— 不要当成别人';
    return `【你的身份】你在 QQ 上的昵称是${label}${idText}。${callBits}；群名片可能与昵称不同，at/引用段里带${id ? ` ${id} ` : '你的 QQ 号'}就是在叫你。\n\n`;
  }

  function buildWakePromptV2(key: string, reason: string): string {
    const roleState = (0, deps.readRoleState)();
    const roleLine = roleState.role ? `【当前角色】${roleState.role}（完整角色卡请调用 qq_get_prompt 查看）\n\n` : '';
    const identityLine = selfIdentityTextV2();
    const st = (0, deps.getSocialV2State)(key);
    const tokenLine = `【会话令牌】${st.agentToken}（调用二代状态工具时请在参数中带上此令牌）\n\n`;
    const memoryText = (0, deps.formatMemoryV2)(st);
    const memoryLine = memoryText ? `${memoryText}\n\n` : '';
    // 注意：黑话表不在这里注入，deliverPromptNow 的 withSlangContext 会统一注入，
    // 避免唤醒 prompt 出现两份黑话表。
    const participationText = formatParticipationV2(st);
    const participationLine = participationText ? `${participationText}\n\n` : '';
    const antiAiLine = '【反AI味】你不是客服：不用有求必应，可以装傻、已读乱回、拒绝推荐；少用“一绝/真管用/保证/绝对”这类词。\n\n';
    const stickerCfg = deps.cfg.socialV2?.sticker ?? {};
    const stickerLine = stickerCfg.enabled !== false && stickerCfg.includeInPrompt !== false
      ? `${(0, deps.buildStickerStrategyHint)()}\n${(0, deps.buildStickerContext)(deps.stickerEntries, stickerCfg.promptMaxStickers ?? 8)}\n\n`
      : '';
    const preSleepMs = deps.Math.max(0, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000);
    const proactiveLine = '【积极性】不要习惯性潜水：群里有你能接的话题就主动参与，偶尔插一句别人的话题也很正常；只有确实没话可说、对方已明确结束、或长时间没人说话时才潜水。\n\n';
    const replyTiming = replyTimingV2(st);
    const replyLine = `【首回复节奏】先处理已有消息，完整的问题及时回答。需要确认对方是否继续补充时，用 qq_wait_for_messages(purpose="reply", quietMs=${replyTiming.quietMs})；从最后来信计时，合批和读提示词的耗时也算，目前还差约 ${deps.Math.ceil(replyTiming.remainingQuietMs / 1000)} 秒静默。已安静够久可直接回，工具也会立即返回并补上思考期间的新消息。只有明确没说完、你确实要等下文时，才用普通 messages 长等待。\n\n`;
    const preSleepLine = `【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。\n\n【沉睡前强制等待】这是决定潜水收尾时的步骤，不是首回复的前置条件。除非对方明确说“不聊了/晚安/下了/拜拜”等结束语，否则每次设置潜水/下一次唤醒前，必须先调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成一次沉睡前观察；回复前 purpose="reply" 的短静默不能代替这次完整观察。若 ${deps.Math.round(preSleepMs / 60000)} 分钟内没人说话，返回 preSleepWaitSatisfied=true，可以设置下一次唤醒并沉睡；若期间有人发新消息，先查看返回的 newMessages——判断不需要你参与就可以直接沉睡，若你选择参与回复，则下次想睡时需要重新等待观察窗口。【不要靠猜】：等待返回里的 canSleepNow/hint 就是闸门的判断结果——canSleepNow=true 立刻收尾（mark_read 或 set_wake_config）；false 时按 hint 给出的 timeoutMs 一次等满，别用更短的 timeoutMs 去凑（更短的等待不算观察，只会白等一轮）。\n\n`;
    const lastMsg = [...(Array.isArray(st.recentMessages) ? st.recentMessages : [])].reverse().find((m) => m && !m.isSelf);
    const lastAiMin = st.lastAiReplyAt ? deps.Math.max(0, deps.Math.round((deps.Date.now() - Number(st.lastAiReplyAt)) / 60000)) : null;
    const statusBits = [`未读 ${(st.unread || []).length} 条`];
    if (lastMsg) {
      const lastAgo = (0, deps.describeAge)(lastMsg.time, deps.Date.now());
      statusBits.push(`最近一条来自 ${String(lastMsg.sender || '未知')}${lastAgo ? `（${lastAgo} 前）` : ''}：${String(lastMsg.text || lastMsg.plain || '').slice(0, 30)}`);
    }
    if (lastMsg && (0, deps.looksLikeUnfinished)(String(lastMsg.tail || lastMsg.plain || lastMsg.text || ''))) statusBits.push('对方可能没说完');
    if (lastAiMin != null) statusBits.push(`你上次发言 ${lastAiMin} 分钟前`);
    const statusLine = `【此刻状态】${statusBits.join('；')}\n\n`;
    const wc = st.wakeConfig || {};
    const wcTr = wc.triggers || {};
    const wcMode = wc.mode === 'active' ? '活跃' : '潜水';
    const wcTime = wc.infinite ? '无限' : (wc.sleepUntil && Number.isFinite(deps.Date.parse(wc.sleepUntil)) ? `有限至 ${new deps.Date(wc.sleepUntil).toLocaleString()}` : '未设时间');
    const wcTriggers = [];
    if (wcTr.atMention) wcTriggers.push('@');
    if (wcTr.nameMention) wcTriggers.push('名字');
    if (Array.isArray(wcTr.keywords) && wcTr.keywords.length) wcTriggers.push('关键词');
    if (wcTr.question) wcTriggers.push('提问');
    if (wcTr.poke) wcTriggers.push('拍一拍');
    if (Array.isArray(wcTr.speakerIds) && wcTr.speakerIds.length) wcTriggers.push(`指定成员(${wcTr.speakerIds.length}:${wcTr.speakerIds.join(',')})`);
    if (wcTr.anyMessage) wcTriggers.push('任意消息');
    if (Number(wcTr.probability) > 0) wcTriggers.push(`概率${wcTr.probability}`);
    const wakeLine = `【当前唤醒】${wcMode}，${wcTime}${wcTriggers.length ? `；触发：${wcTriggers.join('/')}` : ''}\n\n`;
    // 操作者预写的「初始提示词」（圈子主题/群内氛围等）：**只在首次唤醒**注入。
    // 放在最前面几段（角色/令牌之后）而不是末尾，是为了让它在长 prompt 里足够显眼；
    // 后续唤醒不再带它 —— 那时它已经在这条 DSH 会话的上下文里了。
    const initialPromptText = reason === 'bootstrap' ? (0, deps.formatInitialPromptV2)(key) : '';
    const initialPromptLine = initialPromptText ? `${initialPromptText}\n\n` : '';
    // 时间感放在 base 的最末尾：紧接着就是【唤醒】原因与行动指令，位置最显眼。
    const timeSenseLine = buildTimeSenseLine(st);
    const base = roleLine + identityLine + tokenLine + initialPromptLine + antiAiLine + proactiveLine + stickerLine + replyLine + statusLine + wakeLine + memoryLine + participationLine + preSleepLine + timeSenseLine;
    // 唤醒原因里的那条消息本身多旧：`atMention@seq194` 这种形态能反查到原消息。
    const triggeredSeq = wakeReasonSeq(reason);
    const triggeredMsg = triggeredSeq ? findV2MessageBySeq(st, triggeredSeq) : null;
    const triggeredAgo = triggeredMsg ? (0, deps.describeAge)(triggeredMsg.time, deps.Date.now()) : '';
    const triggeredLine = triggeredAgo ? `（触发这条是 ${triggeredAgo} 前发的${triggeredMsg?.sender ? `，来自「${triggeredMsg.sender}」` : ''}，不是刚刚）` : '';
    if (reason === 'bootstrap') {
      return `${base}【引导唤醒】你已接入 QQ 会话 ${key}。\n当前是二代仿真模式：你的文本输出不会自动发送到 QQ，所有发言必须通过工具完成。\n请先调用 qq_get_prompt 查看角色、推荐值、可用工具和状态；有待回应的消息先按首回复节奏处理，最后才用 qq_set_wake_config 设置你希望如何被唤醒。`;
    }
    if (reason === 'timeout') {
      return `${base}【唤醒】${key}\n原因：你设置的有限潜水时间已到；在你规定的时间内没有任何一项条件被触发，只是因为时间到了所以你被唤醒。\n你可以查看消息，或继续设置新的唤醒条件。`;
    }
    if (reason === 'replyCheck') {
      return `${base}【回复检查】${key}\n原因：你刚刚发送过消息，现在回来检查是否有人回复。\n已有回复时先看消息，需要短静默就用 qq_wait_for_messages(purpose="reply") 判断对方是否说完；如果没人回你，不用硬补一句，但也不要立刻潜水——先调用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成沉睡前观察：没人说话可收尾；有人说话则查看 newMessages，不需要你参与也可直接收尾（qq_mark_read 或 qq_set_wake_config）。`;
    }
    if (reason === 'proactiveCheck') {
      return `${base}【主动机会】${key}\n原因：群里已经安静了一段时间，这是一次你可以主动冒泡的机会。\n优先主动开个话题、追问上次没聊完的事、分享一个刚想到的想法；如果一时想不到，可以用 mcp__web-search-safe__web_search 搜一下当前热点/时事/网络热梗，再结合记忆里的群友兴趣挑一个自然角度。只要内容自然，就大胆开口；如果实在没话想说，再安静收尾（qq_mark_read 或 qq_set_wake_config）。`;
    }
    if (reason === 'poke') {
      return `${base}【唤醒】${key}\n原因：有人拍了一拍（可能拍了你，也可能拍了别人）。\n先看未读/最近消息里的 [拍一拍] 事件：如果是拍你，可以自然回应一句，也可以用 qq_send_poke 回一个拍一拍；如果是拍别人，觉得有趣也可以接梗。除了回应，偶尔也可以主动戳一下正在聊的人/熟人，像真人手贱/提醒/逗一下，但别频繁。不想接就安静收尾（qq_mark_read 或 qq_set_wake_config）。`;
    }
    return `${base}【唤醒】${key}\n原因：${reason}${triggeredLine}\n【行动前】先判断：群里在聊什么？热闹还是冷清？有没有人直接找你？对方说完了吗？你有没有真正想说的？\n如果群聊正热但没人叫你，可以插一句有趣的/相关的，插不上再看情况潜水；不要一上来就划走。\n【引用：只在必要时用】只有你这条消息指向的人或消息并非最新一条别人的消息，或者你连续的几句话中不同消息指代的是不同的消息或人时，才用 qq_reply 或 qq_send_message 的 replyToMessageId 指向具体那条；其他情况不要引用，别让对方猜。\n你可以调用工具查看未读消息、人设、状态，自行决定是否发言；决定潜水前必须按上面的【沉睡前强制等待】先等够观察窗口。`;
  }

  function buildWakeReminderPromptV2(key: string): string {
    const roleState = (0, deps.readRoleState)();
    const roleLine = roleState.role ? `【当前角色】${roleState.role}（完整角色卡请调用 qq_get_prompt 查看）\n\n` : '';
    const identityLine = selfIdentityTextV2();
    const st = (0, deps.getSocialV2State)(key);
    const tokenLine = `【会话令牌】${st.agentToken}（调用二代状态工具时请在参数中带上此令牌）\n\n`;
    const preSleepMs = deps.Math.max(0, Number(deps.cfg.socialV2?.wake?.preSleepWaitMs) || 300000);
    return `${roleLine}${identityLine}${tokenLine}【后台观察回执优先】qq_wait_for_messages 返回 background=true 时，后台已经接管观察，必须立即结束本轮；不要重复等待，也不要立即调用 qq_mark_read 或 qq_set_wake_config。后台静默到期不调用模型，新消息才会合并后唤醒。此回执优先于下文前台等待和收尾规则，未读水位不因后台交接而确认。\n\n【提醒】你还没有完成回合收尾。请调用 qq_set_wake_config 设置下一次唤醒条件（例如继续潜水多久、@/名字/关键词/提问/概率/指定成员等），或者调用 qq_mark_read 表示你看过且决定不接。这是为了防止你忘记收尾后进入“永眠”。注意：设置潜水前先用 qq_wait_for_messages(timeoutMs=${preSleepMs}) 完成沉睡前观察；等待期间有人说话时查看 newMessages，判断不需要你参与即可收尾。`;
  }
  return { formatParticipationV2, suggestQuietMsV2, localClockText, timeSenseCfg, wakeReasonSeq, findV2MessageBySeq, buildTimeSenseLine, buildWakeSnapshotV2, replyTimingV2, selfIdentityTextV2, buildWakePromptV2, buildWakeReminderPromptV2 };
}
