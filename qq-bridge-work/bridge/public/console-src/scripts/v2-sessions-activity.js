var QQConsole;
(function (QQConsole) {
    var V2SessionsActivity;
    (function (V2SessionsActivity) {
        async function loadV2SessionOptions() {
            const sel = document.getElementById('v2SessionSelect');
            const prev = sel.value;
            try {
                const r = await QQConsole.Core.api('/api/status');
                const groups = Array.isArray(r.allowGroups) ? r.allowGroups : [];
                const privates = Array.isArray(r.allowPrivate) ? r.allowPrivate : [];
                const options = [{ value: '', label: '选择白名单群/私聊…' }];
                for (const g of groups)
                    options.push({ value: 'group:' + g, label: '群 ' + g });
                for (const p of privates)
                    options.push({ value: 'private:' + p, label: '私聊 ' + p });
                sel.innerHTML = options.map((o) => `<option value="${QQConsole.Core.esc(o.value)}">${QQConsole.Core.esc(o.label)}</option>`).join('');
                if (prev && options.some((o) => o.value === prev))
                    sel.value = prev;
            }
            catch (e) {
                sel.innerHTML = '<option value="">无法加载白名单</option>';
            }
        }
        V2SessionsActivity.loadV2SessionOptions = loadV2SessionOptions;
        document.getElementById('v2SessionRefresh').addEventListener('click', loadV2SessionOptions);
        document.getElementById('v2SessionSelect').addEventListener('change', (ev) => {
            const key = ev.target.value;
            if (!key)
                return;
            document.getElementById('v2StateKey').value = key;
            document.getElementById('v2MemoryKey').value = key;
            document.getElementById('v2WakeKey').value = key;
            document.getElementById('v2InitPromptKey').value = key;
        });
        document.getElementById('v2ConfigSave').addEventListener('click', QQConsole.V2Settings.saveV2Config);
        document.getElementById('v2ConfigSaveTop').addEventListener('click', QQConsole.V2Settings.saveV2Config);
        document.getElementById('voiceRefreshBtn').addEventListener('click', () => QQConsole.Voice.loadVoiceLibrary(true));
        document.getElementById('voiceSendBtn').addEventListener('click', QQConsole.Voice.sendVoiceFromConsole);
        async function refreshV2Activity() {
            try {
                const r = await QQConsole.Core.api('/api/socialV2/activity');
                const el = document.getElementById('v2ActivityStatus');
                el.textContent = r.paused ? '已暂停' : '运行中';
                el.className = r.paused ? 'meta err' : 'meta ok';
            }
            catch { }
        }
        V2SessionsActivity.refreshV2Activity = refreshV2Activity;
        document.getElementById('v2PauseBtn').addEventListener('click', async () => {
            await QQConsole.Core.api('/api/socialV2/activity', 'POST', { paused: true });
            refreshV2Activity();
        });
        document.getElementById('v2ResumeBtn').addEventListener('click', async () => {
            await QQConsole.Core.api('/api/socialV2/activity', 'POST', { paused: false });
            refreshV2Activity();
        });
        document.getElementById('v2ResetBtn').addEventListener('click', async () => {
            if (!confirm('确定重置二代 AI 状态？\n将清空所有二代会话、唤醒配置、未读消息和定时器；工具调用日志会保留。'))
                return;
            const r = await QQConsole.Core.api('/api/socialV2/reset', 'POST', {});
            const msg = document.getElementById('v2ConfigMsg');
            msg.textContent = r.ok ? '✅ 已重置二代状态' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            refreshV2Activity();
            document.getElementById('v2AllStatesOutput').textContent = '（全部会话状态：空）';
            document.getElementById('v2StateOutput').textContent = '（空）';
        });
        document.getElementById('v2StateView').addEventListener('click', QQConsole.V2Settings.viewV2State);
        document.getElementById('v2ForceWake').addEventListener('click', async () => {
            const key = document.getElementById('v2StateKey').value.trim();
            if (!key) {
                alert('请输入会话 key');
                return;
            }
            const r = await QQConsole.Core.api('/api/socialV2/wake', 'POST', { key, reason: 'admin' });
            const msg = document.getElementById('v2ConfigMsg');
            msg.textContent = r.ok ? '✅ 已发送唤醒' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
        });
        document.getElementById('v2StatesList').addEventListener('click', async () => {
            const r = await QQConsole.Core.api('/api/socialV2/states');
            document.getElementById('v2AllStatesOutput').textContent = JSON.stringify(r.conversations || [], null, 2);
        });
        document.getElementById('v2FeedbackLoad').addEventListener('click', async () => {
            const r = await QQConsole.Core.api('/api/socialV2/feedback');
            document.getElementById('v2FeedbackOutput').textContent = JSON.stringify(r.entries || [], null, 2);
        });
        document.getElementById('v2FeedbackClear').addEventListener('click', async () => {
            if (!confirm('确定清空全部 AI 反馈？'))
                return;
            const r = await QQConsole.Core.api('/api/socialV2/feedback-clear', 'POST', {});
            const msg = document.getElementById('v2FeedbackMsg');
            msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                document.getElementById('v2FeedbackOutput').textContent = '（空）';
        });
        document.getElementById('v2ToolLogLoad').addEventListener('click', async () => {
            const msg = document.getElementById('v2ToolLogMsg');
            msg.textContent = '';
            await QQConsole.V2ToolsMemory.loadV2ToolLog();
        });
        document.getElementById('v2ToolLogClear').addEventListener('click', async () => {
            if (!confirm('确定清空全部工具调用日志？'))
                return;
            const r = await QQConsole.Core.api('/api/socialV2/tool-log/clear', 'POST', {});
            const msg = document.getElementById('v2ToolLogMsg');
            msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            QQConsole.V2ToolsMemory.renderV2ToolLog([]);
        });
    })(V2SessionsActivity = QQConsole.V2SessionsActivity || (QQConsole.V2SessionsActivity = {}));
})(QQConsole || (QQConsole = {}));
