import {createBridgeManagementClient} from './role-management.mjs';
const definitions={
 sessions:['GET','/api/sessions',['sessions'],[]],
 pending:['GET','/api/pending',['pending'],[]],
 activity:['GET','/api/status',['activity'],[]],
 memory:['GET','/api/socialV2/memory',['ok','raw'],['key']],
 prompt:['GET','/api/socialV2/initial-prompt',['ok','text','exists','entries','maxChars','writable'],['key']],
 'prompt-save':['POST','/api/socialV2/initial-prompt',['ok','chars','writable'],['key','text']],
 'memory-update':['POST','/api/socialV2/memory-update',['ok'],['key','category','oldContent','target','newContent','newExtra']],
 slang:['GET','/api/slang',['entries','config'],[]],
 'slang-add':['POST','/api/slang',['ok','entry','entries'],['content','meaning','usage','example']],
 'slang-confirm':['POST','/api/slang/batch-confirm',['ok','updated','entries'],['ids']],
 'slang-reject':['POST','/api/slang/batch-reject',['ok','updated','entries'],['ids']],
 usage:['GET','/api/tokens/summary?limit=200',['totals','conversations','symbol','currency','nowTier','priceTable'],[]],
 'usage-recent':['GET','/api/tokens/recent?limit=40',['entries','turns','items','symbol'],[]],
 'tool-log':['GET','/api/socialV2/tool-log?limit=100',['entries'],[]],
 feedback:['GET','/api/socialV2/feedback',['entries'],[]],
 states:['GET','/api/socialV2/states',['conversations'],[]],
};
/**
 * 工作台的固定资料管理接口，复用原控制台权限及数据校验。
 * @param {object} options 只接受所属桥接运行目录、进程观察器与当前代次；不向页面开放URL或凭据。
 * @returns {Function} 固定操作到投影结果；输入不符和所属实例变化均拒绝，不自动重试写入。
 */
export function createWorkspaceDataClient(options){
 return async(operation,input={})=>{
  const def=Object.hasOwn(definitions,operation)?definitions[operation]:null,refused=()=>{throw Error('WORKSPACE_DATA_REFUSED');};
  if(!def||!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!def[3].includes(k)))return refused();
  if(['memory','prompt-save','memory-update'].includes(operation)||input.key!==undefined){
   if(!/^(private|group):[1-9]\d{0,19}$/.test(input.key??''))return refused();
  }
  for(const [key,value] of Object.entries(input)){
   if(key==='ids'){if(!Array.isArray(value)||!value.length||value.length>100||value.some(id=>typeof id!=='string'||!id||id.length>128))return refused();}
   else if(typeof value!=='string'||value.length>16000||value.includes('\0'))return refused();
  }
  if(operation==='prompt-save'&&typeof input.text!=='string')return refused();
  if(operation==='memory-update'&&(!['activeTopic','pendingThought','memberImpression'].includes(input.category)||typeof input.newContent!=='string'))return refused();
  if(operation==='slang-add'&&(!input.content?.trim()||!input.meaning?.trim()))return refused();
  const route=def[1]+(def[0]==='GET'&&input.key?'?key='+encodeURIComponent(input.key):'');
  const client=createBridgeManagementClient({...options,definitions:new Map([[operation,[def[0],route]]]),fields:()=>def[2],
   unavailable:'WORKSPACE_DATA_UNAVAILABLE',rejected:'WORKSPACE_DATA_REJECTED'});
  return client(operation,input);
 };
}
