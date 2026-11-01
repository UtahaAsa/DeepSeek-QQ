/// <reference types="node" />
import type {ImageApiDependencies,ImageGrant,ImageOperationOptions,ImageErrorView,ImageOperatorResult} from './media/image-generation-contracts.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createImageGenerationManager } from './image-generation.js';
import { IMAGE_GENERATION_API_ERRORS } from './image-generation-errors.js';
export { IMAGE_GENERATION_API_ERRORS } from './image-generation-errors.js';

const fail = (code:string) => Object.assign(new Error(code), { code });
const safeErrors = new Set(IMAGE_GENERATION_API_ERRORS);
const equal = (left:unknown, right:unknown) => typeof left === 'string' && typeof right === 'string' && /^[a-f0-9]{64}$/.test(left) &&
  /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));

/**
 * 绑定操作员配置与当前聊天的模型生成工具，构造不联网或写盘。
 * @param {object} options context(key)同步返回当前允许模式/会话/角色的稳定代次或null；permission读取网关独立许可。
 *   verify(key)异步核验原生本次会话，upload只上传；rememberToken记录令牌以阻止输出泄漏；initialSettings仅恢复不含密钥的参数草稿。
 * @returns {object} operator/hint/generate/snapshot/cancel/close；无凭据在模型返回中。
 * @note 每次投递只为当前会话签发10分钟内存资格；变更配置/模式/会话/角色后旧资格失效。
 *   生成只返回句柄、sent=false；不能由配置页触发收费请求。provider/now仅供隔离测试。
 */
export function createImageGenerationApi({ context, permission, verify, upload, rememberToken = () => {}, provider, now = Date.now, initialSettings = null }:ImageApiDependencies = {} as ImageApiDependencies) {
  if (![context, permission, verify, upload, rememberToken].every(value => typeof value === 'function')) throw fail('IMAGE_GENERATION_CONFIG_INVALID');
  const grants = new Map<string,ImageGrant>(); let closed = false;
  function current(key:string, token?:unknown) {
    const grant = grants.get(key), stamp = context(key), time = now();
    if (closed || permission() !== true || !grant || !stamp || stamp !== grant.context || time < grant.createdAt || time - grant.createdAt > 600000 ||
        token !== undefined && !equal(grant.token, token)) throw fail('IMAGE_GENERATION_NOT_AUTHORIZED');
    return grant.token;
  }
  const manager = createImageGenerationManager({ provider, now, upload, initialSettings,
    authorize: async key => {
      const token = current(key); const result = await verify(key) as {authorized?:unknown}|null;
      if (result?.authorized !== true || current(key) !== token) throw fail('IMAGE_GENERATION_NOT_AUTHORIZED');
      return token;
    },
  });
  function snapshot() { return { ...manager.snapshot(), permission: !closed && permission() === true }; }
  function operator(operation:string, input:unknown = {}):ImageOperatorResult<ReturnType<typeof snapshot>> {
    try {
      if (operation === 'state') return { ok: true, generation: snapshot() };
      if (operation === 'apply') { manager.configure(input); grants.clear(); }
      else if (operation === 'clear' || operation === 'cancel') {
        if (!input || Object.keys(input).length !== 1 || !Number.isSafeInteger((input as Record<string,unknown>).expectedRevision) || (input as Record<string,unknown>).expectedRevision !== manager.snapshot().revision) throw fail('IMAGE_GENERATION_REVISION_CONFLICT');
        if (operation === 'clear') manager.clear((input as Record<string,unknown>).expectedRevision); else manager.cancel();
        grants.clear();
      } else throw fail('IMAGE_GENERATION_INPUT_INVALID');
      return { ok: true, generation: snapshot() };
    } catch (error) { return { ok: false, error: safeErrors.has((error as ImageErrorView|null)?.code as string) ? (error as ImageErrorView).code as string : 'IMAGE_GENERATION_FAILED' }; }
  }
  function hint(key:string) {
    if (closed || permission() !== true || !manager.snapshot().configured || !/^(private|group):[1-9]\d{0,19}$/.test(key ?? '')) return '';
    const stamp = context(key); if (!stamp || typeof stamp !== 'string') return '';
    const time = now();
    for (const [name, grant] of grants) if (time - grant.createdAt > 600000) grants.delete(name);
    let grant = grants.get(key);
    if (!grant || grant.context !== stamp || time < grant.createdAt) {
      if (!grant && grants.size >= 128) return '';
      grant = { context: stamp, token: randomBytes(32).toString('hex'), createdAt: time };
      grants.set(key, grant); rememberToken(key, grant.token);
    } else grant.createdAt = time;
    return '\n【本次可用图片生成】你可按当前对话需要调用 qq_generate_image(key,prompt,generationToken)，只传当前会话标识、绘图提示词和下面的生成会话令牌。'
      + (manager.snapshot().settings?.provider === 'hf-flux-schnell-public' ? '当前为免费公共FLUX试用接口，可能排队或限额；' : '供应商可能收费；')
      + '每次只生成一张，不要为失败自动重试。工具返回本会话图片编号后可在回复里使用 [[qq-image:完整编号]]。'
      + '生成或上传成功不代表QQ已送达。不要公开令牌，不要在提示词中附加号码、凭据或无关聊天记录。'
      + '\n生成会话令牌：' + grant.token + '\n';
  }
  async function generate(input:unknown, { signal }:ImageOperationOptions = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 ||
        Object.keys(input).some(name => !['key', 'prompt', 'generationToken'].includes(name)) ||
        typeof (input as Record<string,unknown>).generationToken !== 'string' || !/^[a-f0-9]{64}$/.test((input as Record<string,unknown>).generationToken as string)) throw fail('IMAGE_GENERATION_INPUT_INVALID');
    current((input as Record<string,unknown>).key as string, (input as Record<string,unknown>).generationToken);
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
    const monitor = setInterval(() => { try { current((input as Record<string,unknown>).key as string, (input as Record<string,unknown>).generationToken); } catch { controller.abort(); } }, 500);
    monitor.unref?.();
    try { return await manager.generate((input as Record<string,unknown>).key as string, (input as Record<string,unknown>).prompt, { signal: controller.signal }); }
    finally { clearInterval(monitor); signal?.removeEventListener('abort', abort); }
  }
  function close() { if (closed) return; closed = true; grants.clear(); manager.close(); }
  return Object.freeze({ operator, hint, generate, snapshot, cancel: () => { grants.clear(); manager.cancel(); }, close });
}
