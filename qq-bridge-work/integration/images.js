import { confirmAction } from '/image-generation/confirmation.js';

const byId = id => document.getElementById(id);
const fields = { provider: 'provider', endpoint: 'endpoint', model: 'model', size: 'size', quality: 'quality', responseFormat: 'response-format' };
const publicFlux = { provider: 'hf-flux-schnell-public', endpoint: 'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer',
  model: 'FLUX.1-schnell', size: '1024x1024', quality: '', responseFormat: 'default' };
let state = null, dirty = false, editingRevision = null, busy = false, refreshId = 0;
const messages = {
  IMAGE_GENERATION_REVISION_CONFLICT: '配置已经变化，请重新读取状态再保存。',
  IMAGE_GENERATION_CREDENTIAL_REQUIRED: '新地址需要重新填写 API 密钥，旧供应商密钥不会自动沿用。',
  IMAGE_PROVIDER_CONFIG_INVALID: '请检查模型 ID 和兼容参数。', IMAGE_PROVIDER_URL_INVALID: '请填写符合说明的完整公网 HTTPS 生成地址。',
  IMAGE_GENERATION_CONFIG_INVALID: '配置未接受，请检查输入；密钥已从编辑框清空。',
  IMAGE_GENERATION_CANCELLED: '上次任务已取消。供应商可能已受理，未自动重试。',
  IMAGE_PROVIDER_OUTCOME_UNKNOWN: '上次生成结果未知，可能已产生费用，未自动重试。',
};
function feedback(text, error = false) { byId('feedback').textContent = text; byId('feedback').dataset.error = String(error); }
function providerFields() {
  const free = byId('provider').value === publicFlux.provider;
  for (const id of ['endpoint', 'model', 'size', 'quality', 'response-format', 'api-key']) byId(id).disabled = free;
  byId('api-key').required = !free && !state?.hasApiKey;
  byId('key-help').textContent = free ? '免费公共试用不需要 API 密钥。'
    : state?.hasApiKey ? '密钥已在本次内存中保存。地址不变时留空沿用；更换地址需重新填写。重载后重新配置。'
      : '仅在本机输入。本次进程内存保存，不写入磁盘或返回模型；重载后重新配置。';
}
function render(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  byId('permission').textContent = '生成许可：' + (state.permission ? '本次已允许' : '未开启，需在 QQ 控制台确认');
  byId('configuration').textContent = 'API 配置：' + (state.configured ? '本次已保存，实际可用性待调用验证' : '尚未配置');
  byId('task').textContent = '任务：' + (state.busy ? '生成或上传处理中；普通文字通道可继续工作' : '空闲');
  byId('counts').textContent = '今日已尝试 ' + state.limits.attemptedToday + '/20；本次准备好图片 ' + state.counts.prepared + ' 张。准备好不等于已发送。';
  byId('last-result').textContent = state.lastResult ? state.lastResult === 'prepared_not_sent' ? '最近结果：图片已准备，实际送达看 QQ 回执。'
    : messages[state.lastResult] ?? '最近任务未完成。请核对配置或供应商状态，未自动重试。' : '';
  byId('editor').disabled = busy; byId('refresh').disabled = busy;
  byId('clear').disabled = busy || !state.configured; byId('cancel').disabled = busy || !state.busy;
  if (!dirty) {
    const size = state.settings?.size;
    if (size && ![...byId('size').options].some(option => option.value === size)) {
      const option = document.createElement('option'); option.value = size; option.textContent = size + '（已有配置）'; byId('size').append(option);
    }
    for (const [key, id] of Object.entries(fields)) byId(id).value = state.settings?.[key] ?? (key === 'provider' ? 'openai' : key === 'responseFormat' ? 'default' : '');
  }
  providerFields();
}
async function request(operation, input) {
  const response = await fetch('/image-generation/api/' + operation, { method: input ? 'POST' : 'GET', cache: 'no-store',
    headers: { 'X-QQ-Local-Action': '1', ...(input ? { 'Content-Type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(messages[result.error] ?? (result.error === 'IMAGE_INPUT_INVALID'
    ? '输入未接受，请核对地址、模型和参数；没有发送生成请求。' : '图片管理暂不可用，请确认桥接已就绪。'));
  return result.generation;
}
async function refresh(manual = false) {
  if (manual && dirty) {
    if (!await confirmAction('重新读取会放弃尚未保存的编辑并清空密钥输入，继续吗？')) return;
    dirty = false; editingRevision = null; byId('api-key').value = '';
  }
  const id = ++refreshId;
  try {
    const next = await request('state');
    if (id !== refreshId) return;
    render(next); if (manual) feedback(dirty ? '状态已更新，保留尚未保存的编辑。' : '状态已更新。');
    else if (byId('feedback').textContent === '正在读取图片生成状态…') feedback('只保存配置不会触发付费生成。');
  } catch (error) { if (manual || !state) feedback(error.message, true); }
}
async function submit(operation, input) {
  if (busy) return;
  busy = true; refreshId++; if (state) render(state); feedback('正在处理…');
  try {
    const next = await request(operation, input); dirty = false; editingRevision = null; render(next);
    feedback(operation === 'apply' ? '本次配置已保存；没有发送试生成请求。' : operation === 'clear' ? '本次配置已清除。' : '已请求取消，等待在途任务结算；未自动重试。');
  } catch (error) { feedback(error.message, true); }
  finally { byId('api-key').value = ''; busy = false; if (state) render(state); }
}
byId('image-form').addEventListener('input', () => { if (!dirty) editingRevision = state?.revision ?? null; dirty = true; });
byId('provider').addEventListener('change', () => {
  if (!dirty) editingRevision = state?.revision ?? null; dirty = true; byId('api-key').value = '';
  const selected = byId('provider').value === publicFlux.provider ? publicFlux : { provider: 'openai', responseFormat: 'default' };
  for (const [key, id] of Object.entries(fields)) byId(id).value = selected[key] ?? '';
  providerFields();
});
byId('image-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state || busy) return;
  const expectedRevision = editingRevision ?? state.revision;
  if (expectedRevision !== state.revision) { feedback('配置已被另一操作更新。请重新读取并确认放弃旧编辑，再修改保存。', true); return; }
  if (state.busy && !await confirmAction('保存新配置会取消当前生成，供应商可能已经受理。继续保存吗？')) return;
  const settings = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, byId(id).value]));
  const secret = byId('api-key').value;
  await submit('apply', { expectedRevision, settings, ...(secret ? { apiKey: secret } : {}) });
});
for (const operation of ['clear', 'cancel']) byId(operation).addEventListener('click', async () => {
  if (!state || busy) return; const expectedRevision = state.revision;
  if (!await confirmAction(operation === 'clear' ? '清除本次 API 配置并取消在途任务？重新使用时需再输入密钥。' : '取消当前生成？供应商可能已受理，取消不代表退还费用；不会自动重试。')) return;
  await submit(operation, { expectedRevision });
});
byId('refresh').addEventListener('click', () => { void refresh(true); });
async function poll() { if (!busy) await refresh(); setTimeout(poll, 3000); }
void poll();
