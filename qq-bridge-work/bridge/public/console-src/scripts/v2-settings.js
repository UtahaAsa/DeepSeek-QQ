var QQConsole;
(function (QQConsole) {
    var V2Settings;
    (function (V2Settings) {
        // ── 二代仿真模式（reserved2）配置 ─────────────────────────────────────────
        async function loadV2Config() {
            try {
                const r = await QQConsole.Core.api('/api/socialV2/config');
                const c = r.config || {};
                document.getElementById('v2Enabled').checked = c.enabled !== false;
                document.getElementById('v2AgentPreset').value = c.agentPreset || '';
                document.getElementById('v2ProvideRecommendations').checked = c.provideRecommendations !== false;
                document.querySelectorAll('[data-v2-tool]').forEach(el => {
                    el.checked = (c.tools && c.tools[el.dataset.v2Tool] !== false);
                });
                const w = c.wake || {};
                document.getElementById('v2WakeDefaultMode').value = w.defaultMode === 'active' ? 'active' : 'diving';
                document.getElementById('v2RecDefaultInfinite').checked = w.recommendedDefaultInfinite !== false;
                document.getElementById('v2RecSleepMin').value = Math.round((w.recommendedSleepMinMs || 300000) / 60000);
                document.getElementById('v2RecSleepMax').value = Math.round((w.recommendedSleepMaxMs || 7200000) / 60000);
                document.getElementById('v2RecProb').value = w.recommendedProbability ?? 0.05;
                document.getElementById('v2RecKeywords').value = (w.recommendedKeywords || []).join(', ');
                document.getElementById('v2RecAt').checked = w.recommendedAtMention !== false;
                document.getElementById('v2RecName').checked = w.recommendedNameMention !== false;
                document.getElementById('v2RecQuestion').checked = w.recommendedQuestion !== false;
                document.getElementById('v2RecPoke').checked = w.recommendedPoke !== false;
                document.getElementById('v2WakeHint').value = w.recommendedHint || '';
                document.getElementById('v2SleepMinMs').value = Math.round((w.sleepMinMs || 60000) / 1000);
                document.getElementById('v2SleepMaxMs').value = Math.round((w.sleepMaxMs || 0) / 1000);
                document.getElementById('v2MaxWakeMin').value = w.maxWakePerMinute ?? 1;
                document.getElementById('v2MaxWakeHour').value = w.maxWakePerHour ?? 12;
                document.getElementById('v2BatchWindowMs').value = w.batchWindowMs ?? 8000;
                document.getElementById('v2NoActionLimit').value = w.noActionLimit ?? 3;
                document.getElementById('v2MaxWakeConfigReminders').value = w.maxWakeConfigReminders ?? 2;
                document.getElementById('v2PreSleepWaitEnabled').checked = w.preSleepWaitEnabled !== false;
                document.getElementById('v2PreSleepWaitMin').value = Number.isFinite(Number(w.preSleepWaitMs)) ? Math.round(Number(w.preSleepWaitMs) / 60000) : 5;
                const s = c.send || {};
                document.getElementById('v2BurstEnabled').checked = s.burstEnabled !== false;
                document.getElementById('v2BurstMax').value = s.burstMaxMessages ?? 8;
                document.getElementById('v2BurstMin').value = s.burstIntervalMinMs ?? 1000;
                document.getElementById('v2BurstMaxMs').value = s.burstIntervalMaxMs ?? 3000;
                document.getElementById('v2LongGapProb').value = s.longGapProbability ?? 0.2;
                document.getElementById('v2LongGapMin').value = s.longGapMinMs ?? 5000;
                document.getElementById('v2LongGapMax').value = s.longGapMaxMs ?? 10000;
                document.getElementById('v2MaxSendMin').value = s.maxSendPerMinute ?? 8;
                document.getElementById('v2MaxSendHour').value = s.maxSendPerHour ?? 60;
                document.getElementById('v2MaxMsgChars').value = s.maxMessageChars ?? 500;
                document.getElementById('v2MaxGapMs').value = s.maxGapMs ?? 10000;
                document.getElementById('v2GapBaseMs').value = s.gapBaseMs ?? 800;
                document.getElementById('v2GapPerCharMs').value = s.gapPerCharMs ?? 20;
                document.getElementById('v2SendHint').value = s.recommendedHint || '';
                const wt = c.wait || {};
                document.getElementById('v2WaitDefaultMs').value = wt.defaultMs ?? 30000;
                document.getElementById('v2WaitMinMs').value = wt.minMs ?? 5000;
                document.getElementById('v2WaitMaxMs').value = wt.maxMs ?? 600000;
                document.getElementById('v2WaitDefaultQuietMs').value = wt.defaultQuietMs ?? 8000;
                document.getElementById('v2MinQuietAfterNewMs').value = wt.minQuietAfterNewMs ?? 10000;
                document.getElementById('v2AutoReplyCheckSec').value = Math.round((c.autoReplyCheckMs || 30000) / 1000);
                const pa = c.proactive || {};
                document.getElementById('v2ProactiveEnabled').checked = pa.enabled !== false;
                document.getElementById('v2ProactiveIntervalMin').value = Math.round((pa.checkIntervalMinMs || 1800000) / 60000);
                document.getElementById('v2ProactiveIntervalMax').value = Math.round((pa.checkIntervalMaxMs || 5400000) / 60000);
                document.getElementById('v2ProactiveIdleThreshold').value = Math.round((pa.idleThresholdMs || 900000) / 60000);
                document.getElementById('v2ProactiveProbability').value = pa.probability ?? 0.3;
                const stk = c.sticker || {};
                document.getElementById('v2StickerEnabled').checked = stk.enabled !== false;
                document.getElementById('v2StickerSyncTtlSec').value = Math.round((stk.syncTtlMs || 60000) / 1000);
                document.getElementById('v2StickerMaxList').value = stk.maxListCount ?? 100;
                document.getElementById('v2StickerPromptMax').value = stk.promptMaxStickers ?? 8;
                document.getElementById('v2StickerIncludePrompt').checked = stk.includeInPrompt !== false;
                const stkCollect = stk.collect || {};
                document.getElementById('v2StickerCollectEnabled').checked = stkCollect.enabled !== false;
                document.getElementById('v2StickerCollectPerMin').value = stkCollect.maxPerMinute ?? 2;
                document.getElementById('v2StickerCollectPerHour').value = stkCollect.maxPerHour ?? 10;
                document.getElementById('v2StickerCollectRemarkMax').value = stkCollect.maxRemarkChars ?? 20;
                const ctx = c.context || {};
                document.getElementById('v2ContextRecentLimit').value = ctx.recentLimit ?? 100;
                document.getElementById('v2ContextUnreadLimit').value = ctx.unreadLimit ?? 30;
                document.getElementById('v2ContextWindow').value = ctx.contextWindow ?? 20;
                const fb = c.feedback || {};
                document.getElementById('v2FeedbackMaxLength').value = fb.maxLength ?? 500;
                document.getElementById('v2FeedbackNotifyOwner').checked = fb.notifyOwnerOnError === true;
            }
            catch { }
        }
        V2Settings.loadV2Config = loadV2Config;
        async function saveV2Config() {
            const tools = {};
            document.querySelectorAll('[data-v2-tool]').forEach(el => { tools[el.dataset.v2Tool] = el.checked; });
            const body = {
                enabled: document.getElementById('v2Enabled').checked,
                agentPreset: document.getElementById('v2AgentPreset').value.trim(),
                provideRecommendations: document.getElementById('v2ProvideRecommendations').checked,
                autoReplyCheckMs: Math.round(Number(document.getElementById('v2AutoReplyCheckSec').value) || 30) * 1000,
                tools,
                wake: {
                    defaultMode: document.getElementById('v2WakeDefaultMode').value,
                    recommendedDefaultInfinite: document.getElementById('v2RecDefaultInfinite').checked,
                    preSleepWaitEnabled: document.getElementById('v2PreSleepWaitEnabled').checked,
                    preSleepWaitMs: (Number.isFinite(Number(document.getElementById('v2PreSleepWaitMin').value)) && Number(document.getElementById('v2PreSleepWaitMin').value) >= 0 ? Math.round(Number(document.getElementById('v2PreSleepWaitMin').value)) : 5) * 60000,
                    recommendedSleepMinMs: (Math.round(Number(document.getElementById('v2RecSleepMin').value) || 5)) * 60000,
                    recommendedSleepMaxMs: (Math.round(Number(document.getElementById('v2RecSleepMax').value) || 120)) * 60000,
                    recommendedProbability: Number(document.getElementById('v2RecProb').value) || 0,
                    recommendedKeywords: document.getElementById('v2RecKeywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
                    recommendedAtMention: document.getElementById('v2RecAt').checked,
                    recommendedNameMention: document.getElementById('v2RecName').checked,
                    recommendedQuestion: document.getElementById('v2RecQuestion').checked,
                    recommendedPoke: document.getElementById('v2RecPoke').checked,
                    recommendedHint: document.getElementById('v2WakeHint').value,
                    sleepMinMs: (Math.round(Number(document.getElementById('v2SleepMinMs').value) || 0)) * 1000,
                    sleepMaxMs: (Math.round(Number(document.getElementById('v2SleepMaxMs').value) || 0)) * 1000,
                    maxWakePerMinute: Math.round(Number(document.getElementById('v2MaxWakeMin').value) || 0),
                    maxWakePerHour: Math.round(Number(document.getElementById('v2MaxWakeHour').value) || 0),
                    batchWindowMs: Math.round(Number(document.getElementById('v2BatchWindowMs').value) || 8000),
                    noActionLimit: Math.round(Number(document.getElementById('v2NoActionLimit').value) || 3),
                    maxWakeConfigReminders: Math.round(Number(document.getElementById('v2MaxWakeConfigReminders').value) || 2)
                },
                send: {
                    burstEnabled: document.getElementById('v2BurstEnabled').checked,
                    burstMaxMessages: Math.round(Number(document.getElementById('v2BurstMax').value) || 8),
                    burstIntervalMinMs: Math.round(Number(document.getElementById('v2BurstMin').value) || 1000),
                    burstIntervalMaxMs: Math.round(Number(document.getElementById('v2BurstMaxMs').value) || 3000),
                    longGapProbability: Number(document.getElementById('v2LongGapProb').value) || 0,
                    longGapMinMs: Math.round(Number(document.getElementById('v2LongGapMin').value) || 5000),
                    longGapMaxMs: Math.round(Number(document.getElementById('v2LongGapMax').value) || 10000),
                    maxSendPerMinute: Math.round(Number(document.getElementById('v2MaxSendMin').value) || 0),
                    maxSendPerHour: Math.round(Number(document.getElementById('v2MaxSendHour').value) || 0),
                    maxMessageChars: Math.round(Number(document.getElementById('v2MaxMsgChars').value) || 500),
                    maxGapMs: Math.round(Number(document.getElementById('v2MaxGapMs').value) || 10000),
                    gapBaseMs: Math.round(Number(document.getElementById('v2GapBaseMs').value) || 800),
                    gapPerCharMs: Math.round(Number(document.getElementById('v2GapPerCharMs').value) || 20),
                    recommendedHint: document.getElementById('v2SendHint').value
                },
                wait: {
                    defaultMs: Math.round(Number(document.getElementById('v2WaitDefaultMs').value) || 5000),
                    minMs: Math.round(Number(document.getElementById('v2WaitMinMs').value) || 1000),
                    maxMs: Math.round(Number(document.getElementById('v2WaitMaxMs').value) || 10000),
                    defaultQuietMs: Number.isFinite(Number(document.getElementById('v2WaitDefaultQuietMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2WaitDefaultQuietMs').value))) : 8000,
                    minQuietAfterNewMs: Number.isFinite(Number(document.getElementById('v2MinQuietAfterNewMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2MinQuietAfterNewMs').value))) : 10000
                },
                proactive: {
                    enabled: document.getElementById('v2ProactiveEnabled').checked,
                    checkIntervalMinMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMin').value) || 30) * 60000,
                    checkIntervalMaxMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMax').value) || 90) * 60000,
                    idleThresholdMs: Math.round(Number(document.getElementById('v2ProactiveIdleThreshold').value) || 15) * 60000,
                    probability: Number(document.getElementById('v2ProactiveProbability').value) || 0
                },
                sticker: {
                    enabled: document.getElementById('v2StickerEnabled').checked,
                    syncTtlMs: Math.max(1000, Math.round(Number(document.getElementById('v2StickerSyncTtlSec').value) || 60) * 1000),
                    maxListCount: Math.min(500, Math.max(1, Math.round(Number(document.getElementById('v2StickerMaxList').value) || 100))),
                    includeInPrompt: document.getElementById('v2StickerIncludePrompt').checked,
                    promptMaxStickers: Math.min(30, Math.max(1, Math.round(Number(document.getElementById('v2StickerPromptMax').value) || 8))),
                    collect: {
                        enabled: document.getElementById('v2StickerCollectEnabled').checked,
                        maxPerMinute: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerMin').value) || 0)),
                        maxPerHour: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerHour').value) || 0)),
                        maxRemarkChars: Math.min(50, Math.max(1, Math.round(Number(document.getElementById('v2StickerCollectRemarkMax').value) || 20)))
                    }
                },
                context: {
                    recentLimit: Math.round(Number(document.getElementById('v2ContextRecentLimit').value) || 100),
                    unreadLimit: Math.round(Number(document.getElementById('v2ContextUnreadLimit').value) || 30),
                    contextWindow: Math.round(Number(document.getElementById('v2ContextWindow').value) || 20)
                },
                feedback: {
                    maxLength: Math.round(Number(document.getElementById('v2FeedbackMaxLength').value) || 500),
                    notifyOwnerOnError: document.getElementById('v2FeedbackNotifyOwner').checked
                }
            };
            const r = await QQConsole.Core.api('/api/socialV2/config', 'POST', body);
            const msg = document.getElementById('v2ConfigMsg');
            msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                loadV2Config();
        }
        V2Settings.saveV2Config = saveV2Config;
        async function viewV2State() {
            const key = document.getElementById('v2StateKey').value.trim();
            if (!key) {
                alert('请输入会话 key');
                return;
            }
            const r = await QQConsole.Core.api('/api/socialV2/state?key=' + encodeURIComponent(key));
            document.getElementById('v2StateOutput').textContent = JSON.stringify(r, null, 2);
        }
        V2Settings.viewV2State = viewV2State;
    })(V2Settings = QQConsole.V2Settings || (QQConsole.V2Settings = {}));
})(QQConsole || (QQConsole = {}));
