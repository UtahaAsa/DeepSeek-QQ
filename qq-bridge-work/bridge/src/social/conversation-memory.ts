import type {StoredTopic, StoredThought} from './v2-store.js';
/** 兼容持久化想法；createdAt只记录本模块写入的毫秒时间戳。 */
export interface ConversationMemoryThought extends StoredThought {createdAt?: number;}
/** 仅持有所属会话的记忆切片；其余状态、定时器与所有权均留在宿主。 */
export interface ConversationMemoryState {
  activeTopics?: StoredTopic[];
  pendingThoughts?: ConversationMemoryThought[];
  memberImpressions?: Record<string, unknown>;
}
/** 旧追加入口允许对象和数组；其中字段尚未校验，由既有实现逐项转换。 */
export type ConversationMemoryExtra = Readonly<Record<string, unknown>> | readonly unknown[];
/** 纯格式化不保存；追加原地更新并同步调用save，不复制会话容器。 */
export interface ConversationMemory {
  readonly formatMemoryV2: (state: ConversationMemoryState | null | undefined) => string;
  readonly appendMemoryV2: (state: ConversationMemoryState | null | undefined, category: unknown, content: unknown, extra?: ConversationMemoryExtra) => undefined;
}
/** 文本转换及毫秒时钟必须同步返回；save沿用宿主同步持久化，异常向上抛出。 */
export interface ConversationMemoryDependencies {
  readonly redactKnownTokensOnly: (text: string) => string;
  readonly truncateText: (text: string, maxChars: number) => string;
  readonly save: () => void;
  readonly now?: () => number;
}
/** 只描述旧属性访问，不宣称未知印象字段或数组中的属性已经有效。 */
interface LegacyMemberImpression {traits?: unknown; interactionCount?: unknown; lastSeenAt?: unknown;}
interface LegacyMemoryExtra {participants?: unknown; pendingQuestion?: unknown; expiresAtMs?: unknown; motivation?: unknown; target?: unknown;}
/**
 * 会话记忆的展示和追加规则；状态由所属会话持有，不创建全局记忆容器。
 * @param {object} options redactKnownTokensOnly/truncateText沿用宿主规则，save持久化所属状态，now提供毫秒时钟。
 * @returns {object} formatMemoryV2只读格式化；appendMemoryV2原地清理/追加后调用save，异常向上抛出。
 * @note 构造无IO。保留话题/想法各20条、群友印象50条及原有过期与文本处理规则。
 */
