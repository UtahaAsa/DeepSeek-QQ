var QQConsole;
(function (QQConsole) {
    var Security;
    (function (Security) {
        function loadSecurity() {
            QQConsole.Core.api('/api/security').then(r => {
                document.getElementById('secInterceptNotify').checked = r.security?.interceptNotify !== false;
                // state/ 的 ACL 是否收紧（Windows 上需要管理员权限，未提权时会失败）。
                // 明确警示 + 给出可复制的命令，而不是让用户以为已经安全。
                const warn = document.getElementById('stateDirWarn');
                const hardened = r.stateDir?.hardened;
                if (hardened === false) {
                    document.getElementById('stateDirPath').textContent = r.stateDir?.path || 'state/';
                    document.getElementById('stateDirCmd').textContent = r.stateDir?.manualCommand || '';
                    warn.style.display = '';
                }
                else {
                    warn.style.display = 'none';
                }
            }).catch(() => { });
        }
        Security.loadSecurity = loadSecurity;
        document.getElementById('secSave').addEventListener('click', async () => {
            const r = await QQConsole.Core.api('/api/security', 'POST', { interceptNotify: document.getElementById('secInterceptNotify').checked });
            const msg = document.getElementById('secMsg');
            msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
            msg.className = r.ok ? 'meta ok' : 'meta err';
            if (r.ok)
                loadSecurity();
        });
        document.getElementById('stateDirReharden').addEventListener('click', async () => {
            const msg = document.getElementById('stateDirMsg');
            msg.textContent = '检测中…';
            const r = await QQConsole.Core.api('/api/security', 'POST', { rehardenStateDir: true });
            msg.textContent = r.hardened === true ? '✅ 权限已收紧' : '❌ 仍未收紧（改 ACL 需要管理员权限；请按上面两种做法之一操作后复检）';
            msg.className = r.hardened === true ? 'meta ok' : 'meta err';
            loadSecurity();
        });
        async function changeConsoleToken(generate) {
            const input = document.getElementById('consoleTokenInput');
            const msg = document.getElementById('consoleTokenMsg');
            const token = generate ? '' : input.value.trim();
            if (!generate && token && token.length < 16) {
                msg.textContent = '❌ 令牌至少需要 16 位';
                msg.className = 'meta err';
                return;
            }
            const r = await QQConsole.Core.api('/api/console/token', 'POST', { token });
            if (!r.ok) {
                msg.textContent = '❌ ' + (r.error || '修改失败');
                msg.className = 'meta err';
                return;
            }
            // 保存到 localStorage，当前页面继续使用新令牌
            localStorage.setItem('consoleToken', r.token);
            input.value = r.token;
            msg.textContent = r.generated ? '已生成随机令牌，当前页面已自动使用。可点击显示后复制。' : '已保存新令牌';
            msg.className = 'meta ok';
        }
        document.getElementById('consoleTokenSave').addEventListener('click', () => changeConsoleToken(false));
        document.getElementById('consoleTokenRandom').addEventListener('click', () => changeConsoleToken(true));
    })(Security = QQConsole.Security || (QQConsole.Security = {}));
})(QQConsole || (QQConsole = {}));
