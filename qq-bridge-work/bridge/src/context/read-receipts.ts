/** 消息序号来自存储或工具输入，在确认前按原规则检查安全整数。 */
export interface ReceiptMessage { seq?: unknown; }
/** 水位操作只依赖的状态切片；消息其余字段通过泛型保留。 */
export interface ReadReceiptState<Message extends ReceiptMessage = ReceiptMessage> {
  unread: Message[]; lastUnreadSeq: number; lastReadThroughSeq?: number;
  lastWakeInputSeq?: number; modelSeenSeqs?: Set<number>;
}
/** 可注入计算接口，不需要访问时钟、文件或网络。 */
export interface ReadReceiptDependencies { Math: Pick<Math,'min'|'max'>; }
/** 带HTTP错误码的校验错误；错误码在抛出前设为400。 */
interface ReceiptValidationError extends Error { statusCode?: number; }
/**
 * 区分实际已展示水位与后台观察进度；新到消息不会被旧回执确认。
 * @param {object} deps 所属实例的实时依赖及时间接口；构造无IO，不缓存动态配置。
 * @returns {object} 本功能的操作；异步错误沿既有调用边界处理，数据格式保持兼容。
 */
export function createReadReceipts(deps: ReadReceiptDependencies) {


  // Only messages actually offered to the model authorize cursor-based acknowledgement.
  // Keep this receipt in memory: after a restart the model must fetch unread again.
  function readThroughSeqV2(st: ReadReceiptState, additional: readonly ReceiptMessage[] = []): number {
    const seen = new Set(st.modelSeenSeqs || []);
    for (const msg of additional) if (Number.isSafeInteger(msg?.seq) && (msg.seq as number) > 0) seen.add(msg.seq as number);
    const seqs = st.unread.map((m) => m.seq).filter((seq): seq is number => Number.isSafeInteger(seq) && (seq as number) > 0);
    const lowestBuffered = seqs.length ? deps.Math.min(...seqs) : Infinity;
    const lastUnread = Number.isSafeInteger(st.lastUnreadSeq) ? st.lastUnreadSeq : 0;
    let through = Number.isSafeInteger(st.lastReadThroughSeq) ? st.lastReadThroughSeq! : 0;
    // A seq may be reached only when it was offered to the model, or when the buffer
    // no longer holds it at all (evicted by unreadLimit, so it can never be displayed
    // again). Scoping the skip to the real buffer range is what keeps this from ever
    // stepping over a still-pending message.
    const reachable = (seq: number) => seen.has(seq) || (seq < lowestBuffered && seq <= lastUnread);
    while (through < lastUnread && reachable(through + 1)) through += 1;
    return through;
  }

  // 后台去重进度独立于可确认已读水位；历史未读缺口不能冒充刚到的新消息。
  function observationThroughSeqV2(st: ReadReceiptState): number {
    const values = [readThroughSeqV2(st), st.lastWakeInputSeq || 0, ...(st.modelSeenSeqs || [])]
      .filter(value => Number.isSafeInteger(value) && value >= 0);
    return deps.Math.min(st.lastUnreadSeq || 0, deps.Math.max(0, ...values));
  }

  function noteModelMessagesV2(st: ReadReceiptState, messages: readonly ReceiptMessage[]): number {
    // Bound receipts by the actual unread buffer; historical/self messages need no receipt.
    const unread = new Set(st.unread.map((m) => m.seq));
    st.modelSeenSeqs = new Set([...st.modelSeenSeqs || []].filter((seq) => unread.has(seq)));
    for (const msg of messages) {
      if (Number.isSafeInteger(msg?.seq) && (msg.seq as number) > 0 && unread.has(msg.seq)) st.modelSeenSeqs.add(msg.seq as number);
    }
    return readThroughSeqV2(st);
  }

  function requestedReadThroughSeqV2(st: ReadReceiptState, body: Readonly<{throughSeq?: unknown}>, isAgent: boolean): number | null {
    if (!Object.prototype.hasOwnProperty.call(body, 'throughSeq')) return null;
    const seq = body.throughSeq;
    const max = isAgent ? readThroughSeqV2(st) : st.lastUnreadSeq;
    if (!Number.isSafeInteger(seq) || (seq as number) < 0 || (seq as number) > max || (seq as number) > st.lastUnreadSeq) {
      const error: ReceiptValidationError = new Error('throughSeq 必须是不超过已展示连续消息水位的非负安全整数；请先读取未读消息并使用返回的 readThroughSeq');
      error.statusCode = 400;
      throw error;
    }
    return seq as number;
  }

  function acknowledgeMessagesV2<Message extends ReceiptMessage>(st: ReadReceiptState<Message>, throughSeq: number | null): number {
    const before = st.unread.length;
    if (throughSeq === null) {
      // Compatibility for console actions and old presets; new agents pass a cursor.
      st.unread = [];
      st.lastReadThroughSeq = st.lastUnreadSeq;
    } else {
      st.unread = st.unread.filter((m) => !Number.isSafeInteger(m.seq) || (m.seq as number) > throughSeq);
      st.lastReadThroughSeq = deps.Math.max(st.lastReadThroughSeq || 0, throughSeq);
    }
    noteModelMessagesV2(st, []);
    return before - st.unread.length;
  }
  return { readThroughSeqV2, observationThroughSeqV2, noteModelMessagesV2, requestedReadThroughSeqV2, acknowledgeMessagesV2 };
}
