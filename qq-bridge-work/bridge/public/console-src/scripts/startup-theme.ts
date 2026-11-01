namespace QQConsole.StartupTheme {


QQConsole.Navigation.setConsolePage(location.hash.slice(1), { updateHash:false });

QQConsole.Core.refresh(); QQConsole.Roles.refreshRoles(); QQConsole.SettingsLoaders.refreshWhitelist(); QQConsole.SettingsLoaders.refreshSessions(); QQConsole.SettingsLoaders.refreshPending(); QQConsole.Core.refreshPresets(); QQConsole.LegacySocial.loadSocialForm(); QQConsole.V2Settings.loadV2Config(); QQConsole.V2SessionsActivity.refreshV2Activity(); QQConsole.V2ToolsMemory.loadV2ToolLog(); QQConsole.V2SessionsActivity.loadV2SessionOptions(); QQConsole.LegacySocial.refreshSocialStatus(); QQConsole.Slang.refreshSlang(); QQConsole.Slang.loadSlangConfig(); QQConsole.Security.loadSecurity(); QQConsole.PromptEditor.refreshSimPrompt(); QQConsole.SettingsLoaders.refreshDshModel(); QQConsole.UsageLedger.refreshUsage(); QQConsole.UsageChart.refreshUsageChart(); QQConsole.UsageLedger.refreshUsageRecent();
setInterval(() => { QQConsole.Core.refresh(); QQConsole.SettingsLoaders.refreshSessions(); QQConsole.SettingsLoaders.refreshPending(); QQConsole.LegacySocial.refreshSocialStatus(); QQConsole.Slang.refreshSlang(); }, 3000);
// 用量看板只在本页可见时轮询：既保证「实时」，又不让其它页白白多打两份接口。
setInterval(() => { if (QQConsole.Navigation.currentConsolePage !== 'usage') return; QQConsole.UsageLedger.refreshUsage(); QQConsole.UsageChart.refreshUsageChart(); QQConsole.UsageLedger.refreshUsageRecent(); }, 3000);
// 主题切换（纯前端，不发任何请求；选择写入 localStorage，未选择时跟随系统）
(function () {
  var root = document.documentElement;
  var button = document.getElementById('themeToggle');
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function stored() {
    try { return localStorage.getItem('qq-console-theme'); } catch (error) { return null; }
  }
  function apply(theme:'dark'|'light', persist:boolean) {
    root.dataset.theme = theme;
    if (persist) { try { localStorage.setItem('qq-console-theme', theme); } catch (error) {} }
    var dark = theme === 'dark';
    button.textContent = dark ? '☀' : '☾';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
    button.title = dark ? '切换到浅色主题' : '切换到深色主题';
  }
  apply(root.dataset.theme === 'dark' ? 'dark' : 'light', false);
  button.addEventListener('click', function () {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  media.addEventListener('change', function (event) {
    if (!stored()) apply(event.matches ? 'dark' : 'light', false);
  });
})();

}
