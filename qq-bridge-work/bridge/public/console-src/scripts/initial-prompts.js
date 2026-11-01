var QQConsole;
(function (QQConsole) {
    var InitialPrompts;
    (function (InitialPrompts) {
        // ── 初始提示词（每个会话一份，只在 AI 首次唤醒时注入一次） ────────────────────
        const v2InitPromptTextEl = document.getElementById('v2InitPromptText');
        function v2InitPromptKeyValue() { return document.getElementById('v2InitPromptKey').value.trim(); }
        function setV2InitPromptMsg(text, kind) {
            const msg = document.getElementById('v2InitPromptMsg');
            msg.textContent = text;
            msg.className = 'meta' + (kind ? ' ' + kind : '');
        }
        function updateV2InitPromptCount() {
            document.getElementById('v2InitPromptCount').textContent = String(v2InitPromptTextEl.value.length);
        }
        function applyV2InitPromptMax(maxChars) {
            const max = Math.round(Number(maxChars));
            if (!Number.isFinite(max) || max <= 0)
                return;
            document.getElementById('v2InitPromptMax').textContent = String(max);
            v2InitPromptTextEl.maxLength = max;
        }
        function renderV2InitPromptEntries(entries) {
            const box = document.getElementById('v2InitPromptList');
            if (!Array.isArray(entries) || !entries.length) {
                box.textContent = '（还没有任何会话设置初始提示词）';
                return;
            }
            box.innerHTML = entries.map((e) => {
                const when = Number(e.updatedAt) > 0 ? new Date(Number(e.updatedAt)).toLocaleString() : '未知时间';
                return `<div style="margin:3px 0"><code>${QQConsole.Core.esc(e.key)}</code> · ${Number(e.chars) || 0} 字符 · ${QQConsole.Core.esc(when)} <button class="small" data-init-prompt-key="${QQConsole.Core.esc(e.key)}">编辑</button></div>`;
            }).join('');
        }
        async function loadV2InitialPrompt() {
            const key = v2InitPromptKeyValue();
            setV2InitPromptMsg('加载中…');
            try {
                const r = await QQConsole.Core.api('/api/socialV2/initial-prompt' + (key ? '?key=' + encodeURIComponent(key) : ''));
                if (!r.ok) {
                    setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err');
                    return;
                }
                applyV2InitPromptMax(r.maxChars);
                const readOnly = r.writable === false;
                if (!key) {
                    renderV2InitPromptEntries(r.entries);
                    setV2InitPromptMsg(readOnly ? '⚠️ 文件不可写（只读降级），只显示已有内容' : `✅ 共 ${(r.entries || []).length} 条`, readOnly ? 'err' : 'ok');
                    return;
                }
                v2InitPromptTextEl.value = r.text || '';
                updateV2InitPromptCount();
                document.getElementById('v2InitPromptList').textContent = r.exists
                    ? '该会话已设置初始提示词；再点「保存」会覆盖。'
                    : '该会话还没有设置初始提示词；填写后点「保存」新建。';
                if (readOnly)
                    setV2InitPromptMsg('⚠️ 文件不可写（只读降级）：能看不能存', 'err');
                else
                    setV2InitPromptMsg(r.exists ? '✅ 已加载' : '（空）', r.exists ? 'ok' : '');
            }
            catch (e) {
                setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
            }
        }
        async function saveV2InitialPrompt() {
            const key = v2InitPromptKeyValue();
            if (!key) {
                setV2InitPromptMsg('请输入会话 key（group:群号 或 private:QQ号）', 'err');
                return;
            }
            setV2InitPromptMsg('保存中…');
            try {
                const r = await QQConsole.Core.api('/api/socialV2/initial-prompt', 'POST', { key, text: v2InitPromptTextEl.value });
                if (!r.ok) {
                    setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err');
                    return;
                }
                applyV2InitPromptMax(r.maxChars);
                if (r.deleted) {
                    v2InitPromptTextEl.value = '';
                    updateV2InitPromptCount();
                    setV2InitPromptMsg('✅ 内容为空，已删除该会话的初始提示词', 'ok');
                }
                else {
                    setV2InitPromptMsg(`✅ 已保存（${r.chars} 字符），该会话下一次首次唤醒时注入`, 'ok');
                }
            }
            catch (e) {
                setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
            }
        }
        document.getElementById('v2InitPromptLoad').addEventListener('click', loadV2InitialPrompt);
        document.getElementById('v2InitPromptSave').addEventListener('click', saveV2InitialPrompt);
        document.getElementById('v2InitPromptClear').addEventListener('click', async () => {
            const key = v2InitPromptKeyValue();
            if (!key) {
                setV2InitPromptMsg('请输入会话 key', 'err');
                return;
            }
            if (!confirm(`确定删除 ${key} 的初始提示词？`))
                return;
            try {
                const r = await QQConsole.Core.api('/api/socialV2/initial-prompt', 'POST', { key, delete: true });
                if (!r.ok) {
                    setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err');
                    return;
                }
                v2InitPromptTextEl.value = '';
                updateV2InitPromptCount();
                setV2InitPromptMsg('✅ 已删除', 'ok');
            }
            catch (e) {
                setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
            }
        });
        v2InitPromptTextEl.addEventListener('input', updateV2InitPromptCount);
        document.getElementById('v2InitPromptList').addEventListener('click', (ev) => {
            const btn = ev.target.closest('button[data-init-prompt-key]');
            if (!btn)
                return;
            document.getElementById('v2InitPromptKey').value = btn.dataset.initPromptKey || '';
            loadV2InitialPrompt();
        });
    })(InitialPrompts = QQConsole.InitialPrompts || (QQConsole.InitialPrompts = {}));
})(QQConsole || (QQConsole = {}));
