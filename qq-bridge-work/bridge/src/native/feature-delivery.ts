/// <reference types="node" />
import type {createNativeReplyQueue} from '../native-reply-queue.js';
import type {nativeChatMessages} from '../native-chat.js';
export interface NativeFeatureDeliveryDependencies {
 readonly nativeCapabilities:{sendText:boolean}|null;readonly assertOutboundAuditOk:(key:string,text:string)=>void;
 readonly nativeSendBatches:Map<string,symbol>;readonly nativeReplyQueue:Pick<ReturnType<typeof createNativeReplyQueue>,'submit'>|null;
 readonly nativeChatMessages:typeof nativeChatMessages;readonly modeCoordinator:{state:{currentMode:string}};
 readonly recordSentMessagesV2:(key:string,messages:string[])=>void;readonly getSocialV2State:(key:string)=>{lastAiReplyAt:number};readonly Date:Pick<DateConstructor,'now'>;
}
/**
 * 将原生功能回复提交到已有回复队列，构造不发送。
 * @param deps 同一发送器的批次表、队列与审计/身份及记账能力。
 * @returns sendNativeFeatureReply的确认回执；失败不重试，本批finally只清除自己仍持有的标记。
 * @note 成功后身份已失效时保留成功回执，只跳过本地记账，不能改报失败诱发重发。
 */
export function createNativeFeatureDelivery(deps:NativeFeatureDeliveryDependencies) {

async function sendNativeFeatureReply(key:string, text:string, guard:()=>undefined):Promise<{submitted:true;confirmed:true}> {
    if (!deps.nativeCapabilities!.sendText) throw new Error('NATIVE_SEND_DISABLED');
    (0, deps.assertOutboundAuditOk)(key, text); guard();
    const batch = Symbol(); deps.nativeSendBatches.set(key, batch);
    let result;
    try { result = await deps.nativeReplyQueue!.submit(key, (0, deps.nativeChatMessages)(text, key.split(':')[0]), guard); }
    finally { if (deps.nativeSendBatches.get(key) === batch) deps.nativeSendBatches.delete(key); }
    if (result.failed) throw new Error('NATIVE_SEND_UNCONFIRMED');
    let receiptCurrent = true;
    try { guard(); } catch { receiptCurrent = false; }
    if (receiptCurrent && deps.modeCoordinator.state.currentMode === 'reserved2') { (0, deps.recordSentMessagesV2)(key, [text]); const st = (0, deps.getSocialV2State)(key); st.lastAiReplyAt = deps.Date.now(); }
    return { submitted: true, confirmed: true };
  }
return {sendNativeFeatureReply};
}
