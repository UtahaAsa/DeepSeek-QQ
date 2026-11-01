// Generated from dsh/protocol.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
import { randomUUID } from 'node:crypto';
/** 新协议 RPC 的 args 包装：旧 payload -> { <参数名>: payload }。 */
const METHOD_ARG_WRAPPERS = {
    'session/list': '_request',
    'session/create': 'request',
    'session/prompt': 'request',
    'session/cancel': 'request',
    'session/selectModel': 'request',
    'session/rename': 'request',
    'session/fork': 'request',
    'session/updateQueue': 'request',
    'session/page': 'request',
    'session/search': 'request',
    'session/follow': 'request',
    'session/projections': 'request',
    'workspace/create': 'request',
    'workspace/rename': 'request',
    'workspace/delete': 'request',
    'workspace/archiveSession': 'request',
    'workspace/insertBefore': 'request',
    'workspace/insertSessionBefore': 'request',
    'agentPresets/list': null,
    'settings/describe': null,
};
/** 点号方法名 -> 斜杠 endpoint。 */
export function endpointOf(method) {
    return method.replace(/\./g, '/');
}
/**
 * `session/follow` 开场快照携带的历史事件条数。
 * DSH 默认 50；调大以便控制台能回填更长的「逐轮花费」历史。
 * 该值只影响首帧大小，不影响后续增量事件。
 */
export const FOLLOW_SNAPSHOT_MESSAGES = 200;
/**
 * 从一份 Session 投影值里取出待处理的 inbox 项（`next-turn` + `next-step`）。
 *
 * DSH 0.2.0 的投影形状（`SessionProjectionValues.inbox`，见 dsh-agent 的
 * `InboxWireState`）：`{ 'next-turn': UserMessage[], 'next-step': UserMessage[] }`，
 * 每条是一个序列化后的 `UserMessage`，**带 `id`（MessageId）** —— 这正是
 * `session/updateQueue` 的 `itemId` 需要的值。
 *
 * 与 0.1.7 的差异（这就是线上「停止旧会话失败: invalid session/control baseline」的根因）：
 * 控制流 baseline 曾经把待处理队列平铺在 `value.queues[<sessionId>]`，0.2.0 起
 * 统一并入投影表 `value.projections[<sessionId>].values`，队列本身变成 `inbox` 键。
 * 只认旧字段的实现会在**每一次**退役/重置会话时抛错，队列清不掉 ⇒ 旧任务继续跑。
 *
 * @param values - 单个会话的投影值（`SessionProjectionValues`）。
 * @returns 待处理项数组；该项能力缺失（无 agent / 无 inbox 投影）时为空数组。
 * @throws 当 inbox 存在但结构不是两个数组字段时——结构变了必须显式失败，
 *         否则会静默漏掉待处理消息（正是上面那个缺陷的形态）。
 */
export function inboxItemsOfProjections(values) {
    if (values === null || typeof values !== 'object')
        return [];
    const inbox = values.inbox;
    // 能力缺失（会话没有活动 agent / 未注册 inbox 投影）⇒ 没有待处理项，不是错误。
    if (inbox === undefined)
        return [];
    if (inbox === null || typeof inbox !== 'object' || Array.isArray(inbox)) {
        throw new Error('invalid session inbox projection');
    }
    const items = [];
    for (const boundary of ['next-turn', 'next-step']) {
        const list = inbox[boundary];
        if (list === undefined)
            continue;
        if (!Array.isArray(list))
            throw new Error('invalid session inbox projection');
        items.push(...list);
    }
    return items;
}
/**
 * 校验并抽出待处理项的 `itemId` 列表。
 * @throws 当任何一项缺少可用的字符串 id 时——`session/updateQueue` 需要 MessageId，
 *         拿不到就等于清不掉队列，必须显式失败而不是静默跳过。
 */
export function inboxItemIds(items) {
    return items.map((item) => {
        const id = item?.id;
        if (typeof id !== 'string' || !id)
            throw new Error('invalid session inbox item');
        return id;
    });
}
/**
 * 从 `session/control` 开场 baseline 帧里取出指定会话的待处理项。
 *
 * 0.2.0 的帧形状：`{ type:'baseline', value:{ projections:{ <sessionId>:{ asOfSeq, values } } } }`。
 * baseline 只包含**当前挂在宿主注册表里**的会话；不在其中即「没有活动 agent」⇒ 无待处理项。
 *
 * @throws 当 baseline 的投影表结构不符时（契约变更必须显式失败）。
 */
export function controlBaselineInboxItems(frame, sessionId) {
    const projections = frame?.value?.projections;
    if (projections === null || typeof projections !== 'object' || Array.isArray(projections)) {
        throw new Error('invalid session/control baseline');
    }
    if (!Object.hasOwn(projections, sessionId))
        return [];
    return inboxItemsOfProjections(projections[sessionId]?.values);
}
/** 把旧 payload 包装成新协议要求的 { args }，并补新版必填字段。 */
export function wrapArgs(method, payload) {
    const endpoint = endpointOf(method);
    let body = payload ?? {};
    // 新版 SessionPromptRequest 强制要求 requestId。
    if (endpoint === 'session/prompt' && typeof body.requestId !== 'string') {
        body = { ...body, requestId: randomUUID() };
    }
    const wrapper = METHOD_ARG_WRAPPERS[endpoint];
    if (wrapper === null)
        return { args: {} };
    if (wrapper === undefined)
        return { args: body };
    return { args: { [wrapper]: body } };
}
// 鉴权交换供多个 RPC 共用；取消一个调用只停止它自己的等待，不中断其他调用。
/** @param promise 共享的底层操作。@param signal 当前调用者的取消信号。@returns 仅取消本次等待，不中断共享操作；已取消信号同步抛出其原因。 */
export function waitWithSignal(promise, signal) {
    if (!signal)
        return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
/** 把 RpcResponse 的结果槽解出来；业务错误直接抛出。 */
export function unwrap(response, label) {
    if (response.result.ok)
        return response.result.value;
    const { code, message } = response.result.error;
    throw new Error(`${label} failed: ${code}: ${message}`);
}
