/// <reference types="node" />
import type {QzoneApiDependencies,QzoneSettings,QzoneGrant,QzoneInput,QzoneAudience,NativeReceiptView} from './native/operation-contracts.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SENSITIVE_RE } from './sensitive.js';

const fail = (code:string) => Object.assign(new Error(code), { code });
const tokenValue = (value:unknown):value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (left:unknown, right:unknown) => tokenValue(left) && tokenValue(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const audienceNames = Object.freeze({ self: '仅自己可见', friends: '好友可见', public: '公开可见' });
const configuration = (value:QzoneSettings|null|undefined) => value?.enabled === true && typeof value.audience === 'string' && Object.hasOwn(audienceNames, value.audience)
  ? JSON.stringify([value.enabled, value.audience, value.cooldownMinutes, value.dailyLimit]) : null;

/**
 * 当前普通聊天触发账号级原创文字说说的一次性模型资格；构造无I/O。
 * @param {object} options settings只读操作员配置；context返回当前聊天/角色/模式代次；verify重验原生会话。
 *   perform只转交当前聊天与正文；safeText检查既有凭据/隐私规则；rememberToken接出站脱敏集合。
 * @returns {object} hint/post/cancel/close；最多128个聊天资格，十分钟，每次调用即消耗，模型不能改可见范围。
 * @note 取消/新一轮提示/上下文变更可撤销尚未转交的预检；无法撤销已经发送的HTTP发布请求，不自动重试。
 */
export function createQzoneApi({ settings, context, verify, perform, safeText, rememberToken = () => {}, now = Date.now }:QzoneApiDependencies) {
  if (![settings, context, verify, perform, safeText, rememberToken, now].every(value => typeof value === 'function')) throw fail('QZONE_API_OPTIONS_INVALID');
  let closed = false;
  const grants = new Map<string,QzoneGrant>(), versions = new Map<string,QzoneGrant>();
  function hint(key:string) {
    if (closed || !/^(private|group):[1-9]\d{0,19}$/.test(key ?? '')) return '';
    const value = settings(), config = configuration(value), stamp = context(key), time = now();
    if (!config || typeof stamp !== 'string' || !stamp) return '';
    for (const [name, grant] of versions) if (time < grant.createdAt || time - grant.createdAt >= 600000) { versions.delete(name); grants.delete(name); }
    if (!versions.has(key) && versions.size >= 128) return '';
    const grant = { context: stamp, config, audience: value!.audience, createdAt: time, token: randomBytes(32).toString('hex') };
    grants.set(key, grant); versions.set(key, grant); rememberToken(key, grant.token);
    return '\n【本轮QQ空间能力】如适合当前情境，可自行调用 qq_post_qzone(key,text,postToken)发表一段原创纯文字说说；当前由本机操作员设定为'
      + audienceNames[value!.audience as QzoneAudience] + '，你不能更改可见范围。只传当前聊天标识，不把群聊/私聊原文、成员资料、号码、凭据或资格写进说说，不传图片路径或URL。'
      + '最多1000字符。资格一次性，调用失败或结果未知不能自动重试。取得服务端发布编号也不等于已验证空间页面可见性；仅自己可见时不可声称公开发布。'
      + '\n说说发布资格：' + grant.token + '\n';
  }
  async function post(input:unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3
        || Object.keys(input).some(key => !['key', 'text', 'postToken'].includes(key))) throw fail('QZONE_API_INPUT_INVALID');
    const { key, text, postToken } = input as QzoneInput, grant = grants.get(key), time = now();
    if (closed || !grant || !equal(postToken, grant.token) || context(key) !== grant.context || configuration(settings()) !== grant.config
        || time < grant.createdAt || time - grant.createdAt >= 600000) throw fail('QZONE_API_NOT_AUTHORIZED');
    if (typeof text !== 'string' || !text.isWellFormed() || !text.trim() || Array.from(text).length > 1000
        || Buffer.byteLength(text) > 4000 || text.includes('\0') || text.includes(postToken) || SENSITIVE_RE.test(text)
        || safeText(text) !== true) throw fail('QZONE_API_CONTENT_REFUSED');
    grants.delete(key);
    let subject:NativeReceiptView|null;
    try { subject = await verify(key) as NativeReceiptView|null; } catch { throw fail('QZONE_API_NOT_AUTHORIZED'); }
    if (closed || versions.get(key) !== grant || subject?.authorized !== true || subject.audience !== grant.audience
        || context(key) !== grant.context || configuration(settings()) !== grant.config || now() < grant.createdAt
        || now() - grant.createdAt >= 600000) throw fail('QZONE_API_NOT_AUTHORIZED');
    let result:NativeReceiptView|null;
    try { result = await perform(key, text) as NativeReceiptView|null; } catch { throw fail('QZONE_PUBLICATION_UNCONFIRMED'); }
    if (result?.audience !== grant.audience || result!.submitted !== true || !['accepted', 'rejected'].includes(result!.outcome as string)) throw fail('QZONE_PUBLICATION_UNCONFIRMED');
    if (result!.outcome === 'rejected') return { outcome: 'rejected', submitted: true, serverReceipt: false,
      audience: grant.audience, instruction: 'QQ空间拒绝了本次发布，不要自动重试，不可声称已发出。' };
    if (result!.serverReceipt !== true || typeof result!.tid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result!.tid)
        || result!.tid.includes(postToken) || safeText(result!.tid) !== true) throw fail('QZONE_PUBLICATION_UNCONFIRMED');
    return { outcome: 'accepted', submitted: true, serverReceipt: true, audience: grant.audience, tid: result!.tid,
      instruction: 'QQ空间接口已返回发布编号，本次为' + audienceNames[grant.audience as QzoneAudience] + '；页面可见性尚未由本人验收，不要重复发布。' };
  }
  return Object.freeze({ hint, post, cancel: () => { grants.clear(); versions.clear(); },
    close: () => { closed = true; grants.clear(); versions.clear(); } });
}
