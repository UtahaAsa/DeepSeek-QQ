interface Item<Options> { text: string; options: Options; }
interface Entry<Options, Timer> { items: Item<Options>[]; retries: number; timer?: Timer; running: boolean; }
/**
 * 管理离线补投队列和重试定时器；不暴露可变Map或消息数组。
 * @param deps dispatch执行投递；allowed在每项发送前检查实时权限；schedule/cancel由宿主提供。
 * @returns 入队、补投、查询与清理操作。forget/clear使旧批次失效，不冒充撤销已发送的远端RPC。
 * @note 同一实例只运行一轮flush；迟到回执不得复活已清理的消息或覆盖新队列。
 */
export function createOfflineQueue<Options, Timer>(deps: {
  dispatch: (key: string, text: string, options: Options, isCurrent: () => boolean) => Promise<{ok: boolean; error?: string}>;
  allowed: (key: string) => boolean;
  schedule: (callback: () => void, delayMs: number) => Timer;
  cancel: (timer: Timer) => void;
  log: (message: string) => void;
  now?: () => number;
  max?: number;
  hintCooldownMs?: number;
}) {
  const entries = new Map<string, Entry<Options, Timer>>();
  const hintAt = new Map<string, number>();
  const max = deps.max ?? 50, cooldown = deps.hintCooldownMs ?? 30000;
  let running: Promise<void> | null = null, again = false;
  const current = (key: string, entry: Entry<Options, Timer>) => entries.get(key) === entry;
  function cancelTimer(entry: Entry<Options, Timer>) {
    if (entry.timer !== undefined) { deps.cancel(entry.timer); entry.timer = undefined; }
  }
  function schedule(key: string, entry: Entry<Options, Timer>, delay: number, reset = false) {
    cancelTimer(entry);
    entry.timer = deps.schedule(() => {
      if (!current(key, entry)) return;
      entry.timer = undefined;
      if (reset) entry.retries = 0;
      void flush().catch(error => deps.log(`补投队列异常: ${String(error)}`));
    }, delay);
  }
  /** 普通入队保留重复消息；retry模式只按文本去重，沿用原重置补投规则。 */
  function enqueue(key: string, text: string, options: Options, retry = false): void {
    let entry = entries.get(key);
    if (!entry) { entry = {items: [], retries: 0, running: false}; entries.set(key, entry); }
    if (!retry || !entry.items.some(item => item.text === text)) {
      if (entry.items.length >= max) { entry.items.shift(); deps.log(`队列满（${max}），丢弃最旧消息 (${key})`); }
      entry.items.push({text, options});
    }
    if (retry) { entry.retries = 0; schedule(key, entry, 3000); }
  }
  async function run(): Promise<void> {
    const batch = [...entries].map(([key, entry]) => ({key, entry, items: entry.items.splice(0)}));
    for (const {key, entry, items} of batch) {
      if (!current(key, entry)) continue;
      cancelTimer(entry); entry.running = true;
      let sent = 0, failed = false;
      for (let index = 0; index < items.length; index++) {
        if (!current(key, entry)) break;
        if (!deps.allowed(key)) { deps.log(`补投跳过未授权会话 ${key}`); continue; }
        const item = items[index];
        try {
          const result = await deps.dispatch(key, item.text, item.options, () => current(key, entry));
          if (!current(key, entry)) break;
          if (!result.ok) throw new Error(result.error || '未知错误');
          entry.retries = 0; sent++;
        } catch (error) {
          if (!current(key, entry)) break;
          deps.log(`补投失败 ${key}: ${error instanceof Error ? error.message : String(error)}`);
          entry.items.unshift(...items.slice(index)); failed = true; break;
        }
      }
      entry.running = false;
      if (!current(key, entry)) continue;
      deps.log(`已补投 ${key}: 成功 ${sent} 条，失败 ${failed ? 1 : 0} 条`);
      if (failed) {
        entry.retries++;
        const paused = entry.retries > 5;
        if (paused) deps.log(`补投持续失败，暂停快速重试，队列保留 (${key})，60 秒后恢复一次`);
        schedule(key, entry, paused ? 60000 : Math.min(3000 * 2 ** (entry.retries - 1), 60000), paused);
      } else if (!entry.items.length) { cancelTimer(entry); entries.delete(key); }
    }
  }
  /** 重复触发共享当前执行Promise，并在尾沿调度尚未处理的消息。 */
  function flush(): Promise<void> {
    if (running) { again = true; return running; }
    // 先登记所有权再执行dispatch，避免同步回调重入启动第二轮。
    running = Promise.resolve().then(run).finally(() => {
      running = null;
      if (again) {
        again = false;
        for (const [key, entry] of entries) if (entry.items.length && entry.timer === undefined) schedule(key, entry, 200);
      }
    });
    return running;
  }
  /** 清理指定会话，包括重试、提示冷却及已经取走的批次归属。 */
  function forget(key: string): void {
    const entry = entries.get(key); if (entry) cancelTimer(entry);
    entries.delete(key); hintAt.delete(key);
  }
  /** 清理所有会话；旧flush结束时不会清理后续新入队的数据。 */
  function clear(): void { for (const key of entries.keys()) forget(key); hintAt.clear(); }
  /** 原离线提示冷却规则；只有返回true的调用方才发送提示。 */
  function shouldNotify(key: string): boolean {
    const now = deps.now?.() ?? Date.now();
    if ((hintAt.get(key) ?? 0) + cooldown >= now) return false;
    hintAt.set(key, now); return true;
  }
  // 普通退役保留补投，只清提示冷却；显式重置才清队列。
  return Object.freeze({enqueue, flush, forget, clear, shouldNotify, clearHint: (key: string) => {hintAt.delete(key);},
    has: (key: string) => entries.has(key),
    status: (key: string) => {const entry = entries.get(key); return entry ? Object.freeze({pending: entry.items.length, running: entry.running, retries: entry.retries}) : undefined;},
  });
}
