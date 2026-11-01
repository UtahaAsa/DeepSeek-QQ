import type {ConsoleRouteContext, ConsoleRequestHead} from '../console/request-context.js';
/** 存储已归一化的提示词正文与毫秒时间戳；查询不存在时返回null。 */
export interface InitialPromptRouteEntry {readonly text: string; readonly createdAt: number; readonly updatedAt: number;}
/** 列表只返回摘要，不携带完整正文。 */
export interface InitialPromptRouteSummary {readonly key: string; readonly chars: number; readonly createdAt: number; readonly updatedAt: number; readonly preview: string;}
/** 同步保存的成功、删除与失败分支，保留写失败回滚后的错误。 */
export type InitialPromptRouteResult =
  | {ok: false; statusCode?: number; error: string}
  | {ok: true; key: string; deleted: true; chars: 0; entry: null}
  | {ok: true; key: string; deleted: false; chars: number; entry: InitialPromptRouteEntry};
/** 路由所需的存储切片；不加载文件、不构造替代存储或复制可写状态。 */
export interface InitialPromptRouteStore {
  readonly getInitialPrompt: (key: string) => InitialPromptRouteEntry | null;
  readonly setInitialPrompt: (key: string, text: string) => InitialPromptRouteResult;
  readonly initialPromptMaxChars: () => number;
  readonly list: () => readonly InitialPromptRouteSummary[];
  readonly isWritable: () => boolean;
}
/** 宿主先执行鉴权；canonicalKey只做原有键归一化，不授予访问权限。 */
export interface InitialPromptRouteDependencies {
  readonly store: InitialPromptRouteStore; readonly canonicalKey: (key: string) => string | null;
  readonly log: (message: string) => void;
}
export type InitialPromptRouteContext = Pick<ConsoleRouteContext,'url'|'readBody'|'sendJson'> & {method: ConsoleRequestHead['method']};
export type InitialPromptRouteHandler = (context: InitialPromptRouteContext) => Promise<boolean>;
/**
 * 初始提示词的控制台专用读写入口；调用前必须经过原有管理权限和同源检查。
 * @param {object} options store为所属存储；canonicalKey及log由宿主提供。
 * @returns {function(object):Promise<boolean>} 已处理返回true，不匹配返回false。
 * @note 缺少text不解释为删除；delete:true仍为显式删除。单会话查询只返回对应正文，列表保留原摘要。
 */
export function createInitialPromptRoutes({store,canonicalKey:canonicalV2Key,log}: InitialPromptRouteDependencies): InitialPromptRouteHandler {
  const {getInitialPrompt,setInitialPrompt,initialPromptMaxChars}=store;
  return async function handleInitialPromptRoute({method,url,readBody,sendJson}) {
    if (url.pathname === '/api/socialV2/initial-prompt' && (method === 'GET' || method === 'POST')) {
      if (method === 'GET') {
        const key = String(url.searchParams.get('key') ?? '').trim();
        if (!key) {
          const entries = store.list();
          sendJson({ ok: true, entries, maxChars: initialPromptMaxChars(), writable: store.isWritable() });
          return true;
        }
        const canonical = canonicalV2Key(key);
        if (!canonical) { sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400); return true; }
        const entry = getInitialPrompt(canonical) ?? null;
        sendJson({
          ok: true,
          key: canonical,
          exists: !!entry,
          text: entry?.text ?? '',
          createdAt: entry?.createdAt || 0,
          updatedAt: entry?.updatedAt || 0,
          maxChars: initialPromptMaxChars(),
          writable: store.isWritable()
        });
        return true;
      }
      const body = await readBody();
      const key = String(body.key ?? '').trim();
      const explicitDelete = body.delete === true;
      // 只接受 { key, text: string } 或 { key, delete: true }：
      // 缺 text 时不当作"清空"（否则一次漏字段的调用就把操作者写的内容删了）。
      if (!explicitDelete && typeof body.text !== 'string') {
        sendJson({ ok: false, error: 'text 必须是字符串（留空表示删除），或用 delete:true 显式删除' }, 400);
        return true;
      }
      const result = setInitialPrompt(key, explicitDelete ? '' : body.text as string);
      if (!result.ok) { sendJson({ ok: false, error: result.error }, result.statusCode ?? 400); return true; }
      log(`控制台：${result.deleted ? '已删除' : '已保存'}会话初始提示词 ${result.key}${result.deleted ? '' : `（${result.chars} 字符，仅首次唤醒注入）`}`);
      sendJson({
        ok: true,
        key: result.key,
        deleted: result.deleted,
        chars: result.chars,
        exists: !!result.entry,
        updatedAt: result.entry?.updatedAt || 0,
        maxChars: initialPromptMaxChars()
      });
      return true;
    }

    return false;
  };
}
