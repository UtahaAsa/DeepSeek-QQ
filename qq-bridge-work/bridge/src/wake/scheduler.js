// Generated from wake/scheduler.ts. Edit the TypeScript source and run build:typed.
/**
 * 集中合批、有限睡眠、回复检查和主动机会调度；清理入口覆盖本实例定时器。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createWakeScheduler(deps) {
    function cancelReplyCheckV2(key) {
        const st = deps.socialV2.conversations.get(key);
        if (!st || !st.replyCheckTimer)
            return;
        deps.wakeTimers.cancel(key, 'replyCheckTimer');
        st.replyCheckTimer = null;
    }
    function scheduleReplyCheckV2(key) {
        if (deps.cfg.socialV2?.enabled === false)
            return;
        if (deps.socialV2.paused || deps.currentMode !== 'reserved2')
            return;
        const st = (0, deps.getSocialV2State)(key);
        // 已有真实唤醒/有限睡眠/回复检查在排队时不再重复安排，避免 AI 被连环唤醒。
        if (st.pendingWakeTimer || st.sleepTimer || st.replyCheckTimer)
            return;
        let delay = deps.Math.max(1000, Number(deps.cfg.socialV2?.autoReplyCheckMs) || 30000);
        const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
        const recentSelf = recent.filter((m) => m && m.isSelf && deps.Date.now() - Number(m.time || 0) < 15000);
        const askedQuestion = recentSelf.some((m) => /[?？吗呢怎么有没有能不能]/.test(String(m.text || m.plain || '')));
        if (askedQuestion)
            delay = deps.Math.round(delay * 1.5);
        if (recentSelf.length >= 3)
            delay = deps.Math.round(delay * 1.3);
        st.replyCheckTimer = deps.wakeTimers.schedule(key, st, 'replyCheckTimer', () => {
            st.replyCheckTimer = null;
            void (0, deps.sendWakePromptV2)(key, 'replyCheck').catch((error) => (0, deps.log)(`[reserved2] replyCheck 唤醒异常 ${key}:`, error?.message ?? error));
        }, delay);
        st.replyCheckTimer.unref?.();
        (0, deps.log)(`[reserved2] 已安排回复检查唤醒 ${key}，${deps.Math.round(delay / 1000)}s 后检查`);
    }
    /** 会话此刻算忙的具体原因（只用于日志，避免排查时只能反复重启加猜）。 */
    function busyReasonV2(key, st) {
        if (st?.pendingWakeTimer)
            return 'pendingWakeTimer';
        if (deps.pendingWakeKeys.has(key))
            return 'pendingWakeKey';
        const q = deps.promptQueue.status(key);
        if (q?.running)
            return 'promptRunning';
        if (q && q.pending > 0)
            return 'promptQueued';
        const sid = deps.state.sessions[key];
        if (sid) {
            const startedAt = Number(deps.v2TurnStartAt.get(sid));
            if (Number.isFinite(startedAt) && startedAt > 0 && deps.Date.now() - startedAt < deps.TURN_BUSY_LEASE_MS)
                return 'turn';
        }
        return 'unknown';
    }
    function isConversationBusyV2(key, st) {
        if (st && st.pendingWakeTimer)
            return true;
        if (deps.pendingWakeKeys.has(key))
            return true;
        const q = deps.promptQueue.status(key);
        if (q && (q.running || q.pending > 0))
            return true;
        const sid = deps.state.sessions[key];
        if (!sid)
            return false;
        // 回合只按「起始时间 + 租约」判忙，**不再**只看 Map 里有没有键：
        //   · 有 collector 但没起始时间（杂散事件重建出来的）→ 无法证明还活着，不判忙；
        //   · 起始时间超过租约（turn/end 丢了 / DSH 重启把回合丢了）→ 不判忙；
        // collector 保留，所以万一回合其实还活着，它的回复仍会被 flush，只是允许新唤醒排队。
        const startedAt = Number(deps.v2TurnStartAt.get(sid));
        const hasTurn = Number.isFinite(startedAt) && startedAt > 0;
        const collector = deps.collectors.has(sid);
        if (!hasTurn)
            return false;
        if (deps.Date.now() - startedAt < deps.TURN_BUSY_LEASE_MS)
            return true;
        if (collector && !deps.turnLeaseNoted.has(sid)) {
            deps.turnLeaseNoted.add(sid);
            (0, deps.log)(`[reserved2] 回合判忙租约已过期（${sid}，起始 ${deps.Math.round((deps.Date.now() - startedAt) / 60000)} 分钟前），解除忙碌；collector 保留，迟到回复仍会 flush`);
        }
        return false;
    }
    function scheduleWakeV2(key, reason) {
        if (deps.cfg.socialV2?.enabled === false)
            return;
        if (deps.socialV2.paused)
            return;
        if (!(0, deps.isSessionAllowedInCurrentMode)(key)) {
            (0, deps.log)(`[reserved2] 跳过计划唤醒 ${key}（${reason}）：会话已不在当前模式允许范围内`);
            return;
        }
        const st = (0, deps.getSocialV2State)(key);
        if (st.pendingWakeTimer) {
            // 合并窗口内已有待发送唤醒：按优先级升级最终原因，避免先概率后 @ 却仍按概率唤醒。
            const cur = st.pendingWakeReason || reason;
            if ((0, deps.wakePriorityV2)(reason) > (0, deps.wakePriorityV2)(cur)) {
                st.pendingWakeReason = reason;
                (0, deps.log)(`[reserved2] 合并窗口内升级唤醒原因 ${key}: ${cur} -> ${reason}`);
            }
            return;
        }
        if (isConversationBusyV2(key, st)) {
            if (!Array.isArray(st.pendingWakeReasons))
                st.pendingWakeReasons = [];
            const seq = st.lastUnreadSeq || 0;
            if (!st.pendingWakeReasons.some((r) => r && r.reason === reason && r.seq === seq)) {
                st.pendingWakeReasons.push({ reason, seq });
                // 有界队列：最多保留 20 条，防止消息洪峰下无限增长。
                if (st.pendingWakeReasons.length > 20)
                    st.pendingWakeReasons.splice(0, st.pendingWakeReasons.length - 20);
            }
            (0, deps.log)(`[reserved2] 会话繁忙，暂存唤醒原因 ${key}（${reason}@seq${seq}，原因=${busyReasonV2(key, st)}）`);
            return;
        }
        cancelReplyCheckV2(key); // 真实唤醒已接管，取消普通回复检查，避免 30s 后再补一刀
        if (st.sleepTimer) {
            deps.wakeTimers.cancel(key, 'sleepTimer');
            st.sleepTimer = null;
        }
        st.pendingWakeReason = reason;
        const globalBatchMs = deps.Math.max(1000, Number(deps.cfg.socialV2?.wake?.batchWindowMs) || 2000);
        const batchMs = deps.Math.min(globalBatchMs, deps.Math.max(1000, Number(st.wakeConfig?.batchWindowMs) || globalBatchMs));
        st.pendingWakeTimer = deps.wakeTimers.schedule(key, st, 'pendingWakeTimer', () => {
            st.pendingWakeTimer = null;
            const finalReason = st.pendingWakeReason || reason;
            st.pendingWakeReason = null;
            void (0, deps.sendWakePromptV2)(key, finalReason).catch((error) => (0, deps.log)(`[reserved2] 计划唤醒异常 ${key}:`, error?.message ?? error));
        }, batchMs);
        // 与其它 per-conversation 定时器保持一致：别让一个待唤醒定时器把进程钉住不退出。
        st.pendingWakeTimer.unref?.();
        (0, deps.log)(`[reserved2] 计划唤醒 ${key}（${reason}），${deps.Math.round(batchMs / 1000)}s 后发送`);
    }
    /**
       * 回合结束后补发「繁忙期间暂存」的唤醒原因。
       *
       * 两类原因必须分开处理：
       *   · 消息类（@/关键词/提问/私聊/拍一拍…）只有在那条消息还没被本回合处理掉时才补发
       *     （unread 里还能找到它的 seq）；
       *   · 定时器类（timeout/replyCheck/proactiveCheck/bootstrap/admin）与未读水位无关：
       *     那一轮很可能已经把未读全部标读，用 unread 判断会让「到点唤醒」被静默吞掉 ——
       *     timeout 时 sleepTimer 已被清空，结果是会话停在「sleepUntil 已过期、无任何定时器」。
       */
    function replayPendingWakeReasonsV2(key) {
        const st = (0, deps.getSocialV2State)(key);
        if (!Array.isArray(st.pendingWakeReasons) || !st.pendingWakeReasons.length)
            return null;
        const item = st.pendingWakeReasons.shift();
        if (!item || typeof item !== 'object')
            return null;
        if ((0, deps.isTimerWakeReason)(item.reason)) {
            if (item.reason === 'timeout') {
                (0, deps.log)(`[reserved2] ${key} 补收繁忙期间到期的潜水定时器`);
                setupSleepTimerV2(key);
            }
            else if (item.reason === 'replyCheck') {
                (0, deps.log)(`[reserved2] ${key} 补排繁忙期间的回复检查`);
                scheduleReplyCheckV2(key);
            }
            else if (item.reason === 'proactiveCheck') {
                // 主动机会有周期性重排，错过一次可接受（也不该在回合结束时立刻补一刀）。
                (0, deps.log)(`[reserved2] ${key} 繁忙期间的主动机会已过期，跳过补发`);
            }
            else {
                (0, deps.log)(`[reserved2] ${key} 补发繁忙期间积压的唤醒：${item.reason}`);
                scheduleWakeV2(key, item.reason);
            }
            return { reason: item.reason, action: 'timer' };
        }
        const stillRelevant = Array.isArray(st.unread) && st.unread.some((m) => m && Number(m.seq) >= Number(item.seq));
        if (stillRelevant) {
            (0, deps.log)(`[reserved2] ${key} 补发繁忙期间积压的唤醒：${item.reason}@seq${item.seq}`);
            scheduleWakeV2(key, item.reason);
            return { reason: item.reason, action: 'replayed' };
        }
        (0, deps.log)(`[reserved2] ${key} 繁忙期间唤醒 ${item.reason}@seq${item.seq} 已被当前回合处理，跳过补发`);
        return { reason: item.reason, action: 'skipped' };
    }
    function setupSleepTimerV2(key) {
        if (deps.cfg.socialV2?.enabled === false)
            return;
        if (!(0, deps.isSessionAllowedInCurrentMode)(key))
            return;
        const st = (0, deps.getSocialV2State)(key);
        cancelReplyCheckV2(key); // 有限睡眠配置已接管，取消回复检查
        if (st.sleepTimer) {
            deps.wakeTimers.cancel(key, 'sleepTimer');
            st.sleepTimer = null;
        }
        if (deps.socialV2.paused)
            return;
        const wc = st.wakeConfig;
        if (!wc || wc.infinite || !wc.sleepUntil)
            return;
        const until = deps.Date.parse(wc.sleepUntil);
        if (!Number.isFinite(until))
            return;
        const delay = until - deps.Date.now();
        if (delay <= 0) {
            void (0, deps.sendWakePromptV2)(key, 'timeout').catch((error) => (0, deps.log)(`[reserved2] 睡眠到期唤醒异常 ${key}:`, error?.message ?? error));
            return;
        }
        // Node setTimeout 超过 2^31-1ms 会按 1ms 触发；远未来定时器先等一小段后重新续期，
        // 而不是提前唤醒。这里刻意用 100 秒级的小步长（而不是 24 天的上限）：
        // 每次续期都会用 Date.now() 重新算剩余时间，系统时钟被校正/跳变时能很快纠正过来。
        const MAX_TIMEOUT_MS = 100009;
        if (delay > MAX_TIMEOUT_MS) {
            st.sleepTimer = deps.wakeTimers.schedule(key, st, 'sleepTimer', () => {
                st.sleepTimer = null;
                setupSleepTimerV2(key);
            }, MAX_TIMEOUT_MS);
            st.sleepTimer.unref?.();
            (0, deps.log)(`[reserved2] 设置远未来有限潜水定时器 ${key}，首段 ${deps.Math.round(MAX_TIMEOUT_MS / 1000)} 秒后续期`);
            return;
        }
        st.sleepTimer = deps.wakeTimers.schedule(key, st, 'sleepTimer', () => {
            st.sleepTimer = null;
            void (0, deps.sendWakePromptV2)(key, 'timeout').catch((error) => (0, deps.log)(`[reserved2] 睡眠到期唤醒异常 ${key}:`, error?.message ?? error));
        }, delay);
        st.sleepTimer.unref?.();
        (0, deps.log)(`[reserved2] 设置有限潜水定时器 ${key}，剩余 ${deps.Math.round(delay / 1000)}s`);
    }
    function cancelProactiveCheckV2(key) {
        const st = deps.socialV2.conversations.get(key);
        if (!st || !st.proactiveTimer)
            return;
        deps.wakeTimers.cancel(key, 'proactiveTimer');
        st.proactiveTimer = null;
    }
    function scheduleProactiveCheckV2(key) {
        if (deps.nativeBinding)
            return; // 原生冷场统一走独立闸门，旧定时器不能绕开本次选择。
        if (deps.cfg.socialV2?.proactive?.enabled === false)
            return;
        if (deps.socialV2.paused || deps.currentMode !== 'reserved2')
            return;
        if (!(0, deps.isSessionAllowedInCurrentMode)(key))
            return;
        const st = (0, deps.getSocialV2State)(key);
        if (st.proactiveTimer)
            return;
        const p = deps.cfg.socialV2?.proactive ?? {};
        const min = deps.Math.max(60 * 1000, Number(p.checkIntervalMinMs) || 30 * 60 * 1000);
        const max = deps.Math.max(min, Number(p.checkIntervalMaxMs) || 90 * 60 * 1000);
        const delay = deps.Math.floor(min + deps.Math.random() * (max - min));
        st.proactiveTimer = deps.wakeTimers.schedule(key, st, 'proactiveTimer', () => {
            st.proactiveTimer = null;
            (0, deps.ensureWakeableV2)(st, { key });
            const idleThreshold = Number(p.idleThresholdMs) || 15 * 60 * 1000;
            const idle = deps.Date.now() - (st.lastIncomingAt || 0);
            const probBase = Number(p.probability);
            let prob = deps.Math.min(1, deps.Math.max(0, Number.isFinite(probBase) ? probBase : 0.4));
            const pendingThoughts = Array.isArray(st.pendingThoughts) ? st.pendingThoughts.filter((t) => t && (!t.expiresAt || deps.Date.now() < Number(t.expiresAt))).length : 0;
            if (pendingThoughts > 0)
                prob = deps.Math.min(1, prob * 1.4);
            if (st.lastAiReplyAt && deps.Date.now() - Number(st.lastAiReplyAt) < 30 * 60 * 1000)
                prob *= 0.5;
            const hour = new deps.Date().getHours();
            if (hour >= 23 || hour < 8)
                prob *= 0.3;
            const recent = Array.isArray(st.recentMessages) ? st.recentMessages : [];
            const aiCount = recent.filter((m) => m && m.isSelf && deps.Date.now() - Number(m.time || 0) < 60 * 60 * 1000).length;
            if (aiCount >= 5)
                prob *= 0.3;
            if (idle >= idleThreshold && deps.Math.random() < prob && !isConversationBusyV2(key, st)) {
                void (0, deps.sendWakePromptV2)(key, 'proactiveCheck').catch((error) => (0, deps.log)(`[reserved2] proactive 唤醒异常 ${key}:`, error?.message ?? error));
            }
            scheduleProactiveCheckV2(key);
        }, delay);
        st.proactiveTimer.unref?.();
        (0, deps.log)(`[reserved2] 已安排主动机会检查 ${key}，约 ${deps.Math.round(delay / 60000)}min 后`);
    }
    function clearSocialV2Timers(key) {
        deps.wakeTimers.cancelConversation(key);
        deps.pendingWakeKeys.delete(key);
        deps.nativeObservation?.cancel(key);
        const st = deps.socialV2.conversations.get(key);
        if (!st)
            return;
        if (st.pendingWakeTimer) {
            deps.wakeTimers.cancel(key, 'pendingWakeTimer');
            st.pendingWakeTimer = null;
        }
        st.pendingWakeReason = null;
        if (st.sleepTimer) {
            deps.wakeTimers.cancel(key, 'sleepTimer');
            st.sleepTimer = null;
        }
        if (st.replyCheckTimer) {
            deps.wakeTimers.cancel(key, 'replyCheckTimer');
            st.replyCheckTimer = null;
        }
        if (st.proactiveTimer) {
            deps.wakeTimers.cancel(key, 'proactiveTimer');
            st.proactiveTimer = null;
        }
        if (st.rateLimitRetryTimer) {
            deps.wakeTimers.cancel(key, 'rateLimitRetryTimer');
            st.rateLimitRetryTimer = null;
        }
        if (Array.isArray(st.pendingWakeReasons))
            st.pendingWakeReasons.length = 0;
    }
    function clearAllSocialV2Timers() {
        deps.wakeTimers.clear();
        for (const key of deps.socialV2.conversations.keys())
            clearSocialV2Timers(key);
        deps.pendingWakeKeys.clear();
        deps.wakeConfigUpdatedKeys.clear();
        deps.markReadCalledKeys.clear();
        deps.wakeConfigMissCount.clear();
        deps.messageMediaStore.clear();
    }
    return { cancelReplyCheckV2, scheduleReplyCheckV2, busyReasonV2, isConversationBusyV2, scheduleWakeV2, replayPendingWakeReasonsV2, setupSleepTimerV2, cancelProactiveCheckV2, scheduleProactiveCheckV2, clearSocialV2Timers, clearAllSocialV2Timers };
}
