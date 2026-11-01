// Generated from native-turn-fence.ts. Edit the TypeScript source and run build:typed.
const refused = () => new Error('NATIVE_TURN_FENCE_UNCONFIRMED');
/**
 * 原生权限版本的模型轮次屏障；只保留序号与轮次，不保留提示、正文或账号。
 * @returns {object} open/has/accept/revoke；每会话须先取得新权限下的安全序号基线。
 * @note 同步纯内存，最多256会话；取消受理后的旧start/正文/end都不能开启新资格。
 */
export function createNativeTurnFence() {
    const sessions = new Map();
    return {
        /** @param {string} sessionId 所属会话。@returns {boolean} 本权限版本是否建立屏障。 */
        has: (sessionId) => sessions.has(sessionId),
        /** @param {string} sessionId 所属会话。@returns {boolean} 是否有已关联的当前轮次。 */
        hasOpenTurn: (sessionId) => Boolean(sessions.get(sessionId)?.open.size),
        /** @param {string} sessionId 所属会话。@param {number} asOfSeq 最新已提交序号，空会话为-1。@returns {void} 异常拒绝。 */
        open(sessionId, asOfSeq) {
            if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128 || !Number.isSafeInteger(asOfSeq) || asOfSeq < -1
                || !sessions.has(sessionId) && sessions.size >= 256)
                throw refused();
            if (sessions.has(sessionId))
                throw refused();
            sessions.set(sessionId, { floor: asOfSeq, open: new Set(), lastClosed: 0 });
        },
        /** @param {string} sessionId 所属会话。@param {object} event 固定DSH事件。@returns {boolean} 是否可送入当前轮次收集器。 */
        accept(sessionId, event) {
            const entry = sessions.get(sessionId), seq = event?.seq, turn = event?.data?.turn;
            if (!entry || !Number.isSafeInteger(seq) || seq <= entry.floor || !Number.isSafeInteger(turn) || turn < 1 || turn <= entry.lastClosed)
                return false;
            if (event.type === 'turn/start') {
                if (entry.open.size >= 8 && !entry.open.has(turn))
                    return false;
                entry.open.add(turn);
                return true;
            }
            if (!entry.open.has(turn))
                return false;
            if (event.type === 'turn/end') {
                entry.open.delete(turn);
                entry.lastClosed = Math.max(entry.lastClosed, turn);
            }
            return true;
        },
        /** 废弃全部旧资格；原有会话记录、模型选择及计费账本不受影响。@returns {void} 无I/O。 */
        revoke() { sessions.clear(); },
    };
}
/**
 * 读取固定DSH投影的安全水位，只取kind/asOfSeq，不读取历史记录或投影内容。
 * @param {object} api 所属DSH客户端。@param {string} sessionId 已确认所属会话。
 * @returns {Promise<number>} 已提交序号；不存在/迁移中/未知形状拒绝，不猜测零值。
 */
export async function readNativeTurnBaseline(api, sessionId) {
    try {
        const response = await api.callUnary('session/projections', { sessionId });
        const value = response?.result?.ok === true ? response.result.value : null;
        if (value?.kind !== 'sequenced')
            throw 0;
        if (value.asOfSeq === null)
            return -1;
        if (!Number.isSafeInteger(value.asOfSeq) || value.asOfSeq < 0)
            throw 0;
        return value.asOfSeq;
    }
    catch {
        throw refused();
    }
}
