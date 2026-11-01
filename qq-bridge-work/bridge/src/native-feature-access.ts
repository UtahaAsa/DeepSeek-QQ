/// <reference types="node" />
/** 宿主快照字段保持未知，授权判断只在current/capture既有条件中发生。 */
export interface NativeFeatureSnapshot {mode?:unknown;native?:unknown;ready?:unknown;policyCurrent?:unknown;targetAllowed?:unknown;sessionCurrent?:unknown;
 paused?:unknown;silent?:unknown;sessionId?:unknown;generation?:unknown;open?:unknown;turn?:unknown;actorKey?:unknown;fingerprint?:unknown;featureToken?:unknown;agentToken?:unknown;}
export interface NativeFeatureOptions {readonly snapshot:(key:unknown)=>NativeFeatureSnapshot|null|undefined;}
import { createHash } from 'node:crypto';

const modes = new Set(['chat', 'reserved', 'reserved2', 'closed-agent']);
const validKey = (key:unknown) => /^(?:group|private):[1-9]\d{0,19}$/.test((key ?? '') as string);
const denied = () => new Error('NATIVE_FEATURE_NOT_AUTHORIZED');

/**
 * 为所有QQ模式提供相同的功能调用身份校验；功能勾选与原生对象权限仍由各功能检查。
 * @param {object} options snapshot(key)返回本次目标对应的当前模型会话、模式、权限代次和轮次对象。
 * @returns {object} context/capture；不读取文件、不发送消息、不发放功能许可。
 * @throws {Error} 缺失快照函数时固定错误。
 * @note 同步、单事件循环；快照中的令牌只参与内存比较和摘要，不出现在返回值或错误里。
 */
export function createNativeFeatureAccess({ snapshot }:NativeFeatureOptions = {} as NativeFeatureOptions) {
  if (typeof snapshot !== 'function') throw denied();
  function current(key:unknown, issuing = false) {
    if (!validKey(key)) return null;
    const value = snapshot(key);
    if (!validKey(key) || !value || !modes.has(value.mode as string) || value.native !== true || value.ready !== true
      || value.policyCurrent !== true || value.targetAllowed !== true || value.sessionCurrent !== true
      || value.paused || value.silent || typeof value.sessionId !== 'string' || !value.sessionId
      || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
      || !issuing && (value.open !== true || !value.turn)) return null;
    return value;
  }
  function stamp(key:unknown, value:NativeFeatureSnapshot) {
    return createHash('sha256').update(JSON.stringify([key, value.mode, value.generation, value.sessionId,
      value.actorKey, value.fingerprint, value.featureToken, value.mode === 'reserved2' ? value.agentToken : null])).digest('hex');
  }
  return Object.freeze({
    /** @param {string} key 已授权功能目标。@param {boolean} issuing 仅投递提示前同步签发资格时为true。@returns {string|null} 不含原始身份的内存代次摘要。 */
    context(key:unknown, issuing = false) { const value = current(key, issuing); return value ? stamp(key, value) : null; },
    /**
     * 捕获调用身份；异步步骤及实际提交前须调用返回的守卫。
     * @param {string} key 当前目标。@param {string|undefined} token 当前功能会话令牌，二代也兼容其调度令牌。
     * @param {object} options qualified仅用于已另有严格功能资格令牌的写接口，不替代其资格检查。
     * @returns {Function} 复核模式、会话、轮次对象、角色和权限代次；失效时抛固定错误。
     */
    capture(key:unknown, token?:unknown, { qualified = false } = {}) {
      const before = current(key);
      const valid = before && typeof token === 'string' && token.length > 0
        && (token === before.featureToken || before.mode === 'reserved2' && token === before.agentToken);
      if (!before || !qualified && !valid || token !== undefined && !valid) throw denied();
      const fingerprint = stamp(key, before);
      return ():undefined => {
        const after = current(key);
        if (!after || after.turn !== before.turn || stamp(key, after) !== fingerprint) throw denied();
      };
    },
  });
}
