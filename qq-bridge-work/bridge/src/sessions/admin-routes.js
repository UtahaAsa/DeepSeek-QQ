// Generated from sessions/admin-routes.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { unwrap } from '../dsh-client.js';
/**
 * 集中会话列表、挂起项、单会话重置与工作区重置的管理接口。
 * @param {object} options getContext在匹配请求时读取所属桥接的实时状态与操作，advanceEpoch使旧建会话任务失效；
 * stateDir/activityLog是所属实例的路径，controlTimeoutMs沿用宿主超时，log不记录凭据。
 * @returns {function(object):Promise<boolean>} 已处理返回true，无关路径返回false；本地异常由宿主统一响应。
 * @note 调用前必须完成控制台鉴权与同源检查。构造无IO；只有显式POST重置才清理合成或实际实例。
 * 单会话先清本地再停止/归档；工作区仅操作stateDir子目录中的根会话，保留原错误处理与返回字段。
 * 当前仅分离管理操作，状态所有权仍在宿主；getContext不得缓存为全局共享对象。
 */
export function createSessionAdminRoutes({ getContext, advanceEpoch, stateDir: STATE_DIR, activityLog: ACTIVITY_LOG, controlTimeoutMs: DSH_CONTROL_TIMEOUT_MS, log }) {
    return async function handleSessionAdminRoute({ req, url, readBody, sendJson }) {
        if (!((req.method === 'GET' && ['/api/sessions', '/api/pending'].includes(url.pathname))
            || (req.method === 'POST' && ['/api/session/reset', '/api/workspace/reset'].includes(url.pathname))))
            return false;
        const { state, cfg, pending, sessionModelManager, reverse, collectors, sendToolSucceededSessions, pendingSendToolCalls, v2TurnStartAt, turnLeaseNoted, toolCallNames, offlineQueue, sessionCreation, social, messageMediaStore, slangWindows, slangExtractionCooldowns, slangSubmitTimes, pendingWakeKeys, wakeConfigUpdatedKeys, markReadCalledKeys, wakeConfigMissCount, socialV2, seenForwardIds, CONVERSATION_TOKENS, KNOWN_AGENT_TOKENS, cancelPendingEntry, drainPromptQueue, drainAllPromptQueues, cancelSocialTimers, clearSocialV2Timers, cancelAllSocialTimers, clearAllSocialV2Timers, forgetAgentToken, saveSocialV2State, saveState, withTimeout, stopBridgeSessionWork, api } = getContext();
        // ── 会话查看 ──────────────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/sessions') {
            const list = [];
            for (const [key, sessionId] of Object.entries(state.sessions)) {
                list.push({ key, sessionId, owner: key === `private:${String(cfg.ownerQQ ?? '')}` });
            }
            sendJson({ sessions: list });
            return true;
        }
        // ── 挂起审批 / 提问 ───────────────────────────────────────────────────
        if (req.method === 'GET' && url.pathname === '/api/pending') {
            const list = [];
            for (const [key, p] of pending.entries()) {
                list.push({
                    key,
                    kind: p.kind,
                    sessionId: p.sessionId,
                    ...(p.kind === 'approval' ? { toolName: p.toolName, reason: p.reason, approvalId: p.approvalId } : {}),
                    ...(p.kind === 'question' ? { questions: p.questions } : {})
                });
            }
            sendJson({ pending: list });
            return true;
        }
        // ── 清除上下文 / 清空工作区 ──────────────────────────────────────────
        if (req.method === 'POST' && url.pathname === '/api/session/reset') {
            const body = await readBody();
            const key = String(body.key ?? '');
            if (!key || !state.sessions[key]) {
                sendJson({ ok: false, error: '会话不存在' }, 404);
                return true;
            }
            advanceEpoch();
            const oldSessionId = state.sessions[key];
            delete state.sessions[key];
            sessionModelManager.forget(oldSessionId);
            // 权限元数据必须与映射一起删除，否则会永久残留在 sessions.json 里。
            delete state.sessionPolicies[key];
            reverse.delete(oldSessionId);
            collectors.delete(oldSessionId);
            sendToolSucceededSessions.delete(oldSessionId);
            pendingSendToolCalls.delete(oldSessionId);
            v2TurnStartAt.delete(oldSessionId);
            turnLeaseNoted.delete(oldSessionId);
            toolCallNames.delete(oldSessionId);
            const pe = pending.get(key);
            if (pe) {
                clearTimeout(pe.timer);
                cancelPendingEntry(pe).catch(() => { });
            }
            pending.delete(key);
            offlineQueue.forget(key);
            sessionCreation.forget(key);
            drainPromptQueue(key, '会话已重置');
            social.recentMessages.delete(key);
            messageMediaStore.delete(key);
            social.pendingSummaries.delete(key);
            social.states.delete(key);
            social.silentContext.delete(key);
            social.silentTurns.delete(oldSessionId);
            social.exitingSessions.delete(oldSessionId);
            slangWindows.delete(key);
            slangExtractionCooldowns.delete(key);
            slangSubmitTimes.delete(key);
            cancelSocialTimers(key);
            clearSocialV2Timers(key);
            pendingWakeKeys.delete(key);
            wakeConfigUpdatedKeys.delete(key);
            markReadCalledKeys.delete(key);
            wakeConfigMissCount.delete(key);
            forgetAgentToken(key);
            socialV2.conversations.delete(key);
            seenForwardIds.delete(key);
            saveSocialV2State();
            saveState();
            // 归档只隐藏会话，不终止 DSH 侧排队的工作；先清队列并取消当前回合。
            try {
                await withTimeout(stopBridgeSessionWork(oldSessionId, 'reset'), DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork');
            }
            catch (error) {
                log(`⚠️ 停止旧会话失败 ${key}：${error?.message ?? error}；请在 DSH 检查旧任务`);
            }
            try {
                await withTimeout(api.workspace.archiveSession({ sessionId: oldSessionId }), DSH_CONTROL_TIMEOUT_MS, 'archiveSession');
            }
            catch { }
            log(`控制台：已清除会话上下文 ${key}（旧会话 ${oldSessionId} 已停止并归档）`);
            sendJson({ ok: true, key, archived: oldSessionId });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/workspace/reset') {
            advanceEpoch();
            let archivedCount = 0;
            let stoppedCount = 0;
            try {
                // 新版 DSH 不再提供 workspace.list；改为扫描本桥接创建的会话目录并归档。
                // 只处理 cwd 位于 qq-bridge state/ 下的根会话；子代理会话由父会话管理，不能误归档。
                const list = unwrap(await withTimeout(api.sessions.list({}), DSH_CONTROL_TIMEOUT_MS, 'sessions.list'), 'session.list');
                const stateDir = path.resolve(STATE_DIR);
                const statePrefix = path.normalize(stateDir + path.sep);
                const normPath = (p) => path.normalize(String(p ?? '').replace(/\//g, path.sep));
                const isUnderState = (cwd) => process.platform === 'win32'
                    ? cwd.toLowerCase().startsWith(statePrefix.toLowerCase())
                    : cwd.startsWith(statePrefix);
                for (const item of list.items ?? []) {
                    if (item.origin === 'subagent' || item.parentSessionId)
                        continue;
                    const cwd = normPath(item.cwd);
                    if (isUnderState(cwd)) {
                        // 归档只隐藏会话；必须先把 DSH 侧排队的工作清掉并取消当前回合。
                        try {
                            await withTimeout(stopBridgeSessionWork(item.sessionId, 'reset-all'), DSH_CONTROL_TIMEOUT_MS, 'stopSessionWork');
                            stoppedCount += 1;
                        }
                        catch (error) {
                            log(`⚠️ 停止旧会话失败 ${item.sessionId}：${error?.message ?? error}；请在 DSH 检查旧任务`);
                        }
                        try {
                            await withTimeout(api.workspace.archiveSession({ sessionId: item.sessionId }), DSH_CONTROL_TIMEOUT_MS, 'archiveSession');
                            archivedCount += 1;
                        }
                        catch { }
                    }
                }
            }
            catch { }
            for (const entry of pending.values()) {
                clearTimeout(entry.timer);
                cancelPendingEntry(entry).catch(() => { });
            }
            pending.clear();
            offlineQueue.clear();
            sessionCreation.clear();
            drainAllPromptQueues('工作区已清空');
            social.states.clear();
            social.recentMessages.clear();
            messageMediaStore.clear();
            seenForwardIds.clear();
            social.pendingSummaries.clear();
            social.silentContext.clear();
            social.silentTurns.clear();
            social.exitingSessions.clear();
            slangWindows.clear();
            slangExtractionCooldowns.clear();
            slangSubmitTimes.clear();
            cancelAllSocialTimers();
            clearAllSocialV2Timers();
            // 清空工作区 = 所有会话连同 token 一起作废，两张表整体清掉（比逐会话摘除更不容易漏）。
            socialV2.conversations.clear();
            CONVERSATION_TOKENS.clear();
            KNOWN_AGENT_TOKENS.clear();
            saveSocialV2State();
            state.sessions = {};
            state.sessionPolicies = {};
            reverse.clear();
            collectors.clear();
            sendToolSucceededSessions.clear();
            pendingSendToolCalls.clear();
            v2TurnStartAt.clear();
            toolCallNames.clear();
            saveState();
            try {
                fs.writeFileSync(ACTIVITY_LOG, '');
            }
            catch { }
            log(`控制台：已清空 QQ 聊天工作区（停止 ${stoppedCount} 个、归档 ${archivedCount} 个会话，映射与活动日志已清空）`);
            sendJson({ ok: true, archivedCount, stoppedCount });
            return true;
        }
        return false;
    };
}
