var QQConsole;
(function (QQConsole) {
    var Navigation;
    (function (Navigation) {
        // Presentation layer: keep every existing control mounted so drafts and API contracts survive navigation.
        const consolePages = {
            overview: ['运行总览', '让每一次连接，都自然发生。', '掌握桥接状态，轻松管理你的 QQ 智能伙伴。'],
            sessions: ['会话与审批', '让每一段对话，都有迹可循。', '查看 QQ 与 DSH 的会话映射，以及等待你回复的审批和提问。'],
            persona: ['人格与角色', '给你的伙伴，一点独特个性。', '选择已有角色，或用自己的语言写下新的性格与表达方式。'],
            'social-v2': ['二代仿真', '自主参与，恰到好处。', '管理 AI 的工具、唤醒与发言节奏。展开需要调整的分组，修改后保存参数。'],
            'social-v1': ['一代仿真', '为自然对话，设定合适的节奏。', '调整参与概率、活跃周期和分条发送；所有配置项完整保留。'],
            slang: ['黑话词库', '读懂群聊里的，言外之意。', '从候选到确认，让 AI 逐渐熟悉大家的表达习惯。'],
            usage: ['令牌与花费', '每一次思考，都算得清楚。', '实时查看 AI 的 token 消耗与花费，可下钻到每个群、每个好友、每一轮对话。'],
            access: ['访问与安全', '明确边界，安心连接。', '管理允许对话的对象、管理员权限与控制台访问凭证。'],
            operations: ['调试与运维', '让桥接，始终井然有序。', '测试消息、引导 AI，或维护桥接进程与会话工作区。'],
            reference: ['工具参考', '每一种能力，都清晰可见。', '查看桥接提供给 DSH 的 MCP 工具与用途。']
        };
        Navigation.currentConsolePage = 'overview';
        let toastTimer;
        function showConsoleToast(message) {
            const toast = document.getElementById('consoleToast');
            toast.textContent = message;
            toast.hidden = false;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
        }
        Navigation.showConsoleToast = showConsoleToast;
        function setConsolePage(page, { updateHash = true, focus = false, target = '' } = {}) {
            if (!Object.hasOwn(consolePages, page))
                page = 'overview';
            Navigation.currentConsolePage = page;
            document.querySelectorAll('[data-page]').forEach(el => { el.hidden = el.dataset.page !== page; });
            document.querySelectorAll('#mainNav [data-view]').forEach(button => {
                const selected = button.dataset.view === page;
                button.classList.toggle('active', selected);
                if (selected)
                    button.setAttribute('aria-current', 'page');
                else
                    button.removeAttribute('aria-current');
            });
            document.getElementById('breadcrumbPage').textContent = consolePages[page][0];
            document.getElementById('pageTitle').textContent = consolePages[page][1];
            document.getElementById('pageDescription').textContent = consolePages[page][2];
            document.title = consolePages[page][0] + ' · QQ 桥接控制台';
            if (updateHash && location.hash !== '#' + page)
                history.pushState({}, '', '#' + page);
            closeConsoleSearch();
            // 语音库按需加载：进入二代仿真页时才探测（避免每次开控制台都压网关）。
            if (page === 'social-v2' && typeof QQConsole.Voice.loadVoiceLibrary === 'function')
                QQConsole.Voice.loadVoiceLibrary();
            if (focus) {
                document.getElementById('mainContent').focus({ preventScroll: true });
                document.getElementById(target || 'mainContent')?.scrollIntoView({ block: 'start', behavior: 'instant' });
            }
        }
        Navigation.setConsolePage = setConsolePage;
        document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
            setConsolePage(button.dataset.view, { focus: true, target: button.dataset.target });
        }));
        window.addEventListener('hashchange', () => {
            const page = location.hash.slice(1);
            if (Object.hasOwn(consolePages, page) || !page)
                setConsolePage(page, { updateHash: false });
        });
        document.querySelector('.skip-link').addEventListener('click', event => {
            event.preventDefault();
            document.getElementById('mainContent').focus();
            document.getElementById('mainContent').scrollIntoView({ block: 'start', behavior: 'instant' });
        });
        function updateOverview(status, modeLabel) {
            const connection = document.getElementById('statusText');
            connection.textContent = status.dshReady ? 'DSH 已连接' : 'DSH 未连接';
            connection.className = 'status-badge ' + (status.dshReady ? 'online' : 'offline');
            document.getElementById('metricDsh').textContent = status.dshReady ? '已连接' : '未连接';
            document.getElementById('metricDsh').className = status.dshReady ? 'ok' : 'err';
            document.getElementById('metricDshHint').textContent = status.dshReady ? '桥接状态已同步' : '请检查 DSH 是否运行';
            QQConsole.Core.renderSnowlumaHealth(status.snowluma);
            document.getElementById('metricMode').textContent = modeLabel.replace('模式', '');
            document.getElementById('metricRole').textContent = '角色 · ' + (status.role || '默认人格');
            document.getElementById('accessSummary').textContent = '管理员 ' + (status.ownerQQ || '未设置') + ' · ' + (status.allowGroups || []).length + ' 个白名单群 · ' + (status.allowPrivate || []).length + ' 位白名单好友';
            document.getElementById('lastUpdated').textContent = '状态同步于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
            document.getElementById('connectionAlert').hidden = true;
            const silent = status.roleMode === 'silent';
            for (const [id, active] of [['silentOn', silent], ['silentOff', !silent]]) {
                const button = document.getElementById(id);
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
            }
        }
        Navigation.updateOverview = updateOverview;
        function setConnectionError(error) {
            document.getElementById('statusText').className = 'status-badge offline';
            document.getElementById('metricDsh').textContent = '连接中断';
            document.getElementById('metricDsh').className = 'err';
            document.getElementById('metricDshHint').textContent = '当前状态可能已过期';
            // 上游健康也一起过期：桥接都联系不上时，别让上一次的 SnowLuma 结论继续挂着。
            document.getElementById('metricSnowluma').textContent = '未知';
            document.getElementById('metricSnowluma').className = '';
            document.getElementById('metricSnowlumaHint').textContent = '当前状态可能已过期';
            document.getElementById('snowlumaWarn').style.display = 'none';
            const alert = document.getElementById('connectionAlert');
            alert.textContent = error.message === '未授权' ? '访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。' : '无法连接桥接服务，当前显示的是上次同步结果。请检查桥接是否运行，再点击右上角刷新。';
            alert.hidden = false;
        }
        Navigation.setConnectionError = setConnectionError;
        document.getElementById('refreshConsole').addEventListener('click', async function () {
            this.disabled = true;
            await Promise.allSettled([QQConsole.Core.refresh(), QQConsole.SettingsLoaders.refreshSessions(), QQConsole.SettingsLoaders.refreshPending(), QQConsole.LegacySocial.refreshSocialStatus(), QQConsole.V2SessionsActivity.refreshV2Activity()]);
            this.disabled = false;
            if (document.getElementById('connectionAlert').hidden)
                showConsoleToast('运行状态已刷新');
        });
        // Attach real accessible names to the original form controls, including paired min/max inputs.
        document.querySelectorAll('input,select,textarea').forEach(input => {
            if (input.labels?.length || input.hasAttribute('aria-label'))
                return;
            let label = input.previousElementSibling;
            while (label && label.tagName !== 'LABEL')
                label = label.previousElementSibling;
            if (label) {
                const siblings = [];
                let next = label.nextElementSibling;
                while (next && next.tagName !== 'LABEL') {
                    if (next.matches('input,select,textarea'))
                        siblings.push(next);
                    next = next.nextElementSibling;
                }
                input.setAttribute('aria-label', label.textContent.trim() + (siblings.length > 1 ? (siblings.indexOf(input) === 0 ? '（下限）' : '（上限）') : ''));
            }
            else {
                const names = { consoleTokenInput: '新的控制台访问令牌', closedPreset: '封闭 Agent 使用的 DSH 预设', aiNotifyKind: '后台提醒目标类型', sStateKey: '一代仿真会话', v2SessionSelect: '二代仿真白名单会话', slangLimitCand: '候选词显示数量', slangLimitConfirmed: '已确认词显示数量', slangLimitRejected: '已拒绝词显示数量' };
                input.setAttribute('aria-label', names[input.id] || input.placeholder || input.closest('section')?.querySelector('h2')?.textContent || '设置');
            }
        });
        const primaryActions = ['roleSet', 'roleCreate', 'socialSave', 'v2ConfigSave', 'v2ConfigSaveTop', 'wlSave', 'secSave', 'consoleTokenSave', 'aiNotifySend', 'slangAdd', 'slangConfigSave', 'slangModalDirectConfirm'];
        primaryActions.forEach(id => document.getElementById(id)?.classList.add('primary'));
        document.querySelectorAll('.meta[id$="Msg"], .meta[id$="Msg2"]').forEach(el => el.setAttribute('role', 'status'));
        document.getElementById('section-mode').querySelector('h2').dataset.note = '选择后即时生效';
        document.getElementById('section-activity').querySelector('h2').dataset.note = '每 3 秒自动同步';
        const searchInput = document.getElementById('consoleSearch');
        const searchResults = document.getElementById('searchResults');
        const featureIndex = [];
        document.querySelectorAll('section[data-page]').forEach(section => {
            const page = section.dataset.page;
            featureIndex.push({ page, label: section.querySelector('h2').textContent, target: section });
            section.querySelectorAll('details.settings-group>summary,input,textarea,select').forEach(el => {
                let label = el.tagName === 'SUMMARY' ? el.textContent : (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.placeholder);
                if (label)
                    featureIndex.push({ page, label: label.trim(), target: el });
            });
        });
        function closeConsoleSearch() { searchResults.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); }
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            searchResults.replaceChildren();
            if (!query)
                return closeConsoleSearch();
            const matches = featureIndex.filter(entry => (consolePages[entry.page][0] + entry.label + entry.target.id).toLowerCase().includes(query)).slice(0, 12);
            if (!matches.length) {
                const empty = document.createElement('p');
                empty.textContent = '未找到匹配功能，试试「唤醒」「白名单」或「表情」。';
                searchResults.append(empty);
            }
            matches.forEach(entry => {
                const button = document.createElement('button');
                const title = document.createElement('span');
                title.textContent = entry.label;
                const caption = document.createElement('small');
                caption.textContent = consolePages[entry.page][0];
                button.append(title, caption);
                button.addEventListener('click', () => {
                    setConsolePage(entry.page);
                    let ancestor = entry.target.closest('details');
                    while (ancestor) {
                        ancestor.open = true;
                        ancestor = ancestor.parentElement.closest('details');
                    }
                    if (entry.target.closest('.slang-panel')) {
                        const panels = { slangPanelCandidate: 'candidate', slangPanelConfirmed: 'confirmed', slangPanelRejected: 'rejected' };
                        QQConsole.Slang.setSlangTab(panels[entry.target.closest('.slang-panel').id]);
                    }
                    entry.target.scrollIntoView({ block: 'center', behavior: 'instant' });
                    if (!entry.target.hasAttribute('tabindex') && !entry.target.matches('input,textarea,select,button,summary'))
                        entry.target.tabIndex = -1;
                    entry.target.focus({ preventScroll: true });
                    entry.target.classList.add('search-highlight');
                    setTimeout(() => entry.target.classList.remove('search-highlight'), 2000);
                });
                searchResults.append(button);
            });
            searchResults.hidden = false;
            searchInput.setAttribute('aria-expanded', 'true');
        });
        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Escape')
                closeConsoleSearch();
            if ((event.key === 'ArrowDown' || event.key === 'Enter') && !searchResults.hidden) {
                event.preventDefault();
                searchResults.querySelector('button')?.focus();
            }
        });
        document.addEventListener('click', event => { if (!event.target.closest('.search-wrap'))
            closeConsoleSearch(); });
        searchResults.addEventListener('keydown', event => { if (event.key === 'Escape') {
            closeConsoleSearch();
            searchInput.focus();
        } });
        // Keyboard support for the existing editor dialog without replacing its save flow.
        let modalPreviousFocus;
        const slangOverlay = document.getElementById('slangModalOverlay');
        new MutationObserver(() => {
            if (slangOverlay.classList.contains('open')) {
                modalPreviousFocus = document.activeElement;
                document.getElementById('slangModalMeaning').focus();
            }
            else
                modalPreviousFocus?.focus();
        }).observe(slangOverlay, { attributes: true, attributeFilter: ['class'] });
        slangOverlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                QQConsole.Slang.closeSlangModal();
            }
            if (event.key === 'Tab') {
                const controls = [...slangOverlay.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && el.getClientRects().length);
                const first = controls[0], last = controls.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                }
                else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });
        const tokenToggle = document.createElement('button');
        tokenToggle.id = 'consoleTokenToggle';
        tokenToggle.className = 'small';
        tokenToggle.textContent = '显示令牌';
        tokenToggle.type = 'button';
        tokenToggle.setAttribute('aria-pressed', 'false');
        tokenToggle.addEventListener('click', () => {
            const input = document.getElementById('consoleTokenInput');
            const visible = input.type === 'password';
            input.type = visible ? 'text' : 'password';
            tokenToggle.textContent = visible ? '隐藏令牌' : '显示令牌';
            tokenToggle.setAttribute('aria-pressed', String(visible));
        });
        document.getElementById('consoleTokenInput').after(tokenToggle);
    })(Navigation = QQConsole.Navigation || (QQConsole.Navigation = {}));
})(QQConsole || (QQConsole = {}));
