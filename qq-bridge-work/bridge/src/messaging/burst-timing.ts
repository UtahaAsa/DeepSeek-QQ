export interface BurstTiming { min: number; max: number; longProb: number; longMin: number; longMax: number; }

/**
 * 归一化旧式分条的间隔配置，保留原数值转换、默认值与长间隔概率规则。
 * @param {unknown} socialCfgOrMin 配置对象或最小间隔。
 * @param {unknown} maybeMax 数值模式下的最大间隔。
 * @returns {{min:number,max:number,longProb:number,longMin:number,longMax:number}} 间隔与概率。
 * @throws {TypeError} 输入无法转为数字时沿用原转换异常。
 * @note 同步纯函数；不产生随机数、不等待、不修改输入对象。
 */
export function normalizeBurstTiming(socialCfgOrMin: unknown, maybeMax: unknown): BurstTiming {
  let min, max, longProb = 0, longMin = 0, longMax = 0;
  if (typeof socialCfgOrMin === 'object' && socialCfgOrMin !== null) {
    const cfg = socialCfgOrMin as Record<string, unknown>;
    min = Math.max(0, Number(cfg.burstIntervalMinMs) || 1000);
    max = Math.max(min, Number(cfg.burstIntervalMaxMs) || min);
    longProb = Math.min(1, Math.max(0, Number(cfg.longGapProbability) || 0));
    longMin = Math.max(0, Number(cfg.longGapMinMs) || 8000);
    longMax = Math.max(longMin, Number(cfg.longGapMaxMs) || longMin);
  } else {
    min = Math.max(0, Number(socialCfgOrMin) || 0);
    max = Math.max(min, Number(maybeMax) || min);
  }
  return {min,max,longProb,longMin,longMax};
}
