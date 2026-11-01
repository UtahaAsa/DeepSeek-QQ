// Generated from sessions/turn-replay.ts. Edit the TypeScript source and run build:typed.
/**
 * 提取快照内事件，接受原始事件或type=event包装，保持原对象用于collector。
 * @param {unknown} entry 快照条目。
 * @returns {ReplayEvent|null} 可读取的事件对象。
 */
function eventOf(entry) {
    if (!entry || typeof entry !== 'object')
        return null;
    const value = 'type' in entry && entry.type === 'event' ? ('event' in entry ? entry.event : null) : entry;
    return value && typeof value === 'object' ? value : null;
}
/**
 * 规划未结束回合的历史文本恢复，保留记录顺序，不生成回复或计费用量。
 * @param {unknown} records 原始快照记录。
 * @returns {{open:unknown[],events:ReplayEvent[]}} 未结束回合与其start/message事件。
 * @note 同步纯函数；已结束回合、无关事件和不属于未结束回合的消息不参与恢复。
 */
export function planTurnReplay(records) {
    /** @type {Set<unknown>} */
    const open = new Set();
    /** @type {ReplayEvent[]} */
    const events = [];
    if (!Array.isArray(records) || !records.length)
        return { open: [], events };
    for (const entry of records) {
        const event = eventOf(entry);
        if (event?.type === 'turn/start')
            open.add(event.data?.turn);
        else if (event?.type === 'turn/end')
            open.delete(event.data?.turn);
    }
    if (!open.size)
        return { open: [], events };
    for (const entry of records) {
        const event = eventOf(entry);
        if ((event?.type === 'turn/start' || event?.type === 'assistant/message') && open.has(event.data?.turn))
            events.push(event);
    }
    return { open: [...open], events };
}
/**
 * 将恢复规划交给所属collector，并沿用原生回合校验与起始时间维护。
 * @param {{canRestore:(sessionId:string)=>boolean,accept:(sessionId:string,event:ReplayEvent)=>boolean,onStart:(sessionId:string,event:ReplayEvent)=>void,createCollector:()=>{push:(event:ReplayEvent)=>unknown},installCollector:(sessionId:string,collector:{push:(event:ReplayEvent)=>unknown})=>void,ensureStartTime:(sessionId:string)=>void,log:(message:string)=>void}} options 所属会话能力；构造无副作用。
 * @returns {(sessionId:string,records:unknown)=>void} 恢复函数。
 * @throws {Error} collector或状态维护失败向调用方传播，由快照接入层记录。
 * @note 不创建发送任务；没有有效恢复事件时，不安装collector或设置起始时间。
 */
export function createSnapshotRecovery({ canRestore, accept, onStart, createCollector, installCollector, ensureStartTime, log }) {
    return (sessionId, records) => {
        if (!Array.isArray(records) || !records.length || !canRestore(sessionId))
            return;
        const plan = planTurnReplay(records);
        if (!plan.open.length)
            return;
        const collector = createCollector();
        let restored = 0;
        for (const event of plan.events) {
            if (!accept(sessionId, event))
                continue;
            if (event.type === 'turn/start')
                onStart(sessionId, event);
            collector.push(event);
            restored++;
        }
        if (!restored)
            return;
        installCollector(sessionId, collector);
        ensureStartTime(sessionId);
        log(`重连后恢复了进行中的回合（${sessionId}，turn ${plan.open.join(',')}）`);
    };
}
