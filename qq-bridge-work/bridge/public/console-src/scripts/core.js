var QQConsole;
(function (QQConsole) {
    var Core;
    (function (Core) {
        (function () {
            // 如果通过 ?token= 进入（控制台启用鉴权时根路径会重定向带 token），存到 localStorage
            const qs = new URLSearchParams(location.search);
            const token = qs.get('token');
            if (token) {
                localStorage.setItem('consoleToken', token);
                history.replaceState({}, '', location.pathname + location.hash);
            }
        })();
        async function api(path, method, body, _retried = 0) {
            const headers = body ? { 'content-type': 'application/json' } : {};
            const token = localStorage.getItem('consoleToken');
            if (token)
                headers['x-console-token'] = token;
            const res = await fetch(path, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
            if (res.status === 401) {
                if (_retried >= 2) {
                    localStorage.removeItem('consoleToken');
                    throw new Error('未授权');
                }
                const t = prompt('请输入控制台访问令牌：');
                if (t) {
                    localStorage.setItem('consoleToken', t.trim());
                    return api(path, method, body, _retried + 1);
                }
                localStorage.removeItem('consoleToken');
                throw new Error('未授权');
            }
            return res.json();
        }
        Core.api = api;
        function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
        Core.esc = esc;
        // 上游静默时长的人话渲染：只用于 QQ 网关健康提示（秒 / 分钟 / 小时）。
        function fmtAgoMs(ms) {
            if (ms === null || ms === undefined || ms === '')
                return '未知';
            const n = Number(ms);
            if (!Number.isFinite(n) || n < 0)
                return '未知';
            if (n < 1000)
                return '刚刚';
            if (n < 60_000)
                return Math.round(n / 1000) + ' 秒';
            if (n < 3_600_000)
                return Math.round(n / 60_000) + ' 分钟';
            if (n < 86_400_000)
                return Math.round(n / 3_600_000) + ' 小时';
            return Math.round(n / 86_400_000) + ' 天';
        }
        // QQ 网关健康；保留旧DOM ID和状态字段以兼容现有接口。
        // 旧版桥接的 /api/status 没有 snowluma 字段，一律当「未知」处理，不抛错。
        function renderSnowlumaHealth(sl) {
            const el = document.getElementById('snowlumaWarn');
            const strong = document.getElementById('metricSnowluma');
            const hint = document.getElementById('metricSnowlumaHint');
            if (!el || !strong || !hint)
                return;
            if (!sl || typeof sl !== 'object') {
                el.style.display = 'none';
                strong.textContent = '未知';
                strong.className = '';
                hint.textContent = '桥接未上报上游健康（旧版桥接）';
                return;
            }
            const degraded = sl.degraded === true;
            const connected = sl.connected === true;
            const ago = sl.lastPacketAgoMs;
            const receiving = Number.isFinite(ago);
            const goodText = sl.good === true ? 'good=true' : sl.good === false ? 'good=false' : 'good 未知';
            if (degraded) {
                strong.textContent = '已连接 · 未接收';
                strong.className = 'err';
                hint.textContent = '网关连着，但 QQ 侧数据没到';
            }
            else if (!connected) {
                strong.textContent = '未连接';
                strong.className = 'err';
                hint.textContent = '连不上 QQ 网关，请检查服务状态和 QQ 登录状态';
            }
            else {
                strong.textContent = '正常 · 接收中';
                strong.className = 'ok';
                hint.textContent = (receiving ? '最近一份上游事件包在 ' + fmtAgoMs(ago) + '前 · ' : '')
                    + (sl.good === false ? 'good=false' : sl.good === true ? 'good=true' : 'good 未上报');
            }
            if (!degraded) {
                el.style.display = 'none';
                return;
            }
            document.getElementById('snowlumaWarnHint').textContent = sl.hint
                || '桥接与 QQ 网关的 WebSocket 连着，但一直收不到 QQ 侧的数据。';
            document.getElementById('snowlumaWarnPkt').textContent = (receiving ? fmtAgoMs(ago) + '前' : '从未收到')
                + (sl.lastPacketKind ? '（' + sl.lastPacketKind + '）' : '');
            document.getElementById('snowlumaWarnGood').textContent = goodText;
            el.style.display = '';
        }
        Core.renderSnowlumaHealth = renderSnowlumaHealth;
        async function refresh() {
            try {
                const s = await api('/api/status');
                document.querySelectorAll('#modeRow button').forEach(b => (b.classList.toggle('active', b.dataset.mode === s.mode), b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode))));
                document.getElementById('roleText').textContent = s.role || '无';
                document.getElementById('roleModeText').textContent = s.roleMode === 'silent' ? '静默' : '正常';
                const modeLabel = s.mode === 'reserved' ? '一代仿真模式' : s.mode === 'reserved2' ? '二代仿真模式' : s.mode === 'closed-agent' ? '封闭 Agent' : '聊天模式';
                QQConsole.Navigation.updateOverview(s, modeLabel);
                document.getElementById('activity').textContent = s.activity || '（空）';
                const presetSel = document.getElementById('closedPreset');
                if (presetSel && document.activeElement !== presetSel)
                    presetSel.value = s.closedAgentPreset || '';
            }
            catch (e) {
                document.getElementById('statusText').textContent = '连接中断 · 请检查桥接服务';
                QQConsole.Navigation.setConnectionError(e);
            }
        }
        Core.refresh = refresh;
        async function refreshPresets() {
            try {
                const r = await api('/api/presets');
                const sel = document.getElementById('closedPreset');
                sel.innerHTML = '';
                // 空值 = 使用 DSH 自己声明的默认 preset（closed-agent 的推荐选择）
                const defOpt = document.createElement('option');
                defOpt.value = '';
                defOpt.textContent = '（DSH 默认 preset）';
                sel.appendChild(defOpt);
                for (const p of r.presets) {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.id + (p.trust === 'user' ? '（用户）' : '');
                    sel.appendChild(opt);
                }
                refresh();
            }
            catch { }
        }
        Core.refreshPresets = refreshPresets;
        async function saveMode(mode) {
            // 不再硬编码 'router-standard'（DSH 0.1.5 已无此 preset）；
            // 留空表示让桥接使用 DSH 自己声明的默认 preset。
            const preset = document.getElementById('closedPreset').value || '';
            const r = await api('/api/mode', 'POST', { mode, closedAgentPreset: preset });
            if (r.ok) {
                refresh();
                // 桥接会把模式写穿到 DSH 设置；写穿失败时本地值会在下一次 5 秒轮询被覆盖回滚。
                // 不提示的话用户只会看到「刚切过去又自己变回来了」，无从判断原因。
                if (r.dshSynced === false) {
                    alert('模式已写入本地，但未能同步到 DSH 设置（DSH 未运行？）——\n下一次轮询（约 5 秒）会把模式改回去。请检查 DSH 与桥接日志。');
                }
            }
            else {
                alert(r.error || '切换失败');
            }
            return r;
        }
        Core.saveMode = saveMode;
    })(Core = QQConsole.Core || (QQConsole.Core = {}));
})(QQConsole || (QQConsole = {}));
