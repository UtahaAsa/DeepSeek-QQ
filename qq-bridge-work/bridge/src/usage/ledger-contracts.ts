/** 已归一化的互不重叠用量桶；reasoning作为附加指标，不重复纳入计费总量。 */
export interface TokenBuckets {cacheMiss:number;cacheHit:number;cacheWrite:number;output:number;reasoning:number;}
export type BucketInput=Partial<TokenBuckets>|null|undefined;
export interface PriceInput {cacheHit?:unknown;cacheMiss?:unknown;cacheWrite?:unknown;output?:unknown;}
/** 配置里的价目/标签保持旧格式投影，归一化不等于验证供应商现行价格。 */
export interface PriceTable {version:string;currency:unknown;symbol:unknown;unit:number;peakMultiplier:number;peakWindows:unknown[][];peakWeekdays:unknown[];holidays:unknown[]|Set<unknown>;models:Record<string,{label:unknown;off:PriceInput}>;fallbackModel:string;}
export interface EffectiveRates {model:string;label:unknown;tier:'peak'|'off';tierLabel:string;currency:unknown;symbol:unknown;unit:number;estimated:boolean;cacheHit:number;cacheMiss:number;cacheWrite:number;output:number;}
export interface LedgerBase {sessionId:string;key:unknown;seq:number;t:number;model:unknown;provider:unknown;buckets:TokenBuckets;}
export interface LedgerSample extends LedgerBase {turn:number;step:number;retry:number;}
export interface RetryAxis {turn:number;step:number;retry:number;seq:number;}
export interface TierCosts {peak:number;off:number;}
export interface LedgerEvicted {sessionId:string;key:unknown;buckets:TokenBuckets;cost:number;byTier:TierCosts;estimated:boolean;dropped:number;maxSeq:number;}
export interface LedgerTurn {sessionId:string;key:unknown;turn:number;steps:number;attempts:number;startedAt:number;endedAt:number;model:unknown;provider:unknown;buckets:TokenBuckets;cost:number;tier:'peak'|'off'|'mixed'|null;}
export interface LedgerIndexEntry {liveBuckets:TokenBuckets;liveCost:number;liveByTier:TierCosts;allCost:number;allByTier:TierCosts;estimated:boolean;turns:Map<number,LedgerTurn>;models:Set<unknown>;}
export interface LedgerIndexDependencies {baselines:ReadonlyMap<string,LedgerBase>;samples:ReadonlyMap<string,LedgerSample>;evicted:ReadonlyMap<string,LedgerEvicted>;sessionSeen:ReadonlyMap<string,number>;priceTable:PriceTable;now:()=>number;}
export interface LedgerView {key:unknown;sessionIds:string[];sessions:number;buckets:TokenBuckets;cost:number;unattributedCost:number;attributedCost:number;byTier:TierCosts;turns:number;steps:number;estimated:boolean;lastAt:number;firstAt:number;models:unknown[];}
export interface LedgerQueryDependencies {baselines:ReadonlyMap<string,LedgerBase>;samples:ReadonlyMap<string,LedgerSample>;priceTable:PriceTable;now:()=>number;keyOf:(sid:string)=>unknown;buildIndex:()=>Map<string,LedgerIndexEntry>;sessionView:(key:unknown,sessionIds:string[],index:ReadonlyMap<string,LedgerIndexEntry>)=>LedgerView;turnsOf:(sessionIds:string[],index:ReadonlyMap<string,LedgerIndexEntry>)=>LedgerTurn[];allSessionIds:()=>Set<string>;}
export interface LedgerTimelineDependencies extends Pick<LedgerIndexDependencies,'baselines'|'samples'|'evicted'|'priceTable'|'now'> {keyOf:(sid:string)=>unknown;evictionCovered:(entry:LedgerEvicted|null|undefined)=>boolean;}
/** 构造会加载调用方显式指定的账本；离线测试必须传合成目录，不传用户状态路径。 */
export interface TokenLedgerOptions {file:string;log?:(message:string,error?:unknown)=>void;priceTable?:PriceTable;resolveKey?:(sid:string)=>string|null|undefined;maxLines?:number;now?:()=>number;}
export interface LedgerEvent {type?:unknown;time?:unknown;seq?:unknown;data?:{model?:unknown;provider?:unknown;turn?:unknown;step?:unknown;retry?:unknown;usage?:{model?:unknown}|null;stream?:unknown}|null;}
export interface LedgerProjection {values?:{tokenUsage?:unknown}|null;tokenUsage?:unknown;asOfSeq?:unknown;}
export interface EventInput {sessionId?:unknown;event?:unknown;origin?:'live'|'snapshot';at?:unknown;model?:unknown;provider?:unknown;}
export interface BaselineInput {sessionId?:unknown;projection?:unknown;at?:unknown;model?:unknown;provider?:unknown;}
export interface SnapshotInput {sessionId?:unknown;records?:unknown;at?:unknown;}
export interface SeriesRow {t:number;cost:number;tokens:number;cacheMiss:number;cacheHit:number;cacheWrite:number;output:number;turns:number;steps:number;tier:'peak'|'off'|'mixed'|null;keys:Set<unknown>|unknown[];}
