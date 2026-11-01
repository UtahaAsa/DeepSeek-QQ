// Generated from libraries/sticker-routes.ts. Edit the TypeScript source and run build:typed.
import { formatStickerList } from '../sticker-lib.js';
/**
 * 表情库控制台管理入口，调用前须经过统一鉴权与同源检查。
 * @param {object} options cfg为当前配置；store实时提供entries/syncedAt/writable；sync/note/remark由宿主实现。
 * @returns {function(object):Promise<boolean>} 已处理返回true，无关路由返回false；同步及备注错误保留原响应。
 * @note 构造无IO；GET沿用非强制同步，写入在读取请求体或调用网关之前检查只读状态。
 */
export function createStickerRoutes({ cfg, store, sync: syncStickerLibrary, note: applyStickerNoteV2, remark: setStickerRemarkV2 }) {
    return async function handleStickerRoute({ req, url, readBody, sendJson }) {
        if (req.method !== 'GET' && ['/api/stickers/sync', '/api/stickers/note', '/api/stickers/remark'].includes(url.pathname) && !store.writable) {
            sendJson({ ok: false, error: '表情库处于只读降级状态（启动时加载失败，未覆盖原文件），本次修改不会落盘；请修复 state/ 下的对应文件后重启桥接' }, 503);
            return true;
        }
        // 管理端表情库接口（控制台）
        if (req.method === 'GET' && url.pathname === '/api/stickers') {
            const query = String(url.searchParams.get('query') ?? '').trim();
            const maxCount = Math.max(1, Number(cfg.socialV2?.sticker?.maxListCount) || 100);
            const count = Math.min(500, Math.max(1, Math.min(Number(url.searchParams.get('count')) || 48, maxCount)));
            // GET 不再触发强制同步（写副作用不能挂在读接口上）：请用 POST /api/stickers/sync。
            try {
                const synced = await syncStickerLibrary(false);
                const list = formatStickerList(synced?.entries ?? store.entries, query, count);
                sendJson({ ok: true, ...list, syncedAt: synced?.syncedAt ?? store.syncedAt, fromCache: synced?.fromCache ?? false, writable: store.writable });
            }
            catch (error) {
                sendJson({ ok: false, error: `获取表情失败：${error?.message ?? error}` }, 500);
            }
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/stickers/sync') {
            try {
                const synced = await syncStickerLibrary(true);
                sendJson({ ok: true, total: synced?.entries?.length ?? store.entries.length, syncedAt: synced?.syncedAt ?? store.syncedAt });
            }
            catch (error) {
                sendJson({ ok: false, error: `同步表情失败：${error?.message ?? error}` }, 500);
            }
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/stickers/note') {
            const body = await readBody();
            const stickerId = String(body.stickerId ?? '').trim();
            const note = body.note !== undefined && body.note !== null ? String(body.note).trim().slice(0, 200) : undefined;
            const tags = body.tags !== undefined && body.tags !== null ? (Array.isArray(body.tags) ? body.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : []) : undefined;
            const usage = body.usage !== undefined && body.usage !== null ? String(body.usage).trim().slice(0, 200) : undefined;
            if (!stickerId) {
                sendJson({ ok: false, error: 'stickerId 不能为空' }, 400);
                return true;
            }
            const entry = applyStickerNoteV2(stickerId, note, tags, usage);
            if (!entry) {
                sendJson({ ok: false, error: `找不到表情 ${stickerId}` }, 404);
                return true;
            }
            sendJson({ ok: true, sticker: entry });
            return true;
        }
        if (req.method === 'POST' && url.pathname === '/api/stickers/remark') {
            const body = await readBody();
            const stickerId = String(body.stickerId ?? '').trim();
            if (!stickerId) {
                sendJson({ ok: false, error: 'stickerId 不能为空' }, 400);
                return true;
            }
            try {
                const entry = await setStickerRemarkV2(stickerId, String(body.remark ?? ''));
                sendJson({ ok: true, sticker: entry });
            }
            catch (error) {
                sendJson({ ok: false, error: `修改备注失败：${error?.message ?? error}` }, 500);
            }
            return true;
        }
        return false;
    };
}
