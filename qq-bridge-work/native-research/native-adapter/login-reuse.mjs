import { nativeMethod } from './manual-login.mjs';
const own = (value, key) => { try { return value == null ? undefined : Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; } };

/**
 * 本人开始连接后，通过所属QQ登录服务尝试复用唯一可快速登录的记录。
 * @param {object} options service为所属登录服务，current用于每个异步边界的取消核验。
 * @returns {Promise<object>} 固定status及有界候选数；绝不返回账号、UID、票据、错误或路径。
 * @note 只调用固定参考getLoginList/quickLoginWithUin；不读数据库、不选取多个记录之一。
 *   accepted只表示接口受理，仍须真正登录成功回调和账号初始化；unknown禁止并发扫码重试。
 */
export async function tryReuseLogin({ service, current = () => true, timeoutMs = 3000 }) {
  const result = (status, candidates = 0) => ({ status, candidates });
  let submitted = false, candidates = 0;
  const wait = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REUSE_TIMEOUT')), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const list = nativeMethod(service, 'getLoginList'), login = nativeMethod(service, 'quickLoginWithUin');
    if (!current()) return result('cancelled');
    const payload = await wait(Promise.resolve().then(() => { if (!current()) throw 0; return list(); }));
    if (!current()) return result('cancelled');
    const rows = own(payload, 'LocalLoginInfoList');
    if (own(payload, 'result') !== 0 || !Array.isArray(rows) || rows.length > 16) return result('unavailable');
    const eligible = [];
    for (let index = 0; index < rows.length; index++) {
      const row = own(rows, String(index));
      if (own(row, 'isQuickLogin') !== true) continue;
      const uin = own(row, 'uin');
      if (typeof uin !== 'string' || !/^[1-9]\d{0,19}$/.test(uin) || eligible.includes(uin)) return result('unavailable');
      eligible.push(uin);
    }
    candidates = eligible.length;
    if (candidates !== 1) return result(candidates ? 'multiple_accounts' : 'unavailable', candidates);
    if (!current()) return result('cancelled', candidates);
    submitted = true;
    const response = await wait(Promise.resolve().then(() => { if (!current()) { submitted = false; throw 0; } return login(eligible[0]); }));
    if (!current()) return result('cancelled', candidates);
    const code = own(response, 'result'), detail = own(response, 'loginErrorInfo'), message = own(detail, 'errMsg');
    if (typeof code !== 'string') return result('unknown', candidates);
    return result(code === '0' && (message === undefined || message === '') ? 'accepted' : 'refused', candidates);
  } catch { return result(!current() ? 'cancelled' : submitted ? 'unknown' : 'unavailable', candidates); }
}
