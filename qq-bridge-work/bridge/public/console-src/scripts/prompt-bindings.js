var QQConsole;
(function (QQConsole) {
    var PromptBindings;
    (function (PromptBindings) {
        // ── 仿真提示词 ──────────────────────────────────────────────────────────────
        document.getElementById('simPromptEdit').addEventListener('click', () => {
            QQConsole.PromptEditor.setSimEditing(true);
            QQConsole.PromptEditor.setSimMsg('编辑中：改完点「保存并同步到 DSH」。保存会先备份，并做 YAML 与安全不变量校验。');
        });
        document.getElementById('simPromptCancel').addEventListener('click', () => {
            document.getElementById('simPromptText').value = QQConsole.PromptEditor.simPromptOriginal;
            QQConsole.PromptEditor.setSimEditing(false);
            QQConsole.PromptEditor.setSimMsg('已放弃修改');
        });
        document.getElementById('simPromptPreset').addEventListener('change', () => { QQConsole.PromptEditor.refreshSimPrompt(); });
        document.getElementById('simPromptSave').addEventListener('click', async () => {
            const content = document.getElementById('simPromptText').value;
            if (!confirm('保存会改写该代预设的源文件并同步到 DSH 的 preset 目录（新会话生效，进行中的会话需重置或重启 DSH）。确定继续？'))
                return;
            QQConsole.PromptEditor.setSimMsg('保存中…');
            const r = await QQConsole.Core.api('/api/preset/sim-prompt', 'POST', { preset: QQConsole.PromptEditor.simPromptPreset, content });
            if (!r.ok) {
                QQConsole.PromptEditor.setSimMsg('❌ ' + (r.error || '保存失败'), false);
                return;
            }
            if (r.unchanged) {
                QQConsole.PromptEditor.simPromptOriginal = content;
                QQConsole.PromptEditor.setSimEditing(false);
                QQConsole.PromptEditor.setSimMsg('内容没有变化，未写入文件（避免无谓地重排预设格式）', true);
                return;
            }
            QQConsole.PromptEditor.simPromptOriginal = content;
            QQConsole.PromptEditor.setSimEditing(false);
            QQConsole.PromptEditor.setSimMsg(`✅ 已保存${r.synced ? '并同步到 DSH' : ''}；重启 DSH 后生效`, true);
            document.getElementById('simPromptWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings.join('；') : '';
            document.getElementById('simPromptStatus').textContent = `${r.status?.label || QQConsole.PromptEditor.simPromptPreset} · ${content.length} 字符 · 已保存，待重启 DSH`;
        });
        document.getElementById('simPromptRestore').addEventListener('click', async () => {
            if (!confirm('还原到该代预设上一次保存前的备份？当前改动会丢失（原文件会先自动备份）。'))
                return;
            const r = await QQConsole.Core.api('/api/preset/sim-prompt/restore', 'POST', { preset: QQConsole.PromptEditor.simPromptPreset });
            if (!r.ok) {
                QQConsole.PromptEditor.setSimMsg('❌ ' + (r.error || '还原失败'), false);
                return;
            }
            QQConsole.PromptEditor.setSimMsg(`✅ 已还原（${r.restoredFrom}）；重启 DSH 后生效`, true);
            QQConsole.PromptEditor.refreshSimPrompt();
        });
        // ── 人格注入上限 ────────────────────────────────────────────────────────────
        document.getElementById('roleInjectMaxSave').addEventListener('click', async () => {
            const msg = document.getElementById('roleInjectMaxMsg');
            const value = Number(document.getElementById('roleInjectMax').value);
            if (!Number.isFinite(value) || value < 1000 || value > 20000) {
                msg.textContent = '请输入 1000~20000 之间的整数';
                msg.className = 'meta err';
                return;
            }
            const r = await QQConsole.Core.api('/api/roles/limit', 'POST', { maxInjectChars: value });
            msg.textContent = r.ok ? `✅ 已设为 ${r.maxInjectChars} 字符，下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                QQConsole.Roles.refreshRoles();
        });
    })(PromptBindings = QQConsole.PromptBindings || (QQConsole.PromptBindings = {}));
})(QQConsole || (QQConsole = {}));
