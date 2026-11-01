export interface QQStatusBot {isConnected:boolean;getLoginInfo:(options:{timeoutMs:number})=>Promise<unknown>;getStatus:(options:{timeoutMs:number})=>Promise<unknown>;}
interface QQLoginView {user_id?:unknown;nickname?:unknown;}
interface QQStatusView {online?:unknown;good?:unknown;}
/** available=true才有身份字段；未知/失败保留null，不推测为离线或在线。 */
export type QQStatus<Capabilities> = ({available:true;user_id:string;nickname:string;online:boolean;good:boolean}|{available:false;online:null;good:null;error:'QQ_STATUS_UNAVAILABLE'}) & {capabilities?:Capabilities};
/**
 * 通过桥接已经鉴权的 OneBot 连接查询最小账号状态，不向模型暴露端点或控制面数据。
 * @param {object} bot 所属 WebSocket 客户端；不会创建第二条连接或回退旧 HTTP 接口。
 * @param {object|null} capabilities 显式通道能力；null 表示未声明，不能推测支持媒体。
 * @returns {Promise<object>} 两个有界只读请求均成功才 available=true；失败不输出底层异常。
 */
export async function queryQQStatus<Capabilities=unknown>(bot:QQStatusBot, capabilities:Capabilities|null = null):Promise<QQStatus<Capabilities>> {
  try {
    if (!bot.isConnected) throw new Error();
    const [login, status] = await Promise.all([bot.getLoginInfo({ timeoutMs: 2500 }), bot.getStatus({ timeoutMs: 2500 })]) as [QQLoginView|null,QQStatusView|null];
    const userId = String(login?.user_id ?? '');
    if (!/^[1-9]\d{0,19}$/.test(userId) || typeof status?.online !== 'boolean' || typeof status?.good !== 'boolean') throw new Error();
    return { available: true, user_id: userId, nickname: typeof login!.nickname === 'string' ? login!.nickname.slice(0, 128) : '',
      online: status.online, good: status.good, ...(capabilities ? { capabilities } : {}) };
  } catch { return { available: false, online: null, good: null, error: 'QQ_STATUS_UNAVAILABLE', ...(capabilities ? { capabilities } : {}) }; }
}
