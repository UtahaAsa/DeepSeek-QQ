interface TimerOwner { agentToken?: unknown; }
interface Slot<Owner, Handle> { owner: Owner; token: unknown; handle: Handle; }
/**
 * 持有会话定时器；同一key/用途只保留一个任务，替代或失效的回调不得操作新会话。
 * @param deps getOwner返回当前会话，normalizeKey统一会话别名，setTimer/clearTimer使用宿主时钟。
 * @returns 安排、取消与归属查询接口。会话对象上的句柄仅为兼容既有判忙及路由，不是所有权依据。
 * @note 回调前同时检查登记项、会话对象、令牌及句柄；取消不冒充撤销已经开始的异步投递。
 */
export function createOwnedTimers<Owner extends TimerOwner, Handle>(deps: {
  getOwner: (key: string) => Owner | undefined;
  normalizeKey?: (key: string) => string;
  setTimer: (callback: () => void, delayMs: number) => Handle;
  clearTimer: (handle: Handle) => void;
}) {
  const entries = new Map<string, Map<string, Slot<Owner, Handle>>>();
  const keyOf = (key: string) => deps.normalizeKey?.(key) ?? key;
  const fields = (owner: Owner) => owner as Record<string, unknown>;
  function valid(key: string, slot: string, entry: Slot<Owner, Handle>): boolean {
    return entries.get(key)?.get(slot) === entry && deps.getOwner(key) === entry.owner &&
      entry.owner.agentToken === entry.token && fields(entry.owner)[slot] === entry.handle;
  }
  function release(key: string, slot: string, entry: Slot<Owner, Handle>): void {
    const row = entries.get(key);
    if (row?.get(slot) !== entry) return;
    row.delete(slot); if (!row.size) entries.delete(key);
    if (fields(entry.owner)[slot] === entry.handle) fields(entry.owner)[slot] = null;
  }
  /** 取消一个用途的当前任务；其它用途和其它会话不受影响。 */
  function cancel(key: string, slot: string): void {
    key = keyOf(key);
    const entry = entries.get(key)?.get(slot);
    if (!entry) return;
    release(key, slot, entry); deps.clearTimer(entry.handle);
  }
  /** 替换同用途任务；返回宿主句柄，回调只在登记和会话身份都仍有效时执行。 */
  function schedule(key: string, owner: Owner, slot: string, callback: () => void, delayMs: number): Handle {
    key = keyOf(key); cancel(key, slot);
    const entry = {owner, token: owner.agentToken} as Slot<Owner, Handle>;
    entry.handle = deps.setTimer(() => {
      const run = valid(key, slot, entry);
      release(key, slot, entry);
      if (run) callback();
    }, delayMs);
    let row = entries.get(key); if (!row) {row = new Map(); entries.set(key, row);}
    row.set(slot, entry); fields(owner)[slot] = entry.handle;
    (entry.handle as {unref?: () => void} | null)?.unref?.();
    return entry.handle;
  }
  /** 取消指定会话的全部任务，同时撤销所有已经排入事件循环的旧回调归属。 */
  function cancelConversation(key: string): void {
    key = keyOf(key); for (const slot of [...entries.get(key)?.keys() ?? []]) cancel(key, slot);
  }
  /** 仅取消某一用途的全部任务，如重连时取消唤醒租约。 */
  function cancelSlot(slot: string): void { for (const key of [...entries.keys()]) cancel(key, slot); }
  /** 按状态对象取消指定用途，供只有状态对象的配置校正路径使用；未登记时返回false。 */
  function cancelOwner(owner: Owner, slot: string): boolean {
    for (const [key, row] of entries) if (row.get(slot)?.owner === owner) {cancel(key, slot); return true;}
    return false;
  }
  /** 取消本实例全部任务；不会取消其它实例或生产进程的定时器。 */
  function clear(): void { for (const key of [...entries.keys()]) cancelConversation(key); }
  /** 判断异步回执仍属于当前任务；超时、取消、替代或令牌变化后均返回false。 */
  function isCurrent(key: string, slot: string, handle: Handle | undefined): boolean {
    key = keyOf(key); const entry = entries.get(key)?.get(slot);
    return !!entry && entry.handle === handle && valid(key, slot, entry);
  }
  return Object.freeze({schedule, cancel, cancelConversation, cancelSlot, cancelOwner, clear, isCurrent});
}
