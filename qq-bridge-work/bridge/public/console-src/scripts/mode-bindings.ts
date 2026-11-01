namespace QQConsole.ModeBindings {


document.querySelectorAll<HTMLButtonElement>('#modeRow button').forEach(b => b.addEventListener('click', async () => {
  if (b.disabled) return;
  await QQConsole.Core.saveMode(b.dataset.mode);
}));
document.getElementById('closedPreset').addEventListener('change', async () => {
  // 切换预设立即保存（若当前是 closed-agent 则即时生效，否则供下次切换使用）
  const active = document.querySelector<HTMLButtonElement>('#modeRow button.active');
  const mode = active ? active.dataset.mode : 'chat';
  await QQConsole.Core.saveMode(mode);
});
}
