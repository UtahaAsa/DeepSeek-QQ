/// <reference types="node" />
import type {HistoryReplyInfo} from '../console/routes/history.js';
import type {MessageSegment,SegmentTextOptions} from './segments.js';
interface ReplyError {message?:unknown;}
interface RawReply {group_id?:unknown;groupId?:unknown;user_id?:unknown;userId?:unknown;message?:string|MessageSegment[];sender?:{card?:unknown;nickname?:unknown;user_id?:unknown};}
export interface RecentReply {seq?:unknown;messageId?:unknown;sender?:unknown;text?:unknown;plain?:unknown;}
export interface ReplyHistory {recentMessages?:RecentReply[];}
export interface ReplyContextDependencies {
 readonly Date:DateConstructor;readonly log:(...values:unknown[])=>void;readonly nativeBinding:unknown;
 readonly bot:{getMessage:(messageId:number)=>Promise<unknown>};
 readonly segmentsToText:(segments:string|MessageSegment[],options:SegmentTextOptions)=>Promise<string>;
 readonly resolveGroupMemberName:(groupId:unknown,userId:unknown)=>Promise<unknown>;
}
/**
 * 管理引用解析缓存与回复目标映射，构造无IO。
 * @param deps 所属网关、文本/成员解析和原生通道标记。
 * @returns 通过原有归属检查的截断摘要；失败短缓存，未知归属不返回正文。
 * @note 原生通道只认当前消息ID，不回退本地seq/历史正文；旧通道兼容行为保持。
 */
