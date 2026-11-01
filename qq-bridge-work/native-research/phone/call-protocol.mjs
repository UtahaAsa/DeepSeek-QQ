import { randomUUID } from 'node:crypto';
const fail = code => Object.assign(new Error(code),{code});
const integer = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const int32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const uid = value => typeof value === 'string' && /^u_[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value,max) => typeof value === 'string' && Buffer.byteLength(value) <= max && !value.includes('\0');

/**
 * 将当前SDK真实邀请转换为受限接听/退出动作，原始邀请只保存在所属worker内存中。
 * @param {object} options generation为所属进程代次；submit只接固定accept/quit/reject/close，
 * emit只将邀请身份和所属ref交给父驱动；clock与makeRef可注入隔离测试。
 * @returns {object} bind/observe/accept/end/ignore/canOpenMedia/snapshot；一进程只处理一次已提交通话，
 * 防止没有ref的SDK房间回调跨越两通电话。start尚未实现，不能据此宣布主动拨号可用。
 * @note 命令受理与SDK入房/离房分别处理；回执0不能伪造终态。只匹配本账号的私聊邀请。
 */
export function createCallProtocol({generation,submit,emit,onAcceptRequested=()=>{},onEndRequested=()=>{},clock=Date.now,makeRef=()=>'in_'+randomUUID(),inviteTtlMs=30000}) {
  if (typeof generation !== 'string' || !/^[A-Za-z0-9_:-]{8,160}$/.test(generation)
      || ![submit,emit,onAcceptRequested,onEndRequested].every(v=>typeof v==='function')
      || !Number.isInteger(inviteTtlMs) || inviteTtlMs < 1 || inviteTtlMs > 120000) throw fail('CALL_PROTOCOL_CONFIGURATION_INVALID');
  let selfUid=null,loginCorrelation=null,call=null,loginConfirmed=false,used=false,lastInviteShape=null,lastEndReceipt=null,lastTerminalEvent=null;
  const owned=lease => call && lease && lease.generation === generation && lease.ref === call.ref
    && Number.isSafeInteger(lease.revision) && lease.revision >= 0
    && (call.revision === null || call.revision === lease.revision);
  function bind(value,correlation) {
    if (selfUid !== null || !uid(value) || !Number.isSafeInteger(correlation) || correlation < 1) throw fail('CALL_PROTOCOL_BIND_REFUSED');
    selfUid=value;loginCorrelation=correlation;
  }
  function notify(type) {emit({type,generation,ref:call.ref,issuedAt:clock()});}
  function notifyInvite() {
    if (!call || call.notified || !loginConfirmed || clock()-call.issuedAt > inviteTtlMs) return;
    call.notified=true;emit({type:'invite',generation,ref:call.ref,callerUid:call.peerUid,issuedAt:call.issuedAt});
  }
  function expireInvite() {
    if (call?.phase === 'incoming' && !used && (clock() < call.issuedAt || clock() - call.issuedAt > inviteTtlMs)) call = null;
  }
  // 只丢弃从未提交给SDK的本地邀请；不接听、不拒接或挂断任何原生通话。
  function ignore(lease) {
    if (!owned(lease) || used || call.phase !== 'incoming') return {outcome:'not_submitted'};
    call = null; return {outcome:'ignored'};
  }
  function observe(message) {
    expireInvite();
    if (!message || !Number.isInteger(message.cmd)) return;
    const value=message.value;
    // 提交回执只能说明SDK返回了什么，不能代替本次通话的真实离房事件。
    // 严格关联当前命令与关联号，只投影类型、长度和有界整数，不保存原生载荷。
    if (call?.endSubmitted && call.endCorrelation!==undefined && message.cmd===call.endCommand && message.id===call.endCorrelation && !lastEndReceipt) {
      const array=Array.isArray(value),first=array?value[0]:undefined;
      lastEndReceipt=Object.freeze({command:message.cmd,correlationMatched:true,array,arity:array?Math.min(value.length,64):null,
        firstType:first===null?'null':Array.isArray(first)?'array':typeof first,
        returnCode:Number.isSafeInteger(first)&&first>=-2147483648&&first<=2147483647?first:null});
    }
    if (message.cmd === 1 && selfUid && message.id === loginCorrelation && Array.isArray(value) && value[0] === 0) {
      loginConfirmed=true;emit({type:'login_ready',generation});notifyInvite();return;
    }
    if (message.cmd === 20006) {
      const array=Array.isArray(value),fieldType=v=>Array.isArray(v)?'array':v===null?'null':typeof v;
      lastInviteShape=Object.freeze({array,arity:array?value.length:null,
        fieldTypes:array?Object.freeze(Array.from({length:Math.min(12,value.length)},(_,index)=>fieldType(value[index]))):null,
        peerUidValid:array&&uid(value[1]),selfAt2Matches:array&&value[2]===selfUid,
        selfIn2Array:array&&Array.isArray(value[2])&&value[2].slice(0,64).includes(selfUid),accepted:false});
      // Windows原生Accept的char**/count是数组展开，PPAPI仍只有七项参数。
      if (!selfUid || !Array.isArray(value) || value.length < 12 || !integer(value[0]) || !uid(value[1])
          || !Array.isArray(value[2]) || value[2].length>64 || value[1] === selfUid || !integer(value[3]) || !text(value[4],512)
          || ![true,false,0,1].includes(value[10]) || !text(value[11],256*1024) || used) return;
      // 现场Windows回调的第三项是列表，不是本账号UID。它不用于接听参数或许可判断；
      // 本账号由当前原生会话与bind固定，父驱动仍须把inviter UID映射到当前授权私聊。
      if (call?.phase==='ended' && !used) call=null; // 取消的未提交邀请没有进入SDK通话，可接收下一条邀请。
      if (call) return; // 同一邀请/额外来电均不能替换已交给控制层的所属ref。
      const ref=makeRef();
      if (typeof ref !== 'string' || !/^[A-Za-z0-9_:-]{8,160}$/.test(ref)) throw fail('CALL_PROTOCOL_REF_INVALID');
      call={ref,revision:null,phase:'incoming',issuedAt:clock(),scene:value[0],peerUid:value[1],notified:false,
        params:[value[0],value[1],[value[1]],value[3],value[4],Boolean(value[10]),value[11]],endSubmitted:false,
        metadata:Object.freeze({scene:value[0],businessType:value[3],inviteArity:value.length,
          relationEmpty:value[4].length===0,relationBytes:Buffer.byteLength(value[4]),useNtrtcDsp:Boolean(value[10]),dspBytes:Buffer.byteLength(value[11])})};
      lastInviteShape=Object.freeze({...lastInviteShape,accepted:true});
      notifyInvite();return;
    }
    // 固定Windows SDK的OnChatClosed为20022，信封由两个int32、bool转int、int32及两个字符串组成。
    // 2026-11-01真实挂断只收到此事件；静态回调核对见avsdk-observed-phone-events-20261101.json。
    // 20013为其他终端变化，不能据此关闭电话；一worker仅允许一次已提交通话，不能跨代复用。
    const chatClosed = message.cmd === 20022 && Array.isArray(value) && value.length === 6
      && int32(value[0]) && int32(value[1]) && (value[2] === 0 || value[2] === 1)
      && int32(value[3]) && text(value[4],16384) && text(value[5],16384);
    // 当前worker只拥有这一通邀请；对方可在手动接听或入房完成前取消。
    // 未发布给父驱动的预登录邀请仅清除本地候选，不发出无归属的结束事件。
    if (call && (chatClosed || message.cmd === 20005 && Array.isArray(value) && value.length === 0)) {
      if (!call.notified && !used) {call=null;return;}
      if (['incoming','accepting','connected','ending'].includes(call.phase)) {
        lastTerminalEvent=Object.freeze({command:message.cmd,closeReason:chatClosed?value[0]:null,errorCode:chatClosed?value[1]:null,userEventExited:chatClosed?value[2]===1:null});
        call.phase='ended';call.params=null;notify('ended');
      }
      return;
    }
    if (!call || !used) return;
    if (message.cmd === 20004 && Array.isArray(value) && value[0] === 0 && call.phase === 'accepting') {
      call.phase='connected';notify('connected');
    }
  }
  function accept(lease) {
    expireInvite();
    if (!loginConfirmed || !owned(lease) || used || call.phase !== 'incoming'
        || clock()-call.issuedAt > inviteTtlMs || clock() < call.issuedAt) throw fail('CALL_PROTOCOL_ACCEPT_REFUSED');
    call.revision=lease.revision;call.phase='accepting';used=true;
    onAcceptRequested();
    // 先占用资格；提交后抛错也不能再次接听，避免重复操作。
    const correlation=submit('accept',call.params);
    return {outcome:'accepted',correlation};
  }
  function end(lease) {
    if (!owned(lease) || !call || ['ended'].includes(call.phase)) throw fail('CALL_PROTOCOL_END_REFUSED');
    if (call.endSubmitted) return {outcome:call.endOutcome,duplicate:true};
    call.revision=lease.revision;call.endSubmitted=true;call.endOutcome='unknown';used=true;
    const wasIncoming=call.phase === 'incoming';call.phase='ending';
    onEndRequested();
    // 固定Windows SDK：Quit只处理房间scene 2..7，私聊scene 1需Close(peer)。
    // scene与peer只来自本次真实邀请；原因码仍固定0，不把模型文字交给SDK。
    const privateClose=!wasIncoming&&call.scene===1;
    call.endCommand=wasIncoming?9:privateClose?10:8;
    const operation=wasIncoming?'reject':privateClose?'close':'quit';
    const correlation=submit(operation,wasIncoming||privateClose?[call.scene,call.peerUid,0]:[call.scene,0]);
    call.endCorrelation=correlation;
    call.endOutcome='accepted';
    return {outcome:'accepted',correlation};
  }
  function canOpenMedia(lease) {return owned(lease) && call.phase === 'connected';}
  function snapshot() {expireInvite();return {loginConfirmed,phase:call?.phase ?? 'idle',used,endSubmitted:call?.endSubmitted ?? false,
    inviteContract:call?.metadata??null,lastInviteShape,lastEndReceipt,lastTerminalEvent,actualCallVerified:false};}
  return Object.freeze({bind,observe,accept,end,ignore,canOpenMedia,snapshot});
}
