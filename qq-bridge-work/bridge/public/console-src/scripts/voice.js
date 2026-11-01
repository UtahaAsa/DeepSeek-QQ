var QQConsole;
(function (QQConsole) {
    var Voice;
    (function (Voice) {
        // ── 语音库与语音发送（调试面板） ───────────────────────────────────────────
        // 试发走 /api/voice/send（操作者通道，凭控制台令牌），与 CLI 同一条路径 ——
        // 所以这里能验证「白名单 / 时长体积上限 / 限流 / 文件名审计」是不是真的生效。
        let voiceEntries = [];
        let voiceLibraryLoaded = false;
        // 只在首次进入/手动刷新时拉取：语音库会逐个 ffprobe 探测时长，放进 3 秒轮询会白白压网关。
        async function loadVoiceLibrary(force) {
            if (voiceLibraryLoaded && force !== true)
                return;
            const box = document.getElementById('voiceList');
            const msg = document.getElementById('voiceMsg');
            try {
                const r = await QQConsole.Core.api('/api/voice/list?probe=1');
                voiceEntries = Array.isArray(r.voices) ? r.voices : [];
                voiceLibraryLoaded = true;
                if (!voiceEntries.length) {
                    box.innerHTML = '语音库是空的：把音频文件放进 <code>qq-bridge/audio/</code> 后点「刷新语音库」。';
                    return;
                }
                const limits = r.limits || {};
                box.innerHTML = '共 ' + voiceEntries.length + ' 个（上限：' + (limits.maxSeconds || '?') + ' 秒 / '
                    + Math.round((limits.maxBytes || 0) / 1024 / 1024) + ' MiB / ' + (limits.maxPerMinute || '?') + ' 每分钟）：<br>'
                    + voiceEntries.map((v, i) => {
                        const bad = v.ok === false;
                        // v.name / v.error / v.detail 来自语音库的文件名与探测结果，属于**外部数据**：
                        // 语音库目录里放一个名为 `x<img src=x onerror=...>.mp3` 的文件即可注入脚本
                        // （CSP 允许 unsafe-inline，拦不住内联事件处理器）。所有插值都必须过 esc()。
                        return '<label style="display:block;margin:2px 0">'
                            + '<input type="radio" name="voicePick" value="' + i + '"' + (i === 0 ? ' checked' : '') + '> '
                            + '<code>' + QQConsole.Core.esc(v.name) + '</code> ' + (bad ? '❌ ' + QQConsole.Core.esc(v.error || '不可用') : QQConsole.Core.esc(v.detail || ''))
                            + '</label>';
                    }).join('');
            }
            catch (error) {
                box.textContent = '加载失败：' + (error && error.message ? error.message : error);
            }
            if (msg)
                msg.textContent = '';
        }
        Voice.loadVoiceLibrary = loadVoiceLibrary;
        async function sendVoiceFromConsole() {
            const msg = document.getElementById('voiceMsg');
            const target = document.getElementById('voiceSendTarget').value.trim();
            const dryRun = document.getElementById('voiceSendDryRun').checked;
            const pick = document.querySelector('input[name="voicePick"]:checked');
            if (!target) {
                msg.textContent = '❌ 请填发送目标（如 group:100005）';
                msg.className = 'meta err';
                return;
            }
            if (!pick) {
                msg.textContent = '❌ 先刷新语音库并选中一个音频';
                msg.className = 'meta err';
                return;
            }
            const entry = voiceEntries[Number(pick.value)];
            msg.textContent = '发送中…';
            msg.className = 'meta';
            try {
                const r = await QQConsole.Core.api('/api/voice/send', 'POST', { target, file: entry.name, dryRun });
                if (r.dryRun) {
                    msg.textContent = '✅ 校验通过（未发送）：' + (r.detail || '');
                    msg.className = 'meta ok';
                }
                else if (r.ok) {
                    msg.textContent = '✅ 已发出 messageId=' + (r.messageId ?? '?')
                        + (r.detail ? '（' + r.detail + '）' : '')
                        + (r.verified ? '，已回读校验为语音段' : '，未能回读校验');
                    msg.className = 'meta ok';
                }
                else {
                    msg.textContent = '❌ ' + (r.error || '失败');
                    msg.className = 'meta err';
                }
            }
            catch (error) {
                msg.textContent = '❌ ' + (error && error.message ? error.message : error);
                msg.className = 'meta err';
            }
        }
        Voice.sendVoiceFromConsole = sendVoiceFromConsole;
    })(Voice = QQConsole.Voice || (QQConsole.Voice = {}));
})(QQConsole || (QQConsole = {}));
