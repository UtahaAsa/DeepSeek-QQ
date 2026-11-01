// Generated from social/legacy-engine.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建一代状态集合并管理活跃、观望、试探、退场及摘要投递。
 * @param deps 实时宿主能力，构造不启动扫描；startSocialLoop由宿主按原顺序调用。
 * @returns state为兼容旧管理端和回合事件的同一视图，所有定时清理由本组件执行。
 * @note 本地取消不撤销已提交模型请求；投递仍经过统一权限与队列。
 */
export function createLegacySocialEngine(deps) {
    const social = {
        states: new Map(), // key -> { phase: 'idle'|'active'|'probing'|'exiting', lastCheckAt, nextCheckAt, lastActiveMessageAt, activeEnteredAt, activeDeadlineAt, activeExitAt, probeDeadline }
        recentMessages: new Map(), // key -> [{sender, text, time}]（最近消息窗口，AI 的"持续感知"）
        pendingSummaries: new Map(), // key -> { items: [{sender, text, time}], since }（观望期未参与消息）
        silentContext: new Map(), // key -> [{sender, text, time}]：选择性沉默但"已看到未回应"的消息，下次投递时带给模型
        loopTimer: null,
        silentTurns: new Map(), // sessionId -> { id, ts }[]：待静默的摘要 turn 队列（FIFO + 超时回收）
        pendingTimers: new Map(), // key -> Set<timerId>：社交排程中尚未触发的定时器
        exitingSessions: new Set() // sessionId：当前正在等待“活跃超时退场”发言完成的 DSH 会话
    };
    const summaryTasks = new WeakMap();
    function isSocialEnabled() {
        return deps.currentMode === 'reserved' && deps.cfg.social?.enabled !== false;
    }
    function socialState(key) {
        if (!social.states.has(key)) {
            social.states.set(key, { phase: 'idle', lastCheckAt: 0, nextCheckAt: 0, lastActiveMessageAt: 0, activeEnteredAt: 0, activeDeadlineAt: 0, activeExitAt: 0, lastAiReplyAt: 0, lastFollowUpAt: 0, probeDeadline: 0, proactiveNextCheckAt: 0 });
        }
        return social.states.get(key);
    }
    function enterActive(key) {
        const now = deps.Date.now();
        const st = socialState(key);
        st.phase = 'active';
        st.lastCheckAt = now;
        st.nextCheckAt = now + (0, deps.randInt)(Number(deps.cfg.social?.activeCheckMinMs ?? 20000), Number(deps.cfg.social?.activeCheckMaxMs ?? 40000));
        st.lastActiveMessageAt = now;
        st.activeEnteredAt = now;
        st.probeDeadline = 0;
        // 从进入活跃那一刻起，随机一个“最长活跃持续时间”；到点后主动收尾退场（当前仅群聊启用）
        if (key.startsWith('group:') && deps.cfg.social?.activeDurationEnabled !== false) {
            st.activeDeadlineAt = now + (0, deps.randInt)(Number(deps.cfg.social?.activeDurationMinMs ?? 15 * 60 * 1000), Number(deps.cfg.social?.activeDurationMaxMs ?? 30 * 60 * 1000));
        }
        else {
            st.activeDeadlineAt = 0;
        }
        st.activeExitAt = 0;
    }
    function cancelSocialTimers(key) {
        const timers = social.pendingTimers.get(key);
        if (!timers)
            return;
        for (const t of timers)
            (0, deps.clearTimeout)(t);
        social.pendingTimers.delete(key);
    }
    function cancelAllSocialTimers() {
        for (const timers of social.pendingTimers.values()) {
            for (const t of timers)
                (0, deps.clearTimeout)(t);
        }
        social.pendingTimers.clear();
    }
    function cleanupSocialForModeChange() {
        cancelAllSocialTimers();
        social.states.clear();
        social.recentMessages.clear();
        deps.messageMediaStore.clear();
        social.pendingSummaries.clear();
        social.silentContext.clear();
        social.silentTurns.clear();
        social.exitingSessions.clear();
        // 拒绝仍在排队中的 prompt，避免调用方 await 永远挂起
        deps.promptQueue.drainAll('模式切换，已取消排队中的投递');
    }
    function leaveActive(key) {
        cancelSocialTimers(key);
        social.states.delete(key);
        social.silentContext.delete(key);
    }
    function triggerActiveDurationExit(key, st, now) {
        if (!st || st.phase !== 'active')
            return false;
        if (!key.startsWith('group:'))
            return false; // 仅群聊启用，私聊不自动退场
        if (deps.cfg.social?.activeDurationEnabled === false)
            return false;
        const deadline = st.activeDeadlineAt || 0;
        if (!deadline || now < deadline)
            return false;
        if (st.phase === 'exiting')
            return true;
        st.phase = 'exiting';
        st.activeExitAt = now;
        // 先取消尚未触发的旧回复/补刀定时器，避免退场期间再冒出旧发言
        cancelSocialTimers(key);
        const roleHint = (0, deps.currentRoleHint)();
        const promptText = (0, deps.buildActiveExitPrompt)(key, roleHint);
        scheduleSocialReply(key, promptText, Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000), Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000), '活跃超时退场', true);
        (0, deps.log)(`社交模式：${key} 活跃超过时长上限，提示 AI 收尾退场`);
        return true;
    }
    function scheduleSocialReply(key, promptText, minDelay, maxDelay, label, farewell = false, media = null) {
        const delay = (0, deps.randInt)(minDelay, maxDelay);
        (0, deps.log)(`社交模式：${label} ${key}，延迟 ${deps.Math.round(delay / 1000)}s 后投递`);
        const timer = (0, deps.setTimeout)(() => {
            const timers = social.pendingTimers.get(key);
            // 清理或重复进入的回调不再拥有投递资格；不依赖底层计时器能否撤回排队回调。
            if (!timers?.delete(timer))
                return;
            if (timers.size === 0)
                social.pendingTimers.delete(key);
            (0, deps.deliverPrompt)(key, promptText, { farewell, media: media ?? [] }).catch((error) => (0, deps.log)(`社交投递异常 ${key}: ${error?.message ?? error}`));
        }, delay);
        const timers = social.pendingTimers.get(key) ?? new Set();
        timers.add(timer);
        social.pendingTimers.set(key, timers);
    }
    function socialLoopTick() {
        if (!isSocialEnabled())
            return;
        const now = deps.Date.now();
        // 所有"发过消息或已有状态"的群都参与状态机（观望中的群也做主动判定）
        const keys = new Set([...social.states.keys(), ...social.recentMessages.keys()]);
        for (const key of keys) {
            const st = socialState(key);
            if (st.phase === 'idle') {
                // ── 观望阶段：第三种触发（主动开话题，仅群聊生效） ─────────────────
                if (!deps.nativeBinding && deps.cfg.social?.proactiveEnabled !== false && key.startsWith('group:')) {
                    const arr = social.recentMessages.get(key) ?? [];
                    const lastMsgTime = arr.length ? arr[arr.length - 1].time : 0;
                    const idleThreshold = Number(deps.cfg.social?.proactiveIdleThresholdMs ?? 1800000);
                    if (now - lastMsgTime >= idleThreshold) {
                        if (!st.proactiveNextCheckAt) {
                            st.proactiveNextCheckAt = now + (0, deps.randInt)(Number(deps.cfg.social?.proactiveCheckMinMs ?? 2700000), Number(deps.cfg.social?.proactiveCheckMaxMs ?? 5400000));
                        }
                        if (now >= st.proactiveNextCheckAt) {
                            st.proactiveNextCheckAt = now + (0, deps.randInt)(Number(deps.cfg.social?.proactiveCheckMinMs ?? 2700000), Number(deps.cfg.social?.proactiveCheckMaxMs ?? 5400000));
                            if (deps.Math.random() < Number(deps.cfg.social?.proactiveProbability ?? 0.2)) {
                                enterActive(key);
                                const roleHint = (0, deps.currentRoleHint)();
                                const promptText = (0, deps.buildProactivePrompt)(key, roleHint);
                                scheduleSocialReply(key, promptText, Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000), Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000), '主动开话题');
                                (0, deps.log)(`社交模式：${key} 观望期主动开话题，进入活跃`);
                            }
                        }
                    }
                }
            }
            else if (st.phase === 'active') {
                // 活跃超时：即使群里一直有人说话，到达随机上限后也主动收尾退场
                if (triggerActiveDurationExit(key, st, now))
                    continue;
                if (now >= st.nextCheckAt) {
                    const newMsgs = (social.recentMessages.get(key) ?? []).filter((m) => m.time > st.lastCheckAt);
                    st.lastCheckAt = now;
                    st.nextCheckAt = now + (0, deps.randInt)(Number(deps.cfg.social?.activeCheckMinMs ?? 20000), Number(deps.cfg.social?.activeCheckMaxMs ?? 40000));
                    if (newMsgs.length) {
                        st.lastActiveMessageAt = now;
                        const mustReply = key.startsWith('private:') || newMsgs.some((m) => m.quoteTargetIsSelf || (0, deps.isMustReplyText)(m.plain ?? m.text));
                        // 选择性沉默：只对非必须回的普通闲聊生效；直接提问/点名永远走正常回复
                        if (!mustReply) {
                            // 基准沉默概率；刚发过言后有人快速接话时不沉默，避免“活跃到一半突然不接”
                            let skipProb = deps.Math.min(1, deps.Math.max(0, Number(deps.cfg.social?.skipProbability ?? 0.3)));
                            const sinceAiReply = now - (st.lastAiReplyAt || 0);
                            if (sinceAiReply < 60000)
                                skipProb = 0;
                            const pressure = deps.Math.min(0.5, newMsgs.length * 0.1);
                            skipProb = deps.Math.max(0, skipProb - pressure);
                            if (deps.Math.random() < skipProb) {
                                (0, deps.log)(`社交模式：活跃期 ${key} 跳过 ${newMsgs.length} 条普通消息（选择性沉默，skip=${skipProb.toFixed(2)}）`);
                                // 真人"看到了但没回"：保留到 silentContext，下次投递时一起带给模型
                                const silent = social.silentContext.get(key) ?? [];
                                silent.push(...newMsgs);
                                social.silentContext.set(key, silent.slice(-30));
                                for (const m of newMsgs)
                                    (0, deps.appendSummary)(key, m.sender, m.text, m.plain ?? m.text, m.isOwner, m.media ?? [], m.messageId ?? '');
                                continue;
                            }
                        }
                        // 投递时把之前沉默但"已看到未回应"的消息一并带给模型（真人视角：我看到过，只是当时没接）
                        const seenMsgs = social.silentContext.get(key) ?? [];
                        const promptMsgs = [...seenMsgs, ...newMsgs];
                        social.silentContext.delete(key);
                        const promptText = (0, deps.buildBatchPrompt)(key, promptMsgs, !mustReply);
                        const batchMedia = promptMsgs.flatMap((m) => Array.isArray(m.media) ? m.media : []);
                        scheduleSocialReply(key, promptText, Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000), Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000), '活跃期回应', false, batchMedia);
                        (0, deps.log)(`社交模式：活跃期 ${key} 检测到 ${newMsgs.length} 条新消息${seenMsgs.length ? `（含 ${seenMsgs.length} 条之前沉默的）` : ''}`);
                    }
                    else if (now - st.lastActiveMessageAt >= Number(deps.cfg.social?.idleWindowMs ?? 180000)) {
                        // 冷场：大概率回观望；小概率让 AI 说一句（试探群友是否还在）
                        if (deps.Math.random() < Number(deps.cfg.social?.idleRetryProbability ?? 0.25)) {
                            st.phase = 'probing';
                            st.probeDeadline = now + Number(deps.cfg.social?.idleRetryWaitMs ?? 120000);
                            const promptText = (0, deps.buildProbePrompt)(key);
                            scheduleSocialReply(key, promptText, Number(deps.cfg.social?.activeReplyDelayMinMs ?? 2000), Number(deps.cfg.social?.activeReplyDelayMaxMs ?? 8000), '冷场试探');
                            (0, deps.log)(`社交模式：${key} 冷场，AI 试探性说一句`);
                        }
                        else {
                            leaveActive(key);
                            (0, deps.log)(`社交模式：${key} 冷场，回到观望`);
                        }
                    }
                }
            }
            else if (st.phase === 'exiting') {
                // 退场中：等待 AI 的收尾发言完成后进入观望。
                // 这里不做任何参与/冷场判定，新消息由 handleIncoming 转入摘要。
                // 极端兜底：超过 60 分钟仍未完成（如 DSH 长时间离线），强制回观望，避免状态卡死。
                if (now - st.activeExitAt > 60 * 60 * 1000) {
                    (0, deps.log)(`社交模式：${key} 退场等待超时（60 分钟），强制回到观望`);
                    st.phase = 'idle';
                    st.activeDeadlineAt = 0;
                    st.activeExitAt = 0;
                    const sid = deps.state.sessions[key];
                    if (sid)
                        social.exitingSessions.delete(sid);
                }
            }
            else if (st.phase === 'probing' && now > st.probeDeadline) {
                // 试探后仍无人说话 → 100% 回观望
                leaveActive(key);
                (0, deps.log)(`社交模式：${key} 试探无回应，回到观望`);
            }
        }
    }
    function startSocialLoop() {
        if (social.loopTimer)
            (0, deps.clearInterval)(social.loopTimer);
        social.loopTimer = (0, deps.setInterval)(socialLoopTick, 5000);
        social.loopTimer.unref?.();
    }
    function flushSummary(k, entry) {
        const existing = summaryTasks.get(entry);
        if (existing)
            return existing;
        const messages = entry.items.slice(), mode = deps.currentMode;
        const isCurrent = () => social.pendingSummaries.get(k) === entry && deps.currentMode === mode;
        const run = async () => {
            if (!isCurrent())
                return;
            if (!messages.length) {
                if (!entry.items.length)
                    social.pendingSummaries.delete(k);
                return;
            }
            const lines = messages.map((m) => `${m.isOwner ? '【管理员】' : ''}${m.sender}：${m.text}${(0, deps.mediaHintFor)(k, m.messageId, m.media)}`).join('\n');
            const summaryMedia = messages.flatMap((m) => Array.isArray(m.media) ? m.media : []);
            let sessionId;
            try {
                sessionId = await (0, deps.ensureSession)(k);
            }
            catch (error) {
                (0, deps.log)(`摘要投喂创建会话失败 (${k}): ${error?.message ?? error}`);
                return;
            }
            if (!isCurrent() || deps.state.sessions[k] !== sessionId)
                return;
            const roleHint = (0, deps.currentRoleHint)();
            const summaryText = `${roleHint ? roleHint + '\n\n' : ''}【群聊摘要】过去一段时间群里发生了这些（你未逐条参与）：\n${lines}\n\n【最近对话】\n${(0, deps.buildContextBlock)(k)}\n\n你不需要回复，只需记住这些内容，后续聊天会更自然。`;
            const silentId = deps.Date.now() + '-' + deps.Math.random().toString(36).slice(2, 8);
            const silent = { id: silentId, ts: deps.Date.now() };
            social.silentTurns.set(sessionId, [...(social.silentTurns.get(sessionId) ?? []), silent]);
            const popSilent = () => {
                const arr = social.silentTurns.get(sessionId) ?? [];
                const next = arr.filter((x) => x !== silent);
                if (next.length > 0)
                    social.silentTurns.set(sessionId, next);
                else
                    social.silentTurns.delete(sessionId);
            };
            try {
                const result = await (0, deps.deliverPrompt)(k, summaryText, { silent: true, media: summaryMedia });
                if (result.ok) {
                    if (!isCurrent() || deps.state.sessions[k] !== sessionId)
                        return;
                    const consumed = new Set(messages);
                    entry.items = entry.items.filter(message => !consumed.has(message));
                    if (!entry.items.length)
                        social.pendingSummaries.delete(k);
                    (0, deps.log)(`已投喂群聊摘要 (${k}) ${messages.length} 条`);
                }
                else {
                    popSilent();
                    (0, deps.log)(`摘要投喂被拒 (${k}): ${result.error || '未知错误'}`);
                }
            }
            catch (error) {
                popSilent();
                (0, deps.log)(`摘要投喂失败 (${k}): ${error?.message ?? error}`);
            }
        };
        // 同一摘要对象的并发提交合并；替代摘要不复用旧任务，finally只释放自身归属。
        const task = Promise.resolve().then(run).finally(() => {
            if (summaryTasks.get(entry) === task)
                summaryTasks.delete(entry);
        });
        summaryTasks.set(entry, task);
        return task;
    }
    async function flushSummaries(key = null) {
        const targets = key ? (social.pendingSummaries.has(key) ? [[key, social.pendingSummaries.get(key)]] : []) : [...social.pendingSummaries.entries()];
        for (const [k, entry] of targets)
            await flushSummary(k, entry);
    }
    return { isSocialEnabled, socialState, enterActive, cancelSocialTimers, cancelAllSocialTimers, cleanupSocialForModeChange, leaveActive, triggerActiveDurationExit, scheduleSocialReply, socialLoopTick, startSocialLoop, flushSummaries, state: social };
}