export function createConversationMemory({redactKnownTokensOnly,truncateText,save:saveSocialV2State,now=Date.now}: ConversationMemoryDependencies): ConversationMemory {
  /** 只读格式化传入会话；各类别展示最后10条，过期想法不展示，空会话返回空字符串。 */
  function formatMemoryV2(st: ConversationMemoryState | null | undefined): string {
    if (!st) return '';
    const lines = [];
    const topics = Array.isArray(st.activeTopics) ? st.activeTopics.filter((t) => t && t.text) : [];
    if (topics.length) {
      lines.push('【进行中的话题】');
      for (const t of topics.slice(-10)) {
        const ago = t.lastMentionAt ? Math.round((now() - t.lastMentionAt) / 60000) : 0;
        const stale = t.lastMentionAt && now() - Number(t.lastMentionAt) > 2 * 60 * 60 * 1000 ? '（已搁置）' : '';
        lines.push(`- ${t.text}${stale}（${ago > 0 ? ago + '分钟前' : '刚刚'}）${t.pendingQuestion ? `；待追问：${t.pendingQuestion}` : ''}`);
      }
    }
    const thoughts = Array.isArray(st.pendingThoughts) ? st.pendingThoughts.filter((t) => t && t.text && (!t.expiresAt || now() < (t.expiresAt as number))) : [];
    if (thoughts.length) {
      lines.push('【你想说但还没说的】');
      for (const t of thoughts.slice(-10)) {
        lines.push(`- ${t.text}${t.motivation ? `（${t.motivation}）` : ''}`);
      }
    }
    const impressions = st.memberImpressions && typeof st.memberImpressions === 'object' ? st.memberImpressions : {};
    const names = Object.keys(impressions);
    if (names.length) {
      lines.push('【对群友的印象】');
      for (const name of names.slice(-10)) {
        const im = (impressions[name] || {}) as LegacyMemberImpression;
        const traits = Array.isArray(im.traits) ? im.traits : [];
        lines.push(`- ${name}：${traits.length ? traits.join('、') : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次）`);
      }
    }
    return lines.join('\n');
  }

  /** 原地更新传入会话记忆并保存；不操作其它会话，非法群友名字直接拒绝。 */
  function appendMemoryV2(st: ConversationMemoryState | null | undefined, category: unknown, content: unknown, extra: ConversationMemoryExtra = {}): undefined {
    if (!st) return;
    const text = redactKnownTokensOnly(String(content ?? '')).trim();
    const cat = String(category || '').trim();
    // 轻量清理：过期想法移除；超过 24h 未提起的话题移除（避免无限膨胀）。
    if (Array.isArray(st.pendingThoughts)) {
      st.pendingThoughts = st.pendingThoughts.filter((t) => t && (!t.expiresAt || now() < Number(t.expiresAt)));
    }
    if (Array.isArray(st.activeTopics)) {
      st.activeTopics = st.activeTopics.filter((t) => t && (!t.lastMentionAt || now() - Number(t.lastMentionAt) < 24 * 60 * 60 * 1000));
    }
    if (cat === 'activeTopic' && text) {
      if (!Array.isArray(st.activeTopics)) st.activeTopics = [];
      const existing = st.activeTopics.find((t) => t && String(t.text || '') === text);
      if (existing) {
        existing.lastMentionAt = now();
        if (Array.isArray((extra as LegacyMemoryExtra).participants)) {
          const set = new Set([...(existing.participants || []), ...((extra as LegacyMemoryExtra).participants as unknown[]).map((p) => redactKnownTokensOnly(String(p)))]);
          existing.participants = [...set].slice(0, 10);
        }
        if ((extra as LegacyMemoryExtra).pendingQuestion) existing.pendingQuestion = truncateText(redactKnownTokensOnly(String((extra as LegacyMemoryExtra).pendingQuestion)), 200);
      } else {
        st.activeTopics.push({
          text: truncateText(text, 200),
          lastMentionAt: now(),
          participants: Array.isArray((extra as LegacyMemoryExtra).participants) ? ((extra as LegacyMemoryExtra).participants as unknown[]).map((p) => redactKnownTokensOnly(String(p))).slice(0, 10) : [],
          pendingQuestion: redactKnownTokensOnly(String((extra as LegacyMemoryExtra).pendingQuestion || '')).slice(0, 200)
        });
      }
      if (st.activeTopics.length > 20) st.activeTopics.splice(0, st.activeTopics.length - 20);
    } else if (cat === 'pendingThought' && text) {
      if (!Array.isArray(st.pendingThoughts)) st.pendingThoughts = [];
      const existing = st.pendingThoughts.find((t) => t && String(t.text || '') === text);
      if (existing) {
        existing.createdAt = now();
        existing.expiresAt = now() + (Number((extra as LegacyMemoryExtra).expiresAtMs) || 2 * 60 * 60 * 1000);
        if ((extra as LegacyMemoryExtra).motivation) existing.motivation = redactKnownTokensOnly(String((extra as LegacyMemoryExtra).motivation)).slice(0, 50);
      } else {
        st.pendingThoughts.push({
          text: text.slice(0, 200),
          createdAt: now(),
          expiresAt: now() + (Number((extra as LegacyMemoryExtra).expiresAtMs) || 2 * 60 * 60 * 1000),
          motivation: redactKnownTokensOnly(String((extra as LegacyMemoryExtra).motivation || 'curiosity')).slice(0, 50)
        });
      }
      if (st.pendingThoughts.length > 20) st.pendingThoughts.splice(0, st.pendingThoughts.length - 20);
    } else if (cat === 'memberImpression') {
      const target = String((extra as LegacyMemoryExtra).target || '').trim();
      if (!target || ['__proto__', 'constructor', 'prototype'].includes(target)) return;
      if (!st.memberImpressions || typeof st.memberImpressions !== 'object') st.memberImpressions = {};
      const old = (st.memberImpressions[target] || {}) as LegacyMemberImpression;
      const traits = Array.isArray(old.traits) ? old.traits.slice(0, 10) : [];
      if (text && !traits.includes(text.slice(0, 50))) traits.push(text.slice(0, 50));
      st.memberImpressions[target] = {
        traits,
        interactionCount: (Number(old.interactionCount) || 0) + 1,
        lastSeenAt: now()
      };
      const impressionEntries = Object.entries(st.memberImpressions);
      if (impressionEntries.length > 50) {
        impressionEntries.sort((a, b) => (Number((a[1] as LegacyMemberImpression | null)?.lastSeenAt) || 0) - (Number((b[1] as LegacyMemberImpression | null)?.lastSeenAt) || 0));
        for (let i = 0; i < impressionEntries.length - 50; i++) {
          delete st.memberImpressions[impressionEntries[i][0]];
        }
      }
    }
    saveSocialV2State();
  }

  return {formatMemoryV2,appendMemoryV2};
}
