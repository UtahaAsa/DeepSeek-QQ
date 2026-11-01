import type {LedgerEvent} from './ledger-contracts.js';


/** 采样键：同一回合同一步骤同一次重试只保留一条（后到覆盖先到）。 */
export function sampleKeyOf(sessionId:string, turn:number, step:number, retry:number) {
  return `${sessionId}|${turn}|${step}|${retry}`;
}


/**
 * 走势图的桶宽阶梯（毫秒）与选择规则。
 *
 * 导出给离线 fixture 复用：控制台走势图的示例数据必须和生产用**同一套桶宽**，
 * 否则「近 7 天」在离线预览里和生产里会是两种粒度，预览就失去意义了
 * （这类两边各写一份常量的漂移，正是这次体检里反复出现的问题）。
 */
export const BUCKET_LADDER_MS = [
  5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000,
  60 * 60 * 1000, 2 * 60 * 60 * 1000, 3 * 60 * 60 * 1000,
  6 * 60 * 60 * 1000, 12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000, 2 * 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000
];


/** 在不超过 maxBuckets 的前提下选最细的桶。 */
export function pickBucketMs(windowMs:number, maxBuckets:number) {
  for (const candidate of BUCKET_LADDER_MS) {
    if (windowMs / candidate <= maxBuckets) return candidate;
  }
  return BUCKET_LADDER_MS[BUCKET_LADDER_MS.length - 1];
}


/**
 * 从 assistant stream 记录里取最后一个 usage 采样。
 * 与 DSH `dsh-token-meter` 的 `lastAssistantStreamChunk(stream, 'usage')` 同义。
 */
export function usageFromStream(stream:unknown):unknown {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const chunk = stream[i] as {usage?:unknown}|null;
    if (chunk && typeof chunk === 'object' && chunk.usage !== undefined) return chunk.usage;
  }
  return undefined;
}


/**
 * 取一条会话事件携带的 provider usage（原始桶，未归一化）。
 * 与 DSH `usageOf(event)` 一致：assistant/message 优先用 data.usage，
 * 否则回落到 assistant/attempt / assistant/message 的 stream 尾部采样。
 */
export function usageOfEvent(event:unknown):unknown {
  if (!event || typeof event !== 'object') return undefined;
  if ((event as LedgerEvent).type === 'assistant/message' && (event as LedgerEvent).data?.usage !== undefined) return (event as LedgerEvent).data!.usage;
  if ((event as LedgerEvent).type !== 'assistant/message' && (event as LedgerEvent).type !== 'assistant/attempt') return undefined;
  return usageFromStream((event as LedgerEvent).data?.stream);
}
