// Generated from sessions/retirement.ts. Edit the TypeScript source and run build:typed.
/**
 * 集中会话退役及缓存清理；状态借自所属桥接，停止/归档仍沿用原异步边界。
 * @param {object} deps 实时依赖视图；getter避免模式、代次、配置在异步期间变成旧快照。
 * @returns {object|function} 所属实例的操作；错误语义与原调用方保持一致。
 * @note 不启动服务、不安装依赖。
 */
export function createSessionRetirement(deps) {
    /**
       * 让 DSH 停下一个已经不再属于桥接的会话：先清队列再取消在途 turn，最后归档。
       * 拆出来是因为所有「撤销映射」的路径都必须做同样的事（retireSession / session-reset /
       * workspace-reset / reset，以及控制台的二代状态重置）—— 少一处就会留下
       * 「DSH 还在烧 token、桥接已经收不到也发不出」的静默黑洞。
       */
    function stopRetiredSessionWork(sessionId, key = '') {
        void (async () => {
            try {
                await (0, deps.withTimeout)((0, deps.stopBridgeSessionWork)(sessionId, 'retire'), deps.DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork');
            }
            catch (error) {
                (0, deps.log)(`⚠️ 停止旧会话失败 ${key}：${error?.message ?? error}；本地映射已撤销，请在 DSH 检查旧任务`);
            }
            try {
                await (0, deps.withTimeout)(deps.api.workspace.archiveSession({ sessionId }), deps.DSH_CONTROL_TIMEOUT_MS, 'archiveSession');
            }
            catch (error) {
                (0, deps.log)(`归档失效会话失败 ${key}: ${error?.message ?? error}`);
            }
        })();
    }
    /**
       * 清掉「按会话 key 记账」的内存态。
       *
       * 为什么单独抽出来：这些 Map/Set 分散在文件各处，退役路径（retireSession）、
       * 手动重置（/api/session/reset、/reset、workspace reset）、二代状态重置
       * 各自只清了其中一部分 —— 于是「哪个 key 清哪个不清」完全靠人记。
       * 结果是有界但真实的慢性泄漏：被移出白名单的会话，其 lastSendFailed、
       * 限流时间戳会一直留在内存里。所有撤销会话映射的路径都必须调用这里。
       */
    function forgetConversationCaches(key) {
        deps.lastSendFailed.delete(key);
        deps.activeWaits.delete(key);
        deps.offlineQueue.clearHint(key);
        deps.slangSubmitTimes.delete(key);
        deps.feedbackTimes.delete(key);
        deps.wakeConfigMissCount.delete(key);
        deps.wakeConfigUpdatedKeys.delete(key);
        deps.markReadCalledKeys.delete(key);
    }
    function retireSession(key) {
        const sessionId = deps.state.sessions[key];
        delete deps.state.sessions[key];
        delete deps.state.sessionPolicies[key];
        // 按 key 记账的内存态在**有映射和无映射时都要清**：一条被移出白名单、
        // 但从未成功建过会话的 key 同样会留下限流时间戳与失败标记。
        forgetConversationCaches(key);
        if (!sessionId)
            return;
        deps.reverse.delete(sessionId);
        deps.collectors.delete(sessionId);
        deps.usageObserver.forget(sessionId);
        deps.sessionModelManager.forget(sessionId);
        deps.sendToolSucceededSessions.delete(sessionId);
        deps.pendingSendToolCalls.delete(sessionId);
        deps.v2TurnStartAt.delete(sessionId);
        deps.turnLeaseNoted.delete(sessionId);
        deps.toolCallNames.delete(sessionId);
        deps.social.silentTurns.delete(sessionId);
        deps.social.exitingSessions.delete(sessionId);
        // 退役的会话要退订：否则 _desiredFollows 只增不减，每次重连都会为它重开一条
        // follow 流并重发一整份历史快照（内存与重连延迟都随会话数线性增长）。
        deps.api.events.forget?.(sessionId);
        const entry = deps.pending.get(key);
        if (entry) {
            (0, deps.clearTimeout)(entry.timer);
            void (0, deps.cancelPendingEntry)(entry).catch(() => { });
        }
        deps.pending.delete(key);
        (0, deps.clearSocialV2Timers)(key);
        (0, deps.cancelSocialTimers)(key);
        (0, deps.disarmPendingWakeLease)(key);
        deps.pendingWakeKeys.delete(key);
        const st = deps.socialV2.conversations.get(key);
        if (st) {
            // 保留旧 token 在脱敏集合中，但撤销它的调用权限。
            st.agentToken = deps.crypto.randomBytes(24).toString('hex');
            (0, deps.rememberAgentToken)(key, st.agentToken);
            st.bootstrapSent = false;
            st.modelSeenSeqs = new Set();
        }
        (0, deps.saveState)();
        (0, deps.saveSocialV2State)();
        stopRetiredSessionWork(sessionId, key);
        (0, deps.log)(`会话权限已变化，停用旧映射 ${key} -> ${sessionId}`);
    }
    return { stopRetiredSessionWork, forgetConversationCaches, retireSession };
}
