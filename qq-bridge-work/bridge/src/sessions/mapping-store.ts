/// <reference types="node" />
import type {SessionRegistry} from './creation.js';
/** 旧文件的业务投影，不额外宣称校验了历史映射中的每个值。 */
export interface SessionMappingState {sessions:SessionRegistry['sessions'];sessionPolicies?:SessionRegistry['sessionPolicies'];[key:string]:unknown;}
interface MappingError {code?:unknown;message?:unknown;}
export interface SessionMappingDependencies {
 readonly fs:Pick<typeof import('node:fs'),'readFileSync'>;readonly STATE_FILE:string;
 readonly log:(message:string)=>void;readonly atomicWriteJson:(file:string,value:SessionMappingState)=>undefined;
}
/**
 * 持有会话文件与只读降级状态；构造只创建内存对象，loadState由宿主显式调用。
 * @param deps 所属状态文件和同步读写、日志能力。
 * @returns 实时state与writable视图及loadState/saveState；损坏或非缺失读取失败后禁止回写。
 * @note loadState可能替换state，调用方应在加载后重新获取引用；不删除用户会话文件。
 */
export function createSessionMappingStore(deps:SessionMappingDependencies) {
let state:SessionMappingState = { sessions: {} };
let stateWritable = true;
function loadState():undefined {
  let raw;
  try {
    raw = deps.fs.readFileSync(deps.STATE_FILE, 'utf8');
  } catch (error) {
    state = { sessions: {}, sessionPolicies: {} };
    if ((error as MappingError|null)?.code !== 'ENOENT') {
      stateWritable = false;
      (0, deps.log)(`⚠️ sessions.json 读取失败，已降级为「只读不写」（不会覆盖原文件）：${(error as MappingError|null)?.message ?? error}`);
    }
    return;
  }
  let loaded:SessionMappingState|null = null;
  if (raw.trim() !== '') {
    try {
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      loaded = JSON.parse(text) as SessionMappingState|null;
    } catch (error) {
      state = { sessions: {}, sessionPolicies: {} };
      stateWritable = false;
      (0, deps.log)(`⚠️ sessions.json 内容损坏，已降级为「只读不写」（不会覆盖原文件，请先备份再修复）：${(error as MappingError|null)?.message ?? error}`);
      return;
    }
  }
  if (loaded && loaded.sessions && typeof loaded.sessions === 'object') state = loaded;
  else state = { sessions: {} };
  if (!state.sessionPolicies || typeof state.sessionPolicies !== 'object' || Array.isArray(state.sessionPolicies)) state.sessionPolicies = {};
}

function saveState():undefined {
  // 统一走原子写：固定 `.tmp` 名 + 无 mode 的手写版本会在外部进程（杀软/备份）
  // 占住 sessions.json.tmp 时抛 EPERM，且写出的文件权限与其它 state 文件不一致。
  if (!stateWritable) return; // 见 loadState：读失败/损坏时绝不回写，避免把丢失变成永久
  (0, deps.atomicWriteJson)(deps.STATE_FILE, state);
}
return {loadState,saveState,get state(){return state;},get writable(){return stateWritable;}};
}
