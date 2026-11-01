/** 审计依赖：敏感检测及令牌列表实时读取，原文不进入日志。 */
export interface OutboundAuditOptions {
  shouldAuditKey: (key: string) => boolean; knownTokens: () => Iterable<string>;
  isSensitive: (subject: unknown) => boolean; shouldNotify: () => boolean;
  send: (key: string,subject: unknown) => Promise<unknown>;
  log: (message: string) => void; appendActivity: (message: string) => void;
}
/** 标签检查可能抛出错误；文本发送返回布尔结果，发送器拒绝仍向上传播。 */
export interface OutboundAudit {
  readonly assertOutboundAuditOk: (key: string,subject: unknown) => undefined;
  readonly auditAndSend: (key: string,text: unknown) => Promise<boolean>;
}
/**
 * 构造文本和音频标签的内容审计，保留各自的返回和异常语义。
 * @param {{shouldAuditKey:(key:string)=>boolean,knownTokens:()=>Iterable<string>,isSensitive:(subject:unknown)=>boolean,shouldNotify:()=>boolean,send:(key:string,subject:unknown)=>Promise<unknown>,log:(message:string)=>void,appendActivity:(message:string)=>void}} options 检测、发送与记录回调，均绑定所属实例。
 * @returns {{assertOutboundAuditOk:(key:string,subject:unknown)=>void,auditAndSend:(key:string,text:unknown)=>Promise<boolean>}} 标签检查和文本审计发送。
 * @note 构造无发送或IO；不记录被拦截正文；每次检查读取当前令牌集合及通知配置。
 */
export function createOutboundAudit({shouldAuditKey,knownTokens,isSensitive,shouldNotify,send,log,appendActivity}: OutboundAuditOptions): OutboundAudit {
  /**
   * @param {string} key 会话键。
   * @param {unknown} subject 音频标签或文件名，不读取音频内容。
   * @returns {void} 检查通过。
   * @throws {Error} 标签疑似敏感内容或含已知令牌；不发送通知消息。
   */
  function assertOutboundAuditOk(key: string,subject: unknown): undefined {
    const text=String(subject??'');
    const hasKnownToken=[...knownTokens()].some(t=>t&&text.includes(t));
    if(shouldAuditKey(key)&&(isSensitive(text)||hasKnownToken)) {
      log(`⚠️ 语音发送被安全策略拦截 (${key})：${hasKnownToken?'文件名含会话令牌':'文件名疑似含敏感信息'}`);
      appendActivity(`${key} [voice] 发送被拦截（文件名疑似敏感信息${hasKnownToken?'/会话令牌':''}）`);
      throw new Error('音频文件名疑似包含敏感信息（路径/凭据/会话令牌），已阻止发送；请重命名后再发');
    }
  }
  /**
   * @param {string} key 会话键。
   * @param {unknown} text 待审计文本。
   * @returns {Promise<boolean>} 审计拦截返回false；通过并完成发送调用返回true，沿用既有语义。
   * @throws {Error} 发送器拒绝时向上传播，不自动重试。
   */
  async function auditAndSend(key: string,text: unknown): Promise<boolean> {
    const hasKnownToken=[...knownTokens()].some(t=>t&&String(text??'').includes(t));
    if(shouldAuditKey(key)&&(isSensitive(text)||hasKnownToken)) {
      log(`⚠️ 回复被安全策略拦截 (${key})，疑似包含敏感信息${hasKnownToken?'（含会话令牌）':''}`);
      appendActivity(`${key} agent 回复被拦截（疑似敏感信息${hasKnownToken?'/会话令牌':''}）`);
      if(shouldNotify())await send(key,'⚠️ 本条回复因疑似包含敏感信息（路径/凭据/会话令牌）被安全策略拦截，已记录并通知管理员。');
      return false;
    }
    await send(key,text);
    return true;
  }
  return Object.freeze({assertOutboundAuditOk,auditAndSend});
}
