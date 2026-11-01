/** 只读DSH调用能力，不含提示投递、激活Agent或外发能力。 */
export interface NativeReadApi {callUnary:(method:'session/projections'|'session/page',payload:{sessionId:string}|{address:{kind:'session';sessionId:string};throughSeq:number;maxMessages:1})=>Promise<unknown>;}
/** 外部事件只投影元数据；实际序号/回合校验仍由读取器和围栏执行。 */
export interface NativeTurnEvent {type?:unknown;seq?:unknown;data?:{turn?:unknown;reason?:{kind?:unknown}};}
export interface NativeReadResponse {result?:{ok?:unknown;value?:{kind?:unknown;asOfSeq?:unknown;records?:unknown}};}
export interface NativePageRecord {type?:unknown;event?:NativeTurnEvent|null;}
export interface NativeTrackedTurn {readonly turn:unknown;readonly startSeq:unknown;}
export type NativeTerminalReason='completed'|'aborted'|'error';
/** 已匹配当前跟踪回合的结束元数据，不包含正文。 */
export interface NativeTerminalTurn {type:'turn/end';seq:number;data:{turn:number;reason:{kind:NativeTerminalReason}};}
