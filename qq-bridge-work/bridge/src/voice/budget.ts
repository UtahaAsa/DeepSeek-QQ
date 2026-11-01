import type {NormalizedVoiceSettings} from './library.js';
/**
 * 私有持有每会话的语音发送时间账本。
 * @param deps 毫秒时钟；构造无IO，不预占额度。
 * @returns 检查与成功提交记账接口；失败发送不记账，超过一小时的记录在提交时裁剪。
 */
export function createVoiceBudget(deps:{readonly Date:Pick<DateConstructor,'now'>}) {
const voiceSendTimes = new Map<string,number[]>();
function voiceBudgetCheck(scopeKey:string, cfgV:Pick<NormalizedVoiceSettings,'maxPerMinute'|'maxPerHour'>) {
    const now = deps.Date.now();
    const bucket = voiceSendTimes.get(scopeKey) ?? [];
    const inMinute = bucket.filter((t) => now - t < 60000);
    const inHour = bucket.filter((t) => now - t < 3600000);
    if (cfgV.maxPerMinute > 0 && inMinute.length + 1 > cfgV.maxPerMinute) {
      throw new Error(`语音发送频率超限（每分钟最多 ${cfgV.maxPerMinute} 条），请稍后再试`);
    }
    if (cfgV.maxPerHour > 0 && inHour.length + 1 > cfgV.maxPerHour) {
      throw new Error(`语音发送频率超限（每小时最多 ${cfgV.maxPerHour} 条），请稍后再试`);
    }
  }

function voiceBudgetCommit(scopeKey:string, at = deps.Date.now()) {
    const bucket = (voiceSendTimes.get(scopeKey) ?? []).filter((t) => at - t < 3600000);
    bucket.push(at);
    voiceSendTimes.set(scopeKey, bucket);
  }
return {voiceBudgetCheck,voiceBudgetCommit};
}
