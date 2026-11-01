/// <reference types="node" />
/** 一代消息保留原窗口字段；媒体类型贯穿上下文和实际投递。 */
export interface LegacySocialMessage<Media> {sender:string;text:string;plain:string;quoteTargetIsSelf?:boolean;isOwner:boolean;media:Media[];messageId:string;hasMedia:boolean;time:number;}
export interface LegacySummary<Media> {items:LegacySocialMessage<Media>[];since:number;}
/** 会话状态字段由旧状态机维护；phase兼容宿主的实时可写视图。 */
export interface LegacyConversationState {phase:string;lastCheckAt:number;nextCheckAt:number;lastActiveMessageAt:number;activeEnteredAt:number;
 activeDeadlineAt:number;activeExitAt:number;lastAiReplyAt:number;lastFollowUpAt:number;probeDeadline:number;proactiveNextCheckAt:number;}
/** 宿主仍共享视图以接入回合收尾和管理端，集合由引擎创建并负责定时清理。 */
export interface LegacySocialState<Media> {states:Map<string,LegacyConversationState>;recentMessages:Map<string,LegacySocialMessage<Media>[]>;
 pendingSummaries:Map<string,LegacySummary<Media>>;silentContext:Map<string,LegacySocialMessage<Media>[]>;
 loopTimer:ReturnType<typeof setInterval>|null;silentTurns:Map<string,{id:string;ts:number}[]>;
 pendingTimers:Map<string,Set<ReturnType<typeof setTimeout>>>;exitingSessions:Set<string>;}
/** 数值/布尔字段沿既有归一规则；关键词结构沿加载器的原格式假设。 */
export interface LegacySocialConfiguration {social?: Record<string,unknown> & {mustReplyKeywords?: unknown};}
