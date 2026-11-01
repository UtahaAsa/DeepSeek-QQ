/** 模型应用结果；failed不可当作成功缓存。 */
export type ApplyResult = 'applied' | 'not-found' | 'failed';
/** 配置读取边界保留unknown，模型请求在modelSelection中统一转成字符串。 */
export interface ModelConfiguration { provider?: unknown; model?: unknown; reasoningEffort?: unknown; }
/** 已归一化的模型请求快照。 */
export interface Selection { provider: string; model: string; reasoningEffort: string; }
interface Entry { epoch: number; key: string; result?: 'applied' | 'not-found'; task?: Promise<ApplyResult>; }
/** RPC响应保持unknown，必须校验selected结构后才能缓存成功。 */
export interface SessionModelOptions {
  getConfiguration: () => ModelConfiguration | null | undefined;
  selectModel: (request: Selection & {sessionId: string}) => Promise<unknown>;
  unwrap: (response: unknown,method: string) => unknown;
  sleep: (ms: number) => Promise<unknown>; log: (message: string) => void;
}
/** 每会话的应用与失效操作，不公开任务表。 */
export interface SessionModelManager {
  readonly ensure: (sessionId: string) => Promise<ApplyResult>;
  readonly forget: (sessionId: string) => void; readonly invalidateAll: () => void;
}
import {REASONING_EFFORT_DEFAULT} from '../config/inputs.js';
/**
 * 按既有默认值生成本次模型选择参数，不改写配置。
 * @param {ModelConfiguration|null|undefined} configuration 当前DSH配置。
 * @returns {Selection} 本次请求参数快照；同步纯函数。
 */
export function modelSelection(configuration: ModelConfiguration | null | undefined): Selection {
  return {provider:String(configuration?.provider||'deepseek-official'),model:String(configuration?.model||'deepseek-flash'),
    reasoningEffort:String(configuration?.reasoningEffort||REASONING_EFFORT_DEFAULT)};
}
/** @param {unknown} error @returns {string} 原错误的可比较文本。 */
function errorMessage(error: unknown): string {
  const message=error!==null&&typeof error==='object'&&'message' in error?error.message:undefined;
  return String(message??error??'');
}
/**
 * 管理所属桥接的会话模型应用记录、并发任务及配置失效。
 * @param {{getConfiguration:()=>ModelConfiguration|null|undefined,selectModel:(request:Selection&{sessionId:string})=>Promise<unknown>,unwrap:(response:unknown,method:string)=>unknown,sleep:(ms:number)=>Promise<unknown>,log:(message:string)=>void}} options 模型RPC与状态读取能力；构造不执行RPC。
 * @returns {{ensure:(sessionId:string)=>Promise<ApplyResult>,forget:(sessionId:string)=>void,invalidateAll:()=>void}} 会话应用、清理与整体失效接口。
 * @note 每会话串行；同一配置并发请求合并。最多尝试两次、间隔1000ms；过期任务返回failed且不缓存。
 * 本地失效不代表底层RPC已取消，后续任务等待旧RPC结束后才提交，避免旧选择晚于新选择生效。
 */
export function createSessionModels({getConfiguration,selectModel,unwrap,sleep,log}: SessionModelOptions): SessionModelManager {
  let epoch=0;
  /** @type {Map<string,Entry>} */
  const entries=new Map<string,Entry>();
  /** @type {Map<string,Promise<ApplyResult>>} */
  const tails=new Map<string,Promise<ApplyResult>>();
  const selectionKey=()=>JSON.stringify(modelSelection(getConfiguration()));
  /** @param {string} sessionId @returns {Promise<ApplyResult>} */
  function ensure(sessionId: string): Promise<ApplyResult> {
    try {
      const selection=modelSelection(getConfiguration()),key=JSON.stringify(selection),previous=entries.get(sessionId);
      if(previous?.epoch===epoch&&previous.key===key) {
        if(previous.result)return Promise.resolve(previous.result);
        if(previous.task)return previous.task;
      }
      /** @type {Entry} */
      const entry: Entry={epoch,key};entries.set(sessionId,entry);
      const current=()=>entries.get(sessionId)===entry&&entry.epoch===epoch&&selectionKey()===key;
      /** @returns {Promise<ApplyResult>} */
      async function run(): Promise<ApplyResult> {
        let lastError: unknown;
        for(let attempt=1;attempt<=2;attempt++) {
          if(!current())return 'failed';
          try {
            const result=unwrap(await selectModel({sessionId,...selection}),'session.selectModel');
            if(!current())return 'failed';
            if(!result||typeof result!=='object'||!('selected' in result)||!result.selected||typeof result.selected!=='object')throw Error('MODEL_SELECTION_RESPONSE_INVALID');
            const selected=(result.selected as ModelConfiguration);
            if(typeof selected.provider!=='string'||!selected.provider.trim()||typeof selected.model!=='string'||!selected.model.trim())throw Error('MODEL_SELECTION_RESPONSE_INVALID');
            log(`已设置会话模型 ${sessionId} -> ${selected.provider}/${selected.model} (${selected.reasoningEffort??'默认'})`);
            if(!current())return 'failed';
            entry.result='applied';return 'applied';
          }catch(error) {
            if(!current())return 'failed';
            lastError=error;log(`设置会话模型失败 ${sessionId}（第 ${attempt}/2 次）: ${errorMessage(error)}`);
            if(attempt<2)await sleep(1000);
          }
        }
        if(!current())return 'failed';
        if(/not[- ]?found/i.test(errorMessage(lastError))){entry.result='not-found';return 'not-found';}
        return 'failed';
      }
      const prior=tails.get(sessionId);
      const task=(prior?prior.catch(()=>{}):Promise.resolve()).then(run);
      entry.task=task;tails.set(sessionId,task);
      const cleanup=()=>{
        if(tails.get(sessionId)===task)tails.delete(sessionId);
        if(entries.get(sessionId)===entry){delete entry.task;if(!entry.result)entries.delete(sessionId);}
      };
      task.then(cleanup,cleanup);
      return task;
    }catch(error){return Promise.reject(error);}
  }
  return Object.freeze({ensure,forget:(sessionId: string)=>{entries.delete(sessionId);},
    invalidateAll:()=>{epoch++;entries.clear();}});
}