export function createReplyContext(deps:ReplyContextDependencies) {
const replyInfoCache = new Map<string,{info:HistoryReplyInfo|null;ts:number}>();
const REPLY_INFO_TTL_MS = 10 * 60 * 1000;
const REPLY_NEGATIVE_TTL_MS = 5 * 1000;
// 失败/归属缺失只短缓存，避免一次瞬时抖动导致长时间解析失败
  function pruneReplyInfoCache() {
    if (replyInfoCache.size <= 1000) return;
    const now = deps.Date.now();
    for (const [k, v] of replyInfoCache) {
      if (now - v.ts > REPLY_INFO_TTL_MS) replyInfoCache.delete(k);
    }
    if (replyInfoCache.size > 1000) {
      const oldestKey = replyInfoCache.keys().next().value;
      if (oldestKey !== undefined) replyInfoCache.delete(oldestKey);
    }
  }

async function resolveReplyInfo(kind:string, convId:unknown, messageId:unknown, selfId:unknown = null):Promise<HistoryReplyInfo|null> {
    pruneReplyInfoCache();
    const cacheKey = `${kind}:${String(convId)}:${String(messageId)}`;
    const hit = replyInfoCache.get(cacheKey);
    if (hit && deps.Date.now() - hit.ts < (hit.info ? REPLY_INFO_TTL_MS : REPLY_NEGATIVE_TTL_MS)) return hit.info;
    try {
      const numericId = Number(messageId);
      if (!Number.isSafeInteger(numericId)) {
        (0, deps.log)(`引用消息 id 超出安全整数范围，拒绝解析: ${messageId}`);
        replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
        return null;
      }
      const raw = await deps.bot.getMessage(numericId) as RawReply|null;
      if (!raw) {
        replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
        return null;
      }
      // 消息归属校验：防止跨会话读取其他群/私聊消息。
      // 若网关返回的 raw 对象连归属字段都缺失，则视为无法确认归属，拒绝返回内容。
      if (kind === 'group') {
        const rawGroup = raw.group_id ?? raw.groupId;
        if (rawGroup == null) {
          replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
          return null;
        }
        if (String(rawGroup) !== String(convId)) {
          replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
          return null;
        }
      } else {
        const rawUser = raw.user_id ?? raw.userId ?? raw.sender?.user_id;
        const rawGroup = raw.group_id ?? raw.groupId;
        // 私聊消息必须同时满足：没有群归属，且发送者匹配。防止用群消息 id 跨会话读取。
        if (rawGroup != null) {
          replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
          return null;
        }
        if (rawUser == null) {
          replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
          return null;
        }
        if (String(rawUser) !== String(convId) && !(selfId != null && String(rawUser) === String(selfId))) {
          replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
          return null;
        }
      }
      const sender = raw.sender?.card || raw.sender?.nickname || String(raw.sender?.user_id ?? raw.user_id ?? '未知');
      const text = await (0, deps.segmentsToText)(raw.message ?? [], {
        resolveAtName: kind === 'group' ? (qq) => (0, deps.resolveGroupMemberName)(convId, qq) : null,
        includeReply: false
      });
      const senderUserId = raw.sender?.user_id ?? raw.user_id ?? null;
      const info = {
        sender: String(sender ?? ''),
        text: String(text ?? '').slice(0, 200),
        userId: senderUserId != null ? String(senderUserId) : null
      };
      replyInfoCache.set(cacheKey, { info, ts: deps.Date.now() });
      return info;
    } catch (error) {
      (0, deps.log)('解析引用消息失败:', (error as ReplyError|null)?.message ?? error);
      replyInfoCache.set(cacheKey, { info: null, ts: deps.Date.now() });
      return null;
    }
  }

// 发送引用时解析目标：支持真实 QQ message_id，也支持 recentMessages 里的 seq（自动映射到真实 messageId）。
  async function resolveReplyTargetV2(st:ReplyHistory|null|undefined, kind:string, convId:unknown, ref:unknown):Promise<{info:HistoryReplyInfo;messageId:string}|null> {
    const refStr = String(ref ?? '').trim();
    if (!refStr) return null;
    if (deps.nativeBinding) {
      // 原生message_id与历史本地seq均为小整数，必须严格使用当前网关真实消息ID。
      // 不把旧seq优先映射成另一条消息，也不在网关缓存失效时用历史正文冒充解析成功。
      const info = await resolveReplyInfo(kind, convId, refStr);
      return info ? { info, messageId: refStr } : null;
    }
    const found = Array.isArray(st?.recentMessages) ? st.recentMessages.find((m) => m && String(m.seq) === refStr) : null;
    // 若 ref 命中本地 seq，且本地存有真实 messageId，优先按 seq 映射，避免与真实 id 冲突。
    if (found && found.messageId && String(found.messageId) !== refStr) {
      const realId = String(found.messageId);
      const realInfo = await resolveReplyInfo(kind, convId, realId);
      return {
        info: realInfo || {
          sender: String(found.sender || ''),
          text: String(found.text || found.plain || '').slice(0, 200),
          userId: null,
          messageId: realId,
          seq: found.seq
        },
        messageId: realId
      };
    }
    let info = await resolveReplyInfo(kind, convId, refStr);
    if (info) return { info, messageId: refStr };
    if (found && found.messageId) {
      const realId = String(found.messageId);
      const realInfo = await resolveReplyInfo(kind, convId, realId);
      return {
        info: realInfo || {
          sender: String(found.sender || ''),
          text: String(found.text || found.plain || '').slice(0, 200),
          userId: null,
          messageId: realId,
          seq: found.seq
        },
        messageId: realId
      };
    }
    return null;
  }

// 判断当前消息是否“引用/回复了机器人自己”：若是，则桥接层也把它当作直接对 AI 说。
  async function isQuoteTargetSelf(message:unknown, kind:string, id:unknown, selfId:unknown):Promise<boolean> {
    if (!Array.isArray(message) || selfId == null) return false;
    for (const seg of message as MessageSegment[]) {
      if (seg?.type === 'reply' && seg.data?.id != null) {
        const info = await resolveReplyInfo(kind, id, String(seg.data.id), selfId);
        if (info?.userId && String(info.userId) === String(selfId)) return true;
      }
    }
    return false;
  }
return {pruneReplyInfoCache,resolveReplyInfo,resolveReplyTargetV2,isQuoteTargetSelf};
}
