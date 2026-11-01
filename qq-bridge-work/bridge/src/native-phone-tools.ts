import type {NativeToolDependencies} from './native-sticker-tools.js';
import type {z} from 'zod';
/** 注册绑定当前私聊资格的电话工具；不暴露PCM、SDK信令、原生UID或全局准备接口。 */
export function registerNativePhoneTools({server,z,agentApi,headers,featureTokenSchema,serialize}: NativeToolDependencies): void {
  const identity={key:z.string().regex(/^private:[1-9]\d{0,19}$/),featureToken:featureTokenSchema,token:z.string().optional()};
  const callId=z.string().regex(/^qqcall_[a-f0-9]{32}$/);
  const definitions: [string,string,z.ZodRawShape,string][]=[
    ['qq_get_call_status','查看当前私聊的电话状态。只有connected才已接通，ending不代表已挂断。',{},'status'],
    ['qq_accept_call','接听当前私聊正在响铃的callId；仅本次邀请有效，未知结果不重复接听。',{callId},'accept'],
    ['qq_start_call','向当前授权私聊主动发起QQ电话。仅outgoingAvailable=true时使用，一次请求后等状态，不自动重拨。',{},'start'],
    ['qq_end_call','按对话或当前心情结束本次callId。只提交一次，必须核对后续终态，不能把受理回执说成已挂断。',
      {callId,reason:z.enum(['user_requested','conversation_done','needs_rest','uncomfortable','busy'])},'end'],
  ];
  for(const [name,description,fields,operation] of definitions)server.tool(name,description,{...identity,...fields},async input=>{
    try{const {featureToken,token,...body}=input;const value=await agentApi('/api/native/phone/'+operation,{method:'POST',
      body:JSON.stringify(body),headers:headers(featureToken,token),timeoutMs:20000});return {content:[{type:'text',text:serialize(value)}]};
    }catch{return {isError:true,content:[{type:'text',text:'PHONE_UNCONFIRMED：电话操作未确认。查询当前状态或请本机管理员检查电话页；不声称已接通/挂断，不自动重拨。'}]};}
  });
}
