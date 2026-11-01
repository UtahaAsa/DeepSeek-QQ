import {createBridgeManagementClient} from './role-management.mjs';
const operations=new Map([['state',['GET','/api/phone/status']],['configure',['POST','/api/phone/configuration']],
  ['recover',['POST','/api/phone/recover']],['action',['POST','/api/phone/action']]]);
/**
 * 只代理所属桥接的电话管理动作；复用进程、端口和代次核验，控制台凭据留在服务端。
 * @param {object} options 同既有角色管理客户端；不从HTTP接受目录、端口或SDK操作。
 * @returns {function(string,object=):Promise<object>} 状态、配置、恢复和当前通话动作的安全投影。
 * @note 恢复只返回任务受理，后续状态才确认结果；不转发原始音频或原生信令。
 */
export function createPhoneClient(options){
  const state=['settings','closed','phase','prepared','prepareUnknown','stopUnknown','failureCode','busy','incomingAvailable',
    'outgoingAvailable','call','activeCall','dialog','model','resources','recovery'];
  return createBridgeManagementClient({...options,definitions:operations,unavailable:'PHONE_MANAGEMENT_UNAVAILABLE',rejected:'PHONE_OPERATION_REJECTED',
    allowedErrors:['PHONE_MANAGEMENT_UNCONFIRMED','PHONE_NOT_ALLOWED','PHONE_NOT_READY','CALL_STALE','CALL_OUTGOING_UNAVAILABLE','CALL_REASON_INVALID','PHONE_STOP_UNCONFIRMED'],
    fields:operation=>operation==='state'?state:operation==='configure'?['ok','settings']:operation==='recover'?['ok','accepted','recovery']
      :['ok','callId','phase','connected','ended','confirmed','reason','terminalEvidence','lastCommandOutcome']});
}
