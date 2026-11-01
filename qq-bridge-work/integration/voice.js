import { confirmAction } from '/voice/confirmation.js';
const byId = id => document.getElementById(id);
const keys = ['selectedVoice', 'asrModel', 'python', 'engine', 'pretrained', 'ffmpeg'];
const phases = { disabled: '本次未开启语音', idle: '等待开始预热', starting: '正在启动语音进程', loading_asr: '正在加载识别模型',
  warming_asr: '正在预热语音识别', loading_tts: '正在加载已选声音', warming_tts: '正在预热语音合成', ready: '语音预热就绪',
  switching: '正在切换语音配置', rolling_back: '正在恢复原配置', stop_failed: '旧语音进程退出未确认，请通过组合入口检查服务',
  failed: '语音未就绪，文字回复仍可用' };
const outcomes = { running: '操作进行中，请等待实际预热结果。', applied: '新配置预热成功。', saved_disabled: '配置已保存；本次语音权限关闭，尚未加载模型。',
  rolled_back: '新配置未能加载，已恢复并预热原配置。', rollback_failed: '恢复未完成，请检查资源与组合服务状态。',
  stop_failed: '尚未确认旧进程退出，未加载新模型。', cancelled: '操作已结束，未继续启动模型。' };
const errors = { EXISTING_VOICE_RESOURCES_INVALID: '资源不完整或清单不受支持，请检查六项路径、模型文件、参考音频和摘要字段。',
  VOICE_CONFIG_CONFLICT: '配置已被其他操作修改。请重新读取状态后检查再应用。', VOICE_CONFIG_BUSY: '语音配置正在切换，或旧进程退出未确认，请先查看运行状态。',
  VOICE_CONFIG_UNCHANGED: '配置与当前相同，无需重复加载。', VOICE_BACKUP_UNAVAILABLE: '没有可恢复的上一配置。' };
let state = null, revision = null, dirty = false, actionBusy = false, refreshing = false, validated = null, timer;
const input = () => Object.fromEntries(keys.map(key => [key, byId(key).value.trim()]));
const signature = () => JSON.stringify(input());
const feedback = (text, error = false) => { byId('feedback').textContent = text; byId('feedback').dataset.error = String(error); };
function controls() {
  const busy = actionBusy || state?.busy;
  byId('voice-form').setAttribute('aria-busy', String(!!busy));
  for (const key of [...keys, 'file']) byId(key).disabled = !!busy;
  byId('validate').disabled = !!busy || !state?.ok || !revision;
  byId('apply').disabled = !!busy || state?.voice?.phase === 'stop_failed' || !state?.ok || !revision || validated !== signature();
  byId('restore').disabled = !!busy || !state?.canRestore;
  byId('refresh').disabled = actionBusy || refreshing;
}
async function request(operation, body) {
  const response = await fetch('/voice/api/' + operation, { method: body ? 'POST' : 'GET',
    headers: { 'X-QQ-Local-Action': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(35000) });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw Error(errors[value.error] ?? '暂时无法连接语音管理。请确认 QQ 桥接已就绪，再重新读取状态。');
  return value;
}
async function refresh(manual = false) {
  if (refreshing) return;
  if (manual && dirty && !await confirmAction('重新读取将放弃未应用的编辑，继续吗？')) return;
  if (manual) dirty = false;
  refreshing = true; controls();
  try {
    const beforeOperation = state?.operation;
    state = await request('state');
    if (!dirty && !state.busy && (manual || !revision || revision !== state.revision)) {
      for (const key of keys) byId(key).value = state.config?.[key] ?? '';
      revision = state.revision; validated = null;
    }
    const voice = state.voice ?? {};
    byId('phase').textContent = (phases[voice.phase] ?? '等待语音状态') + (voice.warmupMs != null ? `，预热 ${(voice.warmupMs / 1000).toFixed(1)} 秒` : voice.elapsedMs > 0 ? `，已等待 ${Math.floor(voice.elapsedMs / 1000)} 秒` : '');
    byId('permissions').textContent = `语音接收：${voice.receiveEnabled ? '已允许' : '未允许'}；语音发送：${voice.sendEnabled ? '已允许' : '未允许'}`;
    byId('operation').textContent = outcomes[state.operation?.outcome] ?? '';
    if (state.operation && (state.operation.id !== beforeOperation?.id || state.operation.outcome !== beforeOperation?.outcome)) {
      feedback(outcomes[state.operation.outcome] ?? '正在读取操作结果。', ['rolled_back', 'rollback_failed', 'stop_failed'].includes(state.operation.outcome));
    } else if (manual || !byId('feedback').dataset.loaded) feedback('已读取配置。修改后先校验，再应用；不会向 QQ 发送试音。');
    byId('feedback').dataset.loaded = 'true';
  } catch (error) { state = null; feedback(error.message, true); }
  finally { refreshing = false; controls(); clearTimeout(timer); timer = setTimeout(() => void refresh(), 3000); }
}
async function run(action) {
  if (actionBusy || state?.busy) return;
  actionBusy = true; controls();
  try { await action(); } catch (error) { feedback(error.message || '操作未完成。', true); }
  finally { actionBusy = false; controls(); }
}
for (const key of keys) byId(key).addEventListener('input', () => {
  dirty = true; validated = null; byId('validation').textContent = '资源路径已修改，请重新校验。'; controls();
});
byId('voice-form').addEventListener('invalid', event => {
  const details = event.target.closest('details'); if (details) details.open = true;
  feedback('请补齐模型与高级资源中的必填路径。', true);
}, true);
byId('voice-form').addEventListener('submit', event => { event.preventDefault(); void run(async () => {
  const checked = signature(); feedback('正在校验已有资源…');
  const result = await request('validate', { config: input() }); validated = checked;
  byId('validation').textContent = `资源结构通过：${result.summary.engine} · ${result.summary.recognition}。应用时将实际校验摘要并预热。`;
  feedback('校验通过。点击“应用并预热”开始切换。');
}); });
byId('apply').addEventListener('click', () => void run(async () => {
  if (validated !== signature()) return;
  const result = await request('apply', { config: input(), revision });
  if (!result.accepted) throw Error('未能开始配置切换。');
  dirty = false; validated = null; state.busy = true; controls();
  feedback('已开始切换，请观察运行状态；此时尚不代表预热成功。'); await refresh();
}));
byId('restore').addEventListener('click', () => void run(async () => {
  const expectedRevision = state.revision;
  if (!await confirmAction('恢复上一份语音配置并重新预热，继续吗？')) return;
  const result = await request('restore', { revision: expectedRevision });
  if (!result.accepted) throw Error('未能开始恢复。');
  dirty = false; validated = null; state.busy = true;
  feedback('已开始恢复，请等待实际预热结果。'); await refresh();
}));
byId('file').addEventListener('change', () => void run(async () => {
  const file = byId('file').files[0]; if (!file) return;
  try {
    if (file.size > 32768 || !/\.json$/i.test(file.name)) throw Error('请选择不超过 32 KiB 的 JSON 资源清单。');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(key => typeof value[key] === 'string')) throw Error('资源清单应只包含六项本机路径。');
    if (dirty && !await confirmAction('导入将替换当前编辑，继续吗？')) return;
    for (const key of keys) byId(key).value = value[key];
    dirty = true; validated = null; feedback('已填入编辑区，请先校验资源。');
  } finally { byId('file').value = ''; }
}));
byId('refresh').addEventListener('click', () => void refresh(true));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
controls(); void refresh();
