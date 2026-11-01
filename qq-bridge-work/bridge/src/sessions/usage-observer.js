// Generated from sessions/usage-observer.ts. Edit the TypeScript source and run build:typed.
/**
 * 接入会话模型选择、用量事件及快照，实际计费和幂等折叠仍由账本负责。
 * @param {object} options tokenLedger为既有账本；nominalModel/fallbackProvider读取当前配置；rebuildInFlightCollector只恢复未结束回合。
 * @returns {object} recordSessionUsage/recordSessionSnapshot与forget；forget只清理模型提示，不删除账本记录。
 * @note 构造无IO；摄入错误记录后返回，不阻断QQ主链路；不发送消息、不自行累加用量。
 */
export function createUsageObserver({ tokenLedger, nominalModel, fallbackProvider, rebuildInFlightCollector, log, now = Date.now }) {
    /** sessionId -> 最近一次已知的实际模型。切换模型会让单价差好几倍，所以按会话记。 */
    const sessionModels = new Map();
    function rememberModel(sessionId, selection) {
        const model = selection?.model;
        if (typeof model === 'string' && model) {
            sessionModels.set(sessionId, { model, provider: selection?.provider });
        }
    }
    /** 摄入一条会话事件到 token 账本；任何异常都不能影响 QQ 主链路。 */
    function recordSessionUsage(sessionId, event) {
        try {
            if (event?.type === 'model/selection')
                rememberModel(sessionId, event.data);
            const known = sessionModels.get(sessionId);
            tokenLedger.ingestEvent({
                sessionId,
                event,
                model: event?.data?.usage?.model ?? known?.model,
                provider: event?.data?.provider ?? known?.provider
            });
        }
        catch (error) {
            log('token 账本：摄入事件失败', error?.message ?? error);
        }
    }
    /**
     * 处理会话开场快照：
     * 1. `projections.tokenUsage` 是**整条会话日志**的权威累计桶（含桥接启动前的历史）；
     * 2. `records` 是最近若干条历史事件，用来回填「逐轮花费」。
     * 重连时该帧会重新下发，账本内部按 (turn, step, retry) + seq 做幂等折叠，不会翻倍。
     */
    function recordSessionSnapshot(sessionId, snapshot) {
        try {
            if (!snapshot)
                return;
            const selection = snapshot.projections?.values?.modelSelection;
            rememberModel(sessionId, selection?.lastUsed ?? selection?.pending ?? null);
            const known = sessionModels.get(sessionId);
            tokenLedger.ingestBaseline({
                sessionId,
                projection: snapshot.projections,
                at: now(),
                model: known?.model ?? nominalModel(),
                provider: known?.provider ?? fallbackProvider()
            });
            tokenLedger.ingestSnapshotRecords({ sessionId, records: snapshot.records });
            rebuildInFlightCollector(sessionId, snapshot.records);
        }
        catch (error) {
            log('token 账本：处理会话快照失败', error?.message ?? error);
        }
    }
    return Object.freeze({ recordSessionUsage, recordSessionSnapshot, forget: (sessionId) => sessionModels.delete(sessionId) });
}
