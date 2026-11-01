// Generated from messaging/gap-planner.ts. Edit the TypeScript source and run build:typed.
/** 限定间隔范围，保留原数值转换规则。
 * @param {unknown} ms 输入间隔。
 * @param {SendGapConfig} sendCfg 配置。
 * @returns {number} 归一化间隔。
 * @throws {TypeError} 无法数值转换时沿用原异常。 */
export function clampGapV2(ms, sendCfg) {
    const min = Math.max(100, Number(sendCfg.burstIntervalMinMs) || 300);
    const max = Math.max(min, Number(sendCfg.maxGapMs) || 10000);
    return Math.max(min, Math.min(max, Math.round(Number(ms) || min)));
}
/**
 * 构造无IO的二代发送间隔规划器。
 *
 * @param {{randInt:(min:number,max:number)=>number,random?:()=>number}} options 随机源由宿主提供或使用当前Math.random。
 *
 * @returns {{computeGapsV2: (messages:readonly unknown[]|null|undefined,gapMode:unknown,gapMs:unknown,gaps:unknown,sendCfg:SendGapConfig)=>number[]}} 间隔数组，正常长度为消息数减一。
 *
 * @note 不发送消息、不修改配置；fixed/byLength不使用随机源，auto保留原抽样顺序。
 */
export function createGapPlanner({ randInt, random = () => Math.random() }) {
    /**
   * @param {readonly unknown[]|null|undefined} messages
   * @param {unknown} gapMode
   * @param {unknown} gapMs
   * @param {unknown} gaps
   * @param {SendGapConfig} sendCfg
   * @returns {number[]} */
    function computeGapsV2(messages, gapMode, gapMs, gaps, sendCfg) {
        /** @type {number[]} */
        const delays = [];
        if (!messages || messages.length <= 1)
            return delays;
        const mode = gapMode === 'fixed' || gapMode === 'byLength' ? gapMode : 'auto';
        if (mode === 'fixed') {
            if (Array.isArray(gaps) && gaps.length >= messages.length - 1) {
                for (let i = 0; i < messages.length - 1; i++)
                    delays.push(clampGapV2(gaps[i], sendCfg));
            }
            else {
                const g = clampGapV2(Number(gapMs) || Number(sendCfg.burstIntervalMinMs) || 1000, sendCfg);
                for (let i = 0; i < messages.length - 1; i++)
                    delays.push(g);
            }
        }
        else if (mode === 'byLength') {
            const base = Number(sendCfg.gapBaseMs) || 800;
            const perChar = Number(sendCfg.gapPerCharMs) || 20;
            for (let i = 0; i < messages.length - 1; i++) {
                const chars = Math.max(1, String(messages[i] || '').length);
                delays.push(clampGapV2(base + chars * perChar, sendCfg));
            }
        }
        else {
            const longProb = Math.min(1, Math.max(0, Number(sendCfg.longGapProbability) || 0));
            for (let i = 0; i < messages.length - 1; i++) {
                const useLong = longProb > 0 && random() < longProb;
                const min = useLong ? (Number(sendCfg.longGapMinMs) || 5000) : (Number(sendCfg.burstIntervalMinMs) || 1000);
                const max = useLong ? (Number(sendCfg.longGapMaxMs) || 10000) : (Number(sendCfg.burstIntervalMaxMs) || 3000);
                delays.push(clampGapV2(randInt(Math.max(100, min), Math.max(100, max)), sendCfg));
            }
        }
        return delays;
    }
    return Object.freeze({ computeGapsV2 });
}
