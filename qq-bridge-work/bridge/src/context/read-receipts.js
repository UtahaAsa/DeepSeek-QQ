// Generated from context/read-receipts.ts. Edit the TypeScript source and run build:typed.
/**
 * 区分实际已展示水位与后台观察进度；新到消息不会被旧回执确认。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createReadReceipts(deps) {
    // Only messages actually offered to the model authorize cursor-based acknowledgement.
    // Keep this receipt in memory: after a restart the model must fetch unread again.
    function readThroughSeqV2(st, additional = []) {
        const seen = new Set(st.modelSeenSeqs || []);
        for (const msg of additional)
            if (Number.isSafeInteger(msg?.seq) && msg.seq > 0)
                seen.add(msg.seq);
        const seqs = st.unread.map((m) => m.seq).filter((seq) => Number.isSafeInteger(seq) && seq > 0);
        const lowestBuffered = seqs.length ? deps.Math.min(...seqs) : Infinity;
        const lastUnread = Number.isSafeInteger(st.lastUnreadSeq) ? st.lastUnreadSeq : 0;
        let through = Number.isSafeInteger(st.lastReadThroughSeq) ? st.lastReadThroughSeq : 0;
        // A seq may be reached only when it was offered to the model, or when the buffer
        // no longer holds it at all (evicted by unreadLimit, so it can never be displayed
        // again). Scoping the skip to the real buffer range is what keeps this from ever
        // stepping over a still-pending message.
        const reachable = (seq) => seen.has(seq) || (seq < lowestBuffered && seq <= lastUnread);
        while (through < lastUnread && reachable(through + 1))
            through += 1;
        return through;
    }
    // 后台去重进度独立于可确认已读水位；历史未读缺口不能冒充刚到的新消息。
    function observationThroughSeqV2(st) {
        const values = [readThroughSeqV2(st), st.lastWakeInputSeq || 0, ...(st.modelSeenSeqs || [])]
            .filter(value => Number.isSafeInteger(value) && value >= 0);
        return deps.Math.min(st.lastUnreadSeq || 0, deps.Math.max(0, ...values));
    }
    function noteModelMessagesV2(st, messages) {
        // Bound receipts by the actual unread buffer; historical/self messages need no receipt.
        const unread = new Set(st.unread.map((m) => m.seq));
        st.modelSeenSeqs = new Set([...st.modelSeenSeqs || []].filter((seq) => unread.has(seq)));
        for (const msg of messages) {
            if (Number.isSafeInteger(msg?.seq) && msg.seq > 0 && unread.has(msg.seq))
                st.modelSeenSeqs.add(msg.seq);
        }
        return readThroughSeqV2(st);
    }
    function requestedReadThroughSeqV2(st, body, isAgent) {
        if (!Object.prototype.hasOwnProperty.call(body, 'throughSeq'))
            return null;
        const seq = body.throughSeq;
        const max = isAgent ? readThroughSeqV2(st) : st.lastUnreadSeq;
        if (!Number.isSafeInteger(seq) || seq < 0 || seq > max || seq > st.lastUnreadSeq) {
            const error = new Error('throughSeq 必须是不超过已展示连续消息水位的非负安全整数；请先读取未读消息并使用返回的 readThroughSeq');
            error.statusCode = 400;
            throw error;
        }
        return seq;
    }
    function acknowledgeMessagesV2(st, throughSeq) {
        const before = st.unread.length;
        if (throughSeq === null) {
            // Compatibility for console actions and old presets; new agents pass a cursor.
            st.unread = [];
            st.lastReadThroughSeq = st.lastUnreadSeq;
        }
        else {
            st.unread = st.unread.filter((m) => !Number.isSafeInteger(m.seq) || m.seq > throughSeq);
            st.lastReadThroughSeq = deps.Math.max(st.lastReadThroughSeq || 0, throughSeq);
        }
        noteModelMessagesV2(st, []);
        return before - st.unread.length;
    }
    return { readThroughSeqV2, observationThroughSeqV2, noteModelMessagesV2, requestedReadThroughSeqV2, acknowledgeMessagesV2 };
}
