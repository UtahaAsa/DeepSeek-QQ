var QQConsole;
(function (QQConsole) {
    var SettingsLoaders;
    (function (SettingsLoaders) {
        // ── DSH 模型与思考强度 ──────────────────────────────────────────────────────
        async function refreshDshModel() {
            try {
                const r = await QQConsole.Core.api('/api/dsh/model');
                document.getElementById('dshModelText').textContent = r.model || '-';
                document.getElementById('dshProviderText').textContent = r.provider || '-';
                const select = document.getElementById('dshEffortSelect');
                const labels = r.labels || {};
                select.replaceChildren();
                for (const option of (r.options || [])) {
                    const el = document.createElement('option');
                    el.value = option;
                    const info = labels[option] || {};
                    const isDefault = option === (r.providerDefault || r.default);
                    el.textContent = `${option}${isDefault ? '（默认）' : ''}`;
                    if (info.description)
                        el.title = info.description;
                    select.appendChild(el);
                }
                select.value = r.reasoningEffort;
                const parts = [];
                if (r.providerDefault)
                    parts.push(`DSH 出厂默认是 ${r.providerDefault}`);
                parts.push(r.catalogSource === 'dsh' ? '档位取自 DSH 实际公布的能力' : '未能读取 DSH 能力，档位为内置清单');
                document.getElementById('dshEffortNote').textContent = parts.join('；') + '。';
                document.getElementById('dshEffortSideEffect').textContent = r.globalSideEffect
                    ? '注意：切换会同时写入 DSH 的全局默认（~/.dsh/settings.yaml 的 agent-default-model），也就是 Web GUI 里新建会话的默认强度也会跟着变。'
                    : '';
                document.getElementById('dshEffortMsg').textContent = '';
            }
            catch (error) {
                document.getElementById('dshEffortMsg').textContent = '读取失败：' + (error?.message ?? error);
            }
        }
        SettingsLoaders.refreshDshModel = refreshDshModel;
        async function refreshWhitelist() {
            try {
                const w = await QQConsole.Core.api('/api/whitelist');
                document.getElementById('wlGroups').value = (w.allow.groups || []).join(', ');
                document.getElementById('wlPrivate').value = (w.allow.private || []).join(', ');
                document.getElementById('ownerQQ').value = w.ownerQQ != null ? String(w.ownerQQ) : '';
                document.getElementById('dnGroups').value = (w.deny.groups || []).join(', ');
                document.getElementById('dnPrivate').value = (w.deny.private || []).join(', ');
            }
            catch { }
        }
        SettingsLoaders.refreshWhitelist = refreshWhitelist;
        async function refreshSessions() {
            try {
                const s = await QQConsole.Core.api('/api/sessions');
                const box = document.getElementById('sessionList');
                document.getElementById('metricSessions').textContent = s.sessions.length;
                if (!s.sessions.length) {
                    box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息后，会话会显示在这里。</p></div>';
                    return;
                }
                let html = '<table><tr><th>QQ 会话</th><th>DSH 会话 ID</th><th>类型</th><th></th></tr>';
                for (const x of s.sessions) {
                    const isP = x.key.startsWith('private:');
                    const type = isP ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
                    const ownerTag = x.owner ? ' <span class="pill r">管理员</span>' : '';
                    html += `<tr><td>${QQConsole.Core.esc(x.key)}${ownerTag}</td><td><code>${QQConsole.Core.esc(x.sessionId)}</code></td><td>${type}</td><td><button class="small" data-reset-key="${QQConsole.Core.esc(x.key)}">清除上下文</button></td></tr>`;
                }
                box.innerHTML = html + '</table>';
                box.querySelectorAll('[data-reset-key]').forEach(btn => btn.addEventListener('click', async () => {
                    if (!confirm('确定清除该会话的上下文？下次消息将开新会话。'))
                        return;
                    const r = await QQConsole.Core.api('/api/session/reset', 'POST', { key: btn.dataset.resetKey });
                    alert(r.ok ? '✅ 已清除上下文' : ('❌ ' + (r.error || '失败')));
                    refreshSessions();
                }));
            }
            catch { }
        }
        SettingsLoaders.refreshSessions = refreshSessions;
        async function refreshPending() {
            try {
                const p = await QQConsole.Core.api('/api/pending');
                const box = document.getElementById('pendingList');
                document.getElementById('metricPending').textContent = p.pending.length;
                document.getElementById('pendingCount').textContent = p.pending.length;
                if (!p.pending.length) {
                    box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>';
                    return;
                }
                let html = '<table><tr><th>会话</th><th>类型</th><th>详情</th></tr>';
                for (const x of p.pending) {
                    const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
                    let detail = '';
                    if (x.kind === 'approval')
                        detail = `${QQConsole.Core.esc(x.toolName)}${x.reason ? '：' + QQConsole.Core.esc(x.reason) : ''}`;
                    else if (x.questions)
                        detail = x.questions.map(q => QQConsole.Core.esc(q.question)).join(' / ');
                    html += `<tr><td>${QQConsole.Core.esc(x.key)}</td><td>${kind}</td><td>${detail}</td></tr>`;
                }
                box.innerHTML = html + '</table>';
            }
            catch { }
        }
        SettingsLoaders.refreshPending = refreshPending;
    })(SettingsLoaders = QQConsole.SettingsLoaders || (QQConsole.SettingsLoaders = {}));
})(QQConsole || (QQConsole = {}));
