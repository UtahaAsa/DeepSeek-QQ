// Generated from sessions/pending-requests.ts. Edit the TypeScript source and run build:typed.
/**
 * 持有挂起提问/审批与超时任务；相同请求的回答与取消共享一个在途回执。
 * @param {object} deps 实时API、配置、会话有效性检查及宿主定时器，不在构造时产生IO。
 * @returns {object} 注册、回答、取消和清理操作；回执失败保留可重试请求，成功先清理再通知。
 * @note delete/clear仅撤销本地归属；需要远端拒绝回执时调用cancelPendingEntry。
 */
export function createPendingRequests(deps) {
    const entries = new Map(), flights = new WeakMap(), settled = new WeakSet();
    const clearTimer = (entry) => { if (entry?.timer != null)
        deps.clearTimeout(entry.timer); };
    function remove(key, expected) {
        const entry = entries.get(key);
        if (!entry || (expected && entry !== expected))
            return false;
        clearTimer(entry);
        return entries.delete(key);
    }
    async function respond(entry, value, timeout = false) {
        if (settled.has(entry))
            return;
        if (flights.has(entry))
            return flights.get(entry);
        const task = Promise.resolve().then(() => {
            const call = deps.api.respond({ clientId: entry.clientId, eventId: entry.eventId, outcome: { kind: 'result', value } });
            return timeout ? deps.withTimeout(call, 5000, '取消挂起回执') : call;
        });
        flights.set(entry, task);
        try {
            await task;
            settled.add(entry);
        }
        finally {
            if (flights.get(entry) === task)
                flights.delete(entry);
        }
    }
    async function cancelPendingEntry(entry) {
        if (!entry)
            return;
        clearTimer(entry);
        // 正在提交的回答先收尾：已成功不再追加拒绝；提交失败则继续执行取消。
        if (flights.has(entry)) {
            try {
                await flights.get(entry);
            }
            catch { }
        }
        if (settled.has(entry))
            return;
        try {
            if (entry.kind === 'approval')
                await respond(entry, 'rejected', true);
            else if (entry.kind === 'question')
                await respond(entry, { answers: [] }, true);
        }
        catch (error) {
            deps.log('取消挂起请求回执失败:', error?.message ?? error);
        }
    }
    async function registerPending(key, entry) {
        if (!deps.isCurrentSession(key, entry.sessionId)) {
            await cancelPendingEntry(entry);
            return false;
        }
        const existing = entries.get(key);
        if (existing === entry)
            return true;
        if (existing) {
            remove(key, existing);
            void cancelPendingEntry(existing);
        }
        entry.timer = deps.setTimeout(() => {
            if (!remove(key, entry))
                return;
            deps.log(`挂起请求超时 (${key})`);
            void cancelPendingEntry(entry);
            void deps.sendToQQ(key, '⏰ 等待回答超时，已取消该请求').catch(error => deps.log('超时提示发送失败:', error?.message ?? error));
        }, deps.cfg.questionTimeoutMs);
        entries.set(key, entry);
        return true;
    }
    async function handlePendingAnswer(entry, text, key, isOwner = false) {
        if (entries.get(key) !== entry || settled.has(entry))
            return;
        if (!deps.isCurrentSession(key, entry.sessionId)) {
            remove(key, entry);
            await cancelPendingEntry(entry);
            return;
        }
        if (entry.kind === 'approval' && !isOwner) {
            await deps.sendToQQ(key, '审批仅管理员可操作');
            return;
        }
        if (flights.has(entry)) {
            try {
                await flights.get(entry);
            }
            catch { }
            return;
        }
        let value;
        if (entry.kind === 'question') {
            value = {
                answers: entry.questions.map(question => {
                    const match = (question.options ?? []).find(option => option.label.trim().toLowerCase() === text.trim().toLowerCase());
                    return match ? { id: question.id, selected: [match.label] } : { id: question.id, selected: [], custom: text };
                })
            };
        }
        else if (entry.kind === 'approval') {
            const answer = text.trim().toLowerCase();
            for (const word of deps.APPROVE_WORDS)
                if (answer === word)
                    value = 'allowed-once';
            for (const word of deps.REJECT_WORDS)
                if (answer === word)
                    value = 'rejected';
            if (!value) {
                await deps.sendToQQ(key, '请回复「通过」或「拒绝」来决定这个审批');
                return;
            }
        }
        else
            return;
        try {
            await respond(entry, value);
        }
        catch (error) {
            deps.log('回答回执提交失败:', error?.message ?? error);
            if (entries.get(key) === entry)
                await deps.sendToQQ(key, entry.kind === 'approval'
                    ? '⚠️ 审批回执提交失败，请再回复一次「通过」或「拒绝」。' : '⚠️ 回答提交失败，请再回复一次。');
            return;
        }
        // RPC成功后先清定时器；通知失败不能把已完成审批重新变成可提交状态。
        if (!remove(key, entry))
            return;
        if (entry.kind === 'approval') {
            try {
                await deps.sendToQQ(key, value === 'allowed-once' ? '✅ 已通过审批' : '❌ 已拒绝审批');
            }
            catch (error) {
                deps.log('审批回执成功，通知发送失败:', error?.message ?? error);
            }
        }
    }
    return Object.freeze({
        registerPending, handlePendingAnswer, cancelPendingEntry,
        get: (key) => entries.get(key), entries: () => entries.entries(), values: () => entries.values(), [Symbol.iterator]: () => entries[Symbol.iterator](),
        delete: (key) => remove(key), clear() { for (const key of entries.keys())
            remove(key); },
    });
}
