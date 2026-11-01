// Generated from prompts/initial-prompt-routes.ts. Edit the TypeScript source and run build:typed.
/**
 * 初始提示词的控制台专用读写入口；调用前必须经过原有管理权限和同源检查。
 * @param {object} options store为所属存储；canonicalKey及log由宿主提供。
 * @returns {function(object):Promise<boolean>} 已处理返回true，不匹配返回false。
 * @note 缺少text不解释为删除；delete:true仍为显式删除。单会话查询只返回对应正文，列表保留原摘要。
 */
export function createInitialPromptRoutes({ store, canonicalKey: canonicalV2Key, log }) {
    const { getInitialPrompt, setInitialPrompt, initialPromptMaxChars } = store;
    return async function handleInitialPromptRoute({ method, url, readBody, sendJson }) {
        if (url.pathname === '/api/socialV2/initial-prompt' && (method === 'GET' || method === 'POST')) {
            if (method === 'GET') {
                const key = String(url.searchParams.get('key') ?? '').trim();
                if (!key) {
                    const entries = store.list();
                    sendJson({ ok: true, entries, maxChars: initialPromptMaxChars(), writable: store.isWritable() });
                    return true;
                }
                const canonical = canonicalV2Key(key);
                if (!canonical) {
                    sendJson({ ok: false, error: 'key 格式应为 group:群号 或 private:QQ号' }, 400);
                    return true;
                }
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
            const result = setInitialPrompt(key, explicitDelete ? '' : body.text);
            if (!result.ok) {
                sendJson({ ok: false, error: result.error }, result.statusCode ?? 400);
                return true;
            }
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
