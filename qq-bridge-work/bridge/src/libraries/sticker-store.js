// Generated from libraries/sticker-store.ts. Edit the TypeScript source and run build:typed.
/**
 * 管理兼容表情库与同步；构造只创建内存状态，load由宿主在原启动位置显式调用。
 * @param deps 所属文件、配置、归一化和只读查询能力。
 * @returns 同步/查询/保存接口及实时state；原生绑定时load/sync/save均不访问旧库或回退网络。
 * @note 读坏文件降为只读，非法同步响应不覆盖本地认知。
 */
export function createStickerLibrary(deps) {
    const state = { entries: [], writable: false, syncedAt: 0, lastForcedAgentSyncAt: 0 };
    function load() {
        state.writable = !deps.nativeBinding;
        try {
            if (!deps.nativeBinding)
                state.entries = (0, deps.loadStickerStore)(deps.STICKER_FILE);
        }
        catch (error) {
            state.writable = false;
            (0, deps.log)(`⚠️ 表情库读取失败，已降级为「只读不写」（不会覆盖原文件）：${error?.message ?? error}`);
        }
    }
    function stickerEnabled() {
        return !deps.nativeBinding && deps.cfg.socialV2?.sticker?.enabled !== false;
    }
    function saveStickerStoreSafe() {
        if (!state.writable)
            return; // 读失败时绝不回写，避免把「损坏」当成「空库」落盘
        try {
            (0, deps.saveStickerStore)(deps.STICKER_FILE, state.entries);
        }
        catch (error) {
            (0, deps.log)('保存表情库失败:', error?.message ?? error);
        }
    }
    async function syncStickerLibrary(force = false) {
        if (deps.nativeBinding || deps.cfg.socialV2?.sticker?.enabled === false)
            return null;
        const rawTtl = Number(deps.cfg.socialV2?.sticker?.syncTtlMs);
        const ttl = Number.isFinite(rawTtl) ? Math.max(0, rawTtl) : 60000;
        const now = deps.Date.now();
        if (!force && state.syncedAt && now - state.syncedAt < ttl) {
            return { entries: state.entries, syncedAt: state.syncedAt, fromCache: true };
        }
        try {
            const count = Math.min(500, Math.max(1, Number(deps.cfg.socialV2?.sticker?.maxListCount) || 100));
            let response;
            let via = 'ws';
            try {
                response = await deps.bot.request('fetch_custom_face_detail', { count });
                if (!response || response.status !== 'ok' || response.retcode !== 0) {
                    throw new Error(`fetch_custom_face_detail 失败: ${response?.wording || response?.retcode || 'unknown'}`);
                }
            }
            catch (wsError) {
                // WS 失败 ⇒ 立刻用 HTTP 再问一次同一个 action（语义相同，token 可能不同但同一账号）。
                (0, deps.log)(`[sticker] WS 同步不可用（${wsError?.message ?? wsError}），改走 OneBot HTTP 兜底`);
                response = await (0, deps.onebotHttpAction)('fetch_custom_face_detail', { count });
                via = 'http';
            }
            // 只有拿到合法数组才允许合并；data 缺失/异常时不能拿空数组清空本地 QQ 表情库。
            if (!Array.isArray(response.data)) {
                throw new Error('fetch_custom_face_detail 返回 data 不是数组，已放弃同步');
            }
            const fetched = response.data;
            state.entries = (0, deps.mergeStickerLibrary)(state.entries, fetched, { complete: fetched.length < count });
            state.syncedAt = deps.Date.now();
            saveStickerStoreSafe();
            (0, deps.log)(`[sticker] 已同步 QQ 收藏表情 ${fetched.length} 个（本地库 ${state.entries.length} 条，via ${via}）`);
            return { entries: state.entries, syncedAt: state.syncedAt, fromCache: false, via };
        }
        catch (error) {
            (0, deps.log)(`[sticker] 同步收藏表情失败: ${error?.message ?? error}`);
            return null;
        }
    }
    async function listStickersForV2(query = '', count = 48, force = false) {
        const synced = await syncStickerLibrary(force);
        const entries = synced?.entries ?? state.entries;
        return (0, deps.formatStickerList)(entries, query, count);
    }
    async function getStickerImageData(stickerId) {
        const synced = await syncStickerLibrary(false);
        const entry = (0, deps.findSticker)(synced?.entries ?? state.entries, stickerId);
        if (!entry) {
            // 本地没有时，尝试强制刷新一次再找（收藏可能在会话过程中新增）
            const forced = await syncStickerLibrary(true);
            const entry2 = (0, deps.findSticker)(forced?.entries ?? state.entries, stickerId);
            if (!entry2)
                throw new Error(`找不到表情 ${stickerId}，请先用 qq_list_stickers 获取有效 id`);
            return entry2;
        }
        return entry;
    }
    return { stickerEnabled, saveStickerStoreSafe, syncStickerLibrary, listStickersForV2, getStickerImageData, load, state };
}
