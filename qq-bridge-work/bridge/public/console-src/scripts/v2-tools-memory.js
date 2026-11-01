var QQConsole;
(function (QQConsole) {
    var V2ToolsMemory;
    (function (V2ToolsMemory) {
        function v2ToolLogStatus(entry) {
            if (entry.type === 'result') {
                const ok = entry.ok !== false;
                return `<span class="pill ${ok ? 'g' : 'r'}">${ok ? '成功' : '失败'}</span>`;
            }
            return '<span class="pill b">调用</span>';
        }
        function summarizeToolArgs(tool, args) {
            let obj = args;
            if (typeof args === 'string') {
                try {
                    obj = JSON.parse(args);
                }
                catch {
                    return args || '';
                }
            }
            if (!obj || typeof obj !== 'object')
                return String(obj ?? '');
            const parts = [];
            const push = (k, v) => {
                if (v === undefined || v === null || v === '')
                    return;
                parts.push(`${k}=${v}`);
            };
            const t = String(tool || '');
            if (t.includes('qq_set_wake_config')) {
                const cfg = (obj.config && typeof obj.config === 'object') ? obj.config : obj;
                push('mode', cfg.mode);
                push('infinite', cfg.infinite);
                const sleepUntil = cfg.sleepUntil || obj.sleepUntil;
                const sleepMs = cfg.sleepMs !== undefined ? cfg.sleepMs : obj.sleepMs;
                if (sleepUntil)
                    push('sleepUntil', sleepUntil);
                else if (sleepMs !== undefined)
                    push('sleepMs', sleepMs + 'ms');
                else
                    push('sleep', '未设置时间');
                const tr = (cfg.triggers && typeof cfg.triggers === 'object') ? cfg.triggers : {};
                const trigs = [];
                if (tr.atMention)
                    trigs.push('@');
                if (tr.nameMention)
                    trigs.push('名字');
                if (tr.question)
                    trigs.push('提问');
                if (tr.poke)
                    trigs.push('拍一拍');
                if (Array.isArray(tr.keywords) && tr.keywords.length)
                    trigs.push('关键词:' + tr.keywords.join(','));
                if (Array.isArray(tr.speakerIds) && tr.speakerIds.length)
                    trigs.push('指定成员:' + tr.speakerIds.join(','));
                if (tr.anyMessage)
                    trigs.push('anyMessage');
                if (Number(tr.probability) > 0)
                    trigs.push('概率:' + tr.probability);
                if (trigs.length)
                    push('triggers', trigs.join('|'));
            }
            else if (t.includes('qq_wait_for_messages')) {
                push('timeoutMs', obj.timeoutMs != null ? obj.timeoutMs : '默认30000');
                push('minNewMessages', obj.minNewMessages != null ? obj.minNewMessages : 1);
                push('quietMs', obj.quietMs != null ? obj.quietMs : '默认8000');
            }
            else if (t.includes('qq_send_message')) {
                const msgs = Array.isArray(obj.messages) ? obj.messages : (obj.messages != null ? [obj.messages] : []);
                push('条数', msgs.length);
                if (msgs.length)
                    push('首条', String(msgs[0]).slice(0, 30));
                push('gapMode', obj.gapMode || 'auto');
                if (obj.gapMs != null)
                    push('gapMs', obj.gapMs);
                if (Array.isArray(obj.gaps) && obj.gaps.length)
                    push('gaps', obj.gaps.join(','));
                if (obj.replyToMessageId != null && obj.replyToMessageId !== '')
                    push('引用id', obj.replyToMessageId);
            }
            else if (t.includes('qq_send_burst')) {
                const msgs = Array.isArray(obj.messages) ? obj.messages : [];
                push('条数', msgs.length);
                if (msgs.length)
                    push('首条', String(msgs[0]).slice(0, 30));
            }
            else if (t.includes('qq_send_poke')) {
                push('key', obj.key);
                if (obj.targetUserId != null && obj.targetUserId !== '')
                    push('target', obj.targetUserId);
            }
            else if (t.includes('qq_get_forward_msg')) {
                push('key', obj.key);
                if (obj.id != null && obj.id !== '')
                    push('id', String(obj.id).slice(0, 40));
            }
            else if (t.includes('qq_mark_read')) {
                push('key', obj.key);
            }
            else if (t.includes('qq_get_prompt') || t.includes('qq_get_unread_messages') || t.includes('qq_get_recent_messages') || t.includes('qq_social_state') || t.includes('qq_get_my_recent_messages') || t.includes('qq_get_message_detail') || t.includes('qq_get_active_members')) {
                push('key', obj.key);
                if (obj.messageId != null)
                    push('messageId', obj.messageId);
                if (obj.limit != null)
                    push('limit', obj.limit);
            }
            else {
                push('key', obj.key);
            }
            return parts.join(' | ') || JSON.stringify(obj);
        }
        function v2ToolLogCell(value, tool) {
            const text = value == null ? '' : String(value);
            if (!text)
                return '<span class="meta">-</span>';
            const summary = tool ? summarizeToolArgs(tool, text) : text;
            const short = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;
            return `<span class="tool-log-cell" data-full="${QQConsole.Core.esc(text)}" data-short="${QQConsole.Core.esc(short)}" title="点击查看完整 JSON">${QQConsole.Core.esc(short)}</span>`;
        }
        function renderV2ToolLog(entries) {
            const box = document.getElementById('v2ToolLogOutput');
            const list = entries || [];
            if (!list.length) {
                box.innerHTML = '<span class="meta">（空）</span>';
                return;
            }
            let html = '<table><tr><th>时间</th><th>会话 key</th><th>工具名</th><th>状态</th><th>参数</th><th>错误信息</th></tr>';
            for (const e of list) {
                const time = e.time ? new Date(e.time).toLocaleString() : '-';
                const key = QQConsole.Core.esc(e.key || '');
                const tool = QQConsole.Core.esc(e.tool || '-');
                const status = v2ToolLogStatus(e);
                const params = e.type === 'call' ? v2ToolLogCell(e.args, e.tool) : '<span class="meta">-</span>';
                const error = e.type === 'result' ? v2ToolLogCell(e.error) : '<span class="meta">-</span>';
                html += `<tr><td>${QQConsole.Core.esc(time)}</td><td>${key}</td><td>${tool}</td><td>${status}</td><td>${params}</td><td>${error}</td></tr>`;
            }
            html += '</table>';
            box.innerHTML = html;
        }
        V2ToolsMemory.renderV2ToolLog = renderV2ToolLog;
        function loadV2ToolLog() {
            return QQConsole.Core.api('/api/socialV2/tool-log?limit=200')
                .then(r => { renderV2ToolLog(r.entries || []); })
                .catch(() => { renderV2ToolLog([]); });
        }
        V2ToolsMemory.loadV2ToolLog = loadV2ToolLog;
        document.getElementById('v2ToolLogOutput').addEventListener('click', (ev) => {
            const cell = ev.target.closest('.tool-log-cell');
            if (!cell)
                return;
            const full = cell.dataset.full;
            const short = cell.dataset.short;
            if (cell.classList.contains('expanded')) {
                cell.classList.remove('expanded');
                cell.textContent = short;
            }
            else {
                cell.classList.add('expanded');
                cell.textContent = full;
            }
        });
        function renderV2Memory(data) {
            const box = document.getElementById('v2MemoryOutput');
            if (!data || !data.ok) {
                box.innerHTML = '<span class="meta">加载失败</span>';
                return;
            }
            const raw = data.raw || {};
            const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
            const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
            const impressions = raw.memberImpressions && typeof raw.memberImpressions === 'object' ? raw.memberImpressions : {};
            let html = '<div style="padding:8px">';
            html += '<div class="memory-section"><b>进行中的话题</b> <button class="small" data-action="clear" data-cat="activeTopic">清空</button>';
            if (!topics.length)
                html += '<div class="meta">（空）</div>';
            for (const t of topics) {
                const text = QQConsole.Core.esc(String(t?.text || ''));
                const extra = t?.pendingQuestion ? `；待追问：${QQConsole.Core.esc(String(t.pendingQuestion))}` : '';
                html += `<div style="margin:4px 0">📌 ${text}${extra} <button class="small" data-action="edit" data-cat="activeTopic" data-content="${QQConsole.Core.esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="activeTopic" data-content="${QQConsole.Core.esc(String(t?.text || ''))}">删除</button></div>`;
            }
            html += '</div>';
            html += '<div class="memory-section"><b>你想说但还没说的</b> <button class="small" data-action="clear" data-cat="pendingThought">清空</button>';
            if (!thoughts.length)
                html += '<div class="meta">（空）</div>';
            for (const t of thoughts) {
                html += `<div style="margin:4px 0">💭 ${QQConsole.Core.esc(String(t?.text || ''))}${t?.motivation ? `（${QQConsole.Core.esc(String(t.motivation))}）` : ''} <button class="small" data-action="edit" data-cat="pendingThought" data-content="${QQConsole.Core.esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="pendingThought" data-content="${QQConsole.Core.esc(String(t?.text || ''))}">删除</button></div>`;
            }
            html += '</div>';
            html += '<div class="memory-section"><b>对群友的印象</b> <button class="small" data-action="clear" data-cat="memberImpression">清空</button>';
            const names = Object.keys(impressions);
            if (!names.length)
                html += '<div class="meta">（空）</div>';
            for (const name of names) {
                const im = impressions[name] || {};
                const traits = Array.isArray(im.traits) ? im.traits : [];
                html += `<div style="margin:4px 0">👤 ${QQConsole.Core.esc(name)}：${traits.length ? QQConsole.Core.esc(traits.join('、')) : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次） <button class="small" data-action="edit" data-cat="memberImpression" data-target="${QQConsole.Core.esc(name)}" data-traits="${QQConsole.Core.esc(traits.join(', '))}">编辑</button> <button class="small" data-action="remove" data-cat="memberImpression" data-target="${QQConsole.Core.esc(name)}">删除</button></div>`;
            }
            html += '</div></div>';
            box.innerHTML = html;
        }
        function loadV2Memory() {
            const key = document.getElementById('v2MemoryKey').value.trim();
            const msg = document.getElementById('v2MemoryMsg');
            if (!key) {
                msg.textContent = '请输入会话 key';
                msg.className = 'meta err';
                return;
            }
            msg.textContent = '加载中…';
            msg.className = 'meta';
            return QQConsole.Core.api('/api/socialV2/memory?key=' + encodeURIComponent(key))
                .then(r => {
                renderV2Memory(r);
                msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
                msg.className = r.ok ? 'meta ok' : 'meta err';
            })
                .catch((e) => {
                msg.textContent = '❌ ' + (e.message || e);
                msg.className = 'meta err';
            });
        }
        document.getElementById('v2MemoryLoad').addEventListener('click', loadV2Memory);
        document.getElementById('v2MemoryClearAll').addEventListener('click', async () => {
            const key = document.getElementById('v2MemoryKey').value.trim();
            const msg = document.getElementById('v2MemoryMsg');
            if (!key) {
                msg.textContent = '请输入会话 key';
                msg.className = 'meta err';
                return;
            }
            if (!confirm('确定清空该会话全部轻量记忆？'))
                return;
            const r = await QQConsole.Core.api('/api/socialV2/memory-clear', 'POST', { key, category: '' });
            msg.textContent = r.ok ? '✅ 已清空全部记忆' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                loadV2Memory();
        });
        document.getElementById('v2MemoryOutput').addEventListener('click', async (ev) => {
            const btn = ev.target.closest('button[data-action]');
            if (!btn)
                return;
            const key = document.getElementById('v2MemoryKey').value.trim();
            const msg = document.getElementById('v2MemoryMsg');
            if (!key) {
                msg.textContent = '请输入会话 key';
                msg.className = 'meta err';
                return;
            }
            const cat = btn.dataset.cat;
            const action = btn.dataset.action;
            let r;
            if (action === 'clear') {
                r = await QQConsole.Core.api('/api/socialV2/memory-clear', 'POST', { key, category: cat });
            }
            else if (action === 'edit') {
                let newContent;
                let newExtra = {};
                if (cat === 'memberImpression') {
                    const input = prompt(`编辑对 ${btn.dataset.target} 的印象特质（逗号分隔）：`, btn.dataset.traits || '');
                    if (input === null)
                        return;
                    newContent = input;
                }
                else {
                    const input = prompt(`编辑${cat === 'activeTopic' ? '话题' : '想法'}内容：`, btn.dataset.content || '');
                    if (input === null)
                        return;
                    newContent = input;
                }
                r = await QQConsole.Core.api('/api/socialV2/memory-update', 'POST', { key, category: cat, oldContent: btn.dataset.content || '', target: btn.dataset.target || '', newContent, newExtra });
            }
            else {
                r = await QQConsole.Core.api('/api/socialV2/memory-remove', 'POST', { key, category: cat, content: btn.dataset.content || '', target: btn.dataset.target || '' });
            }
            msg.textContent = r.ok ? '✅ 已更新' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                loadV2Memory();
        });
    })(V2ToolsMemory = QQConsole.V2ToolsMemory || (QQConsole.V2ToolsMemory = {}));
})(QQConsole || (QQConsole = {}));
