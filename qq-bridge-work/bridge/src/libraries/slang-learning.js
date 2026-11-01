// Generated from libraries/slang-learning.ts. Edit the TypeScript source and run build:typed.
/**
 * 管理串行学习队列和专用会话引用，当前配置和库通过实时依赖访问。
 * @param deps 所属宿主的存储、模型、事件和定时器能力；构造不读盘、不创建远端会话。
 * @returns 学习、研究、窗口输入与提示构造操作；sessionId为只读实时视图。
 * @note 不自动重试远端提交；无效预设拒绝复用，在途旧会话仍保留事件消费资格。
 */
export function createSlangLearning(deps) {
    let slangLearnerSessionId = null;
    let slangTaskChain = Promise.resolve();
    function saveSlangStore() {
        if (!deps.slangStoreWritable) {
            (0, deps.log)('⚠️ 黑话库处于只读降级状态（启动时加载失败），本次改动不落盘');
            return;
        }
        try {
            const result = (0, deps.saveSlang)(deps.SLANG_FILE, deps.slangEntries);
            if (result?.dropped > 0) {
                deps.slangEntries = result.entries;
                (0, deps.log)(`黑话库超过 ${deps.SLANG_MAX_ENTRIES} 条上限，已按「已确认优先」丢弃 ${result.dropped} 条最不活跃的词条`);
            }
        }
        catch (error) {
            (0, deps.log)('保存黑话库失败:', error?.message ?? error);
        }
    }
    function queueSlangTask(fn) {
        slangTaskChain = slangTaskChain.then(fn).catch((error) => (0, deps.log)('黑话学习任务异常:', error?.message ?? error));
        return slangTaskChain;
    }
    async function ensureSlangLearnerSession() {
        const preset = (0, deps.resolvePresetName)(deps.cfg.slang?.learnerPreset || deps.cfg.agentPreset, { strict: true });
        if (!preset)
            throw new Error('黑话学习缺少已验证的安全 preset，拒绝创建或复用会话');
        const saved = (0, deps.readJsonSafe)(deps.SLANG_SESSION_FILE, null);
        // 旧记录没有 preset 元数据，无法证明其权限，必须重新创建。
        if (saved?.preset !== preset)
            invalidateSlangLearnerSession();
        if (slangLearnerSessionId) {
            deps.learnerSessions.add(slangLearnerSessionId);
            deps.api.events.follow(slangLearnerSessionId);
            return slangLearnerSessionId;
        }
        if (saved?.sessionId && saved.preset === preset) {
            slangLearnerSessionId = String(saved.sessionId);
            deps.learnerSessions.add(slangLearnerSessionId);
            deps.api.events.follow(slangLearnerSessionId);
            await (0, deps.ensureChatModel)(slangLearnerSessionId);
            return slangLearnerSessionId;
        }
        const dir = deps.path.join(deps.STATE_DIR, 'slang-agent');
        deps.fs.mkdirSync(dir, { recursive: true });
        const wsValue = (0, deps.unwrap)(await deps.api.workspace.create({ path: dir }), 'slang workspace.create');
        const workspaceTitle = deps.cfg.slang?.workspaceTitle || 'QQ 黑话学习';
        if (wsValue.created && workspaceTitle) {
            try {
                await deps.api.workspace.rename({ workspaceId: wsValue.workspace.workspaceId, title: workspaceTitle });
            }
            catch { }
        }
        const params = { workspaceId: wsValue.workspace.workspaceId };
        params.agentPreset = preset;
        const value = (0, deps.unwrap)(await deps.api.sessions.create(params), 'slang session.create');
        slangLearnerSessionId = value.sessionId;
        deps.learnerSessions.add(slangLearnerSessionId);
        deps.api.events.follow(slangLearnerSessionId);
        await (0, deps.ensureChatModel)(slangLearnerSessionId);
        deps.fs.mkdirSync(deps.STATE_DIR, { recursive: true });
        (0, deps.atomicWriteJson)(deps.SLANG_SESSION_FILE, { sessionId: slangLearnerSessionId, preset });
        (0, deps.log)(`黑话学习会话已创建：${slangLearnerSessionId}`);
        return slangLearnerSessionId;
    }
    function invalidateSlangLearnerSession() {
        // 如果在途任务仍在使用旧会话，先保留 learnerSessions 以便事件继续被消费；
        // 没有等待/收集中的旧会话才从集合移除。
        const oldId = slangLearnerSessionId;
        slangLearnerSessionId = null;
        if (oldId && !deps.learnerWaiters.has(oldId) && !deps.learnerCollectors.has(oldId)) {
            deps.learnerSessions.delete(oldId);
        }
        try {
            deps.fs.unlinkSync(deps.SLANG_SESSION_FILE);
        }
        catch { }
    }
    function waitLearnerTurn(sessionId, timeoutMs = 120000) {
        return new Promise((resolve, reject) => {
            const timer = (0, deps.setTimeout)(() => {
                const arr = deps.learnerWaiters.get(sessionId) ?? [];
                const idx = arr.findIndex((w) => w.timer === timer);
                if (idx >= 0)
                    arr.splice(idx, 1);
                if (arr.length === 0)
                    deps.learnerWaiters.delete(sessionId);
                reject(new Error(`等待学习会话 turn 超时(${timeoutMs}ms)`));
            }, timeoutMs);
            const waiter = { resolve, reject, timer };
            const arr = deps.learnerWaiters.get(sessionId) ?? [];
            arr.push(waiter);
            deps.learnerWaiters.set(sessionId, arr);
        });
    }
    async function runSlangExtraction(key) {
        if (deps.cfg.slang?.enabled === false)
            return;
        if (!deps.dshReady)
            return;
        const window = deps.slangWindows.get(key);
        // 输入与证据使用本批快照；窗口仍可接收新消息或滚动淘汰。
        const messages = window?.slice() ?? [];
        const min = Math.max(1, Number(deps.cfg.slang?.extractMinMessages ?? 10));
        if (messages.length < min)
            return;
        const isCurrentWindow = () => window !== undefined && deps.slangWindows.get(key) === window;
        const consumed = new Set(messages);
        const consumeSnapshot = () => {
            if (isCurrentWindow())
                deps.slangWindows.set(key, window.filter(message => !consumed.has(message)));
        };
        let sessionId;
        try {
            sessionId = await ensureSlangLearnerSession();
        }
        catch (error) {
            (0, deps.log)(`黑话学习会话创建失败 (${key}):`, error?.message ?? error);
            return;
        }
        if (!isCurrentWindow() || deps.cfg.slang?.enabled === false || !deps.dshReady)
            return;
        const promptText = (0, deps.buildExtractionPrompt)(messages);
        try {
            const accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] });
            if (!accepted.result.ok) {
                (0, deps.log)(`黑话提取被拒 (${key}): ${accepted.result.error.code}: ${accepted.result.error.message}`);
                return;
            }
            // 远端已受理后仍消费本次回执，再让串行队列前进；本地失效不冒充远端取消。
            const output = await waitLearnerTurn(sessionId);
            if (!isCurrentWindow() || deps.cfg.slang?.enabled === false)
                return;
            const items = (0, deps.parseExtractionJson)(output);
            if (!items.length) {
                (0, deps.log)(`黑话提取：${key} 未发现候选`);
                consumeSnapshot();
                return;
            }
            let added = 0;
            let updated = 0;
            const researchCandidates = [];
            const thresholds = Array.isArray(deps.cfg.slang?.inferenceThresholds) ? deps.cfg.slang.inferenceThresholds.map(Number).filter(Boolean) : [2, 4, 8];
            const seenContents = new Set();
            for (const item of items) {
                if (seenContents.has(item.content))
                    continue;
                seenContents.add(item.content);
                const idx = Number(item.source_id) - 1;
                const src = Number.isInteger(idx) && idx >= 0 && idx < messages.length ? messages[idx] : null;
                const evidence = src ? [{ key, sender: src.sender, text: src.text, time: src.time }] : [];
                const result = (0, deps.upsertSlangEntry)(deps.slangEntries, item.content, { evidence, countIncrement: 1 });
                if (result.created)
                    added += 1;
                else
                    updated += 1;
                if (result.entry && result.entry.status === deps.SLANG_STATUS.CANDIDATE && thresholds.includes(result.entry.count) && result.entry.count > result.entry.lastInferenceCount) {
                    researchCandidates.push(result.entry);
                }
            }
            consumeSnapshot();
            saveSlangStore();
            (0, deps.log)(`黑话提取：${key} 新增 ${added} 条，更新 ${updated} 条`);
            if (researchCandidates.length && deps.cfg.slang?.autoResearch !== false) {
                queueSlangTask(() => runSlangResearch(researchCandidates));
            }
        }
        catch (error) {
            if (/会话|session|not found|404/i.test(String(error?.message ?? error))) {
                invalidateSlangLearnerSession();
            }
            (0, deps.log)(`黑话提取失败 (${key}):`, error?.message ?? error);
        }
    }
    async function runSlangResearch(candidates) {
        if (!candidates || !candidates.length)
            return;
        if (deps.cfg.slang?.enabled === false)
            return;
        if (!deps.dshReady)
            return;
        // 过滤掉已经在研究队列里的候选，避免同一批被重复排队研究。
        const targets = candidates.filter((e) => e && !deps.slangResearchingIds.has(e.id));
        if (!targets.length)
            return;
        for (const e of targets)
            deps.slangResearchingIds.add(e.id);
        let sessionId;
        try {
            sessionId = await ensureSlangLearnerSession();
        }
        catch (error) {
            for (const e of targets)
                deps.slangResearchingIds.delete(e.id);
            (0, deps.log)('黑话研究会话创建失败:', error?.message ?? error);
            return;
        }
        const promptText = (0, deps.buildResearchPrompt)(targets);
        try {
            const accepted = await deps.api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] });
            if (!accepted.result.ok) {
                (0, deps.log)(`黑话研究被拒: ${accepted.result.error.code}: ${accepted.result.error.message}`);
                return;
            }
            const output = await waitLearnerTurn(sessionId);
            const results = (0, deps.parseResearchJson)(output);
            for (const r of results) {
                const entry = deps.slangEntries.find((e) => e.content === r.content);
                if (!entry)
                    continue;
                // 只有明确确认（confirmed: true）的结果才写入解释字段；
                // 不确定/未确认的结果保留原状，允许后续再次研究。
                if (r.confirmed !== true) {
                    (0, deps.log)(`黑话研究：${r.content} 未确认，保留候选待后续研究`);
                    continue;
                }
                if (r.meaning)
                    entry.meaning = r.meaning;
                if (r.usage)
                    entry.usage = r.usage;
                if (r.example)
                    entry.example = r.example;
                if (r.risk)
                    entry.risk = r.risk;
                if (Array.isArray(r.sources) && r.sources.length)
                    entry.sources = r.sources.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 10);
                entry.lastInferenceCount = entry.count;
                entry.updatedAt = new deps.Date().toISOString();
            }
            saveSlangStore();
            (0, deps.log)(`黑话研究：已更新 ${results.length} 条候选解释`);
        }
        catch (error) {
            if (/会话|session|not found|404/i.test(String(error?.message ?? error))) {
                invalidateSlangLearnerSession();
            }
            (0, deps.log)('黑话研究失败:', error?.message ?? error);
        }
        finally {
            for (const e of targets)
                deps.slangResearchingIds.delete(e.id);
        }
    }
    function maybeQueueSlangExtraction(key) {
        if (deps.cfg.slang?.enabled === false)
            return;
        if (!deps.dshReady)
            return;
        const cooldown = Number(deps.cfg.slang?.extractCooldownMs ?? 300000);
        const last = deps.slangExtractionCooldowns.get(key) ?? 0;
        if (deps.Date.now() - last < cooldown)
            return;
        const messages = deps.slangWindows.get(key) ?? [];
        const min = Math.max(1, Number(deps.cfg.slang?.extractMinMessages ?? 10));
        if (messages.length < min)
            return;
        deps.slangExtractionCooldowns.set(key, deps.Date.now());
        queueSlangTask(() => runSlangExtraction(key));
    }
    // 黑话学习素材入口：群聊普通消息进入滚动窗口（命令/角色控制语不学；
    // 只学当前消息自己的文字，不学引用原文）。一代/二代共用。
    function feedSlangWindow(key, sender, plainContent) {
        if (deps.cfg.slang?.enabled === false)
            return;
        if (!key || !plainContent || typeof plainContent !== 'string')
            return;
        const text = plainContent.trim();
        if (!text || text.startsWith('/'))
            return;
        if (/进入角色扮演|退出角色扮演|切换角色|设置角色|改角色|换角色|关闭角色扮演|开启角色扮演/.test(text))
            return;
        if (!deps.slangWindows.has(key))
            deps.slangWindows.set(key, []);
        const win = deps.slangWindows.get(key);
        win.push({ sender: String(sender || '未知'), text: (0, deps.truncateText)(text, 200), time: deps.Date.now() });
        if (win.length > 80)
            win.splice(0, win.length - 80);
        maybeQueueSlangExtraction(key);
    }
    function confirmedSlangListV2() {
        return (0, deps.confirmedSlangEntries)(deps.slangEntries, deps.cfg.slang?.injectMax);
    }
    function withSlangContext(promptText) {
        const now = new deps.Date();
        const timeLine = `【当前时间】${now.toLocaleString('zh-CN', { hour12: false })}（${Intl.DateTimeFormat().resolvedOptions().timeZone}）`;
        const parts = [timeLine];
        if (deps.cfg.slang?.enabled !== false) {
            const block = (0, deps.buildSlangContext)(deps.slangEntries, deps.cfg.slang?.injectMax ?? 8);
            if (block)
                parts.push(block);
        }
        return parts.join('\n\n') + '\n\n' + promptText;
    }
    return { saveSlangStore, queueSlangTask, ensureSlangLearnerSession, invalidateSlangLearnerSession, waitLearnerTurn, runSlangExtraction, runSlangResearch, maybeQueueSlangExtraction, feedSlangWindow, confirmedSlangListV2, withSlangContext, get sessionId() { return slangLearnerSessionId; } };
}
