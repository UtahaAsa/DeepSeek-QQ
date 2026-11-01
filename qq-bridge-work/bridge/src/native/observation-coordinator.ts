/// <reference types="node" />
import type {NativeObservationOptions,NativeBackgroundObservation} from '../native-background-observation.js';
import type {readNativeTerminalTurn} from '../native-background-observation.js';
import type {NativeReadApi,NativeTerminalTurn} from './contracts.js';
import type {TrackedSessionTurn} from '../sessions/frame-handler.js';
import type {WakeDispatchResult} from '../wake/dispatch.js';
export interface NativeObservationState {agentToken?:unknown;preSleepWaitSatisfiedAt?:number;pendingWakeReasons?:unknown[];}
export interface NativeObservationIdentity<State extends NativeObservationState> {st:State;token:unknown;generation:number;sessionId:string|undefined;isObservationOwned?:()=>boolean;}
interface DeleteKeys {delete:(key:string)=>unknown;}
export interface NativeObservationCoordinatorDependencies<State extends NativeObservationState> {
 readonly nativePolicyGeneration:number;readonly nativePolicyCurrent:boolean;readonly nativeBinding:unknown;
 readonly modeCoordinator:{state:{currentMode:string;dshReady:boolean}};readonly socialV2:{paused:boolean;conversations:Pick<Map<string,State>,'get'>};
 readonly cfg:{socialV2?:{enabled?:unknown}};readonly state:{sessions:Record<string,string|undefined>};
 readonly isCurrentSession:(key:string,sessionId:string|undefined)=>boolean;readonly isSessionAllowedInCurrentMode:(key:string)=>boolean;
 readonly createNativeBackgroundObservation:(options:NativeObservationOptions<NativeObservationIdentity<State>>)=>NativeBackgroundObservation<NativeObservationIdentity<State>>;
 readonly observationThroughSeqV2:(state:State)=>number;readonly Date:Pick<DateConstructor,'now'>;
 readonly isConversationBusyV2:(key:string,state:State)=>boolean;
 readonly sendWakePromptV2:(key:string,reason:string,identity:NativeObservationIdentity<State>)=>Promise<WakeDispatchResult>;
 readonly pendingWakeKeys:Pick<Set<string>,'has'|'delete'>;readonly nativeTurnFence:{accept:(sessionId:string,event:unknown)=>boolean}|null;
 readonly collectors:DeleteKeys;readonly v2TurnStartAt:DeleteKeys;readonly turnLeaseNoted:DeleteKeys;readonly pendingSendToolCalls:DeleteKeys;
 readonly sendToolSucceededSessions:DeleteKeys;readonly toolCallNames:DeleteKeys;readonly activeWaits:DeleteKeys;
 readonly disarmPendingWakeLease:(key:string)=>void;readonly canonicalV2Key:(key:string)=>string|null|undefined;
 readonly crypto:Pick<typeof import('node:crypto'),'randomBytes'>;readonly rememberAgentToken:(key:string,token:unknown)=>void;
 readonly log:(message:string)=>void;readonly readNativeTerminalTurn:typeof readNativeTerminalTurn;readonly api:NativeReadApi;
}
/**
 * 协调后台观察与只读回合核对，构造不注册计时器、不查询模型。
 * @param deps 所属模式、权限代次、会话对象和清理/唤醒能力，按使用时读取。
 * @returns 跟踪表和观察者，以及身份复核/回合收尾；查询前后均复核对象归属，不重放历史回复。
 * @note 宿主重置与策略撤销继续清理同一跟踪表和观察者。
 */
export function createNativeObservationCoordinator<State extends NativeObservationState>(deps:NativeObservationCoordinatorDependencies<State>) {
const nativeTrackedTurns = new Map<string,TrackedSessionTurn>();
const nativeObservation = deps.nativeBinding ? (0, deps.createNativeBackgroundObservation)({
    isCurrent: nativeObservationCurrent,
    readThrough: (_key, identity) => (0, deps.observationThroughSeqV2)(identity.st),
    onSilence: (_key, identity) => { identity.st.preSleepWaitSatisfiedAt = deps.Date.now(); },
    onWake: async (key, identity, seq, isObservationOwned) => {
      identity.isObservationOwned = isObservationOwned;
      if ((0, deps.isConversationBusyV2)(key, identity.st)) await reconcileNativeTerminal(key, identity);
      if (!nativeObservationCurrent(key, identity)) return { accepted: false };
      if ((0, deps.isConversationBusyV2)(key, identity.st)) return { retry: true };
      if (!deps.modeCoordinator.state.dshReady) return { retry: true };
      const result = await (0, deps.sendWakePromptV2)(key, `background@seq${seq}`, identity);
      if (result?.retry === true) return result;
      return { accepted: deps.pendingWakeKeys.has(key), throughSeq: (0, deps.observationThroughSeqV2)(identity.st), inputThroughSeq: seq };
    },
  }) : null;
function nativeObservationCurrent(key:string, identity:NativeObservationIdentity<State>) {
    return identity?.generation === deps.nativePolicyGeneration && deps.nativePolicyCurrent
      && deps.modeCoordinator.state.currentMode === 'reserved2' && !deps.socialV2.paused && deps.cfg.socialV2?.enabled !== false
      && deps.socialV2.conversations.get(key) === identity.st && identity.st.agentToken === identity.token
      && (!identity.isObservationOwned || identity.isObservationOwned())
      && deps.state.sessions[key] === identity.sessionId && (0, deps.isCurrentSession)(key, identity.sessionId)
      && (0, deps.isSessionAllowedInCurrentMode)(key);
  }

function settleNativeTerminal(key:string, sessionId:string, terminal:NativeTerminalTurn, identity?:NativeObservationIdentity<State>) {
    deps.nativeTurnFence?.accept(sessionId, terminal);
    nativeTrackedTurns.delete(sessionId); deps.collectors.delete(sessionId); deps.v2TurnStartAt.delete(sessionId);
    deps.turnLeaseNoted.delete(sessionId); deps.pendingSendToolCalls.delete(sessionId); deps.sendToolSucceededSessions.delete(sessionId);
    deps.toolCallNames.delete(sessionId); deps.pendingWakeKeys.delete(key); (0, deps.disarmPendingWakeLease)(key);
    deps.activeWaits.delete((0, deps.canonicalV2Key)(key)!);
    const st = deps.socialV2.conversations.get(key);
    if (st && terminal.data.reason.kind !== 'completed') {
      st.pendingWakeReasons = []; st.agentToken = deps.crypto.randomBytes(24).toString('hex'); (0, deps.rememberAgentToken)(key, st.agentToken);
      if (identity?.st === st && identity.generation === deps.nativePolicyGeneration) identity.token = st.agentToken;
      else nativeObservation?.cancel(key);
    }
    (0, deps.log)('原生二代：已核对回合结束，清除忙碌状态；未重发任何历史回复。');
  }

async function reconcileNativeTerminal(key:string, identity:NativeObservationIdentity<State>) {
    const sessionId = deps.state.sessions[key], tracked = nativeTrackedTurns.get(sessionId!);
    if (!deps.nativeBinding || !tracked || tracked.generation !== deps.nativePolicyGeneration || !(0, deps.isCurrentSession)(key, sessionId)
      || !nativeObservationCurrent(key, identity)) return false;
    const terminal = await (0, deps.readNativeTerminalTurn)(deps.api, sessionId, tracked);
    if (!terminal || nativeTrackedTurns.get(sessionId!) !== tracked || tracked.generation !== deps.nativePolicyGeneration
      || !nativeObservationCurrent(key, identity) || !(0, deps.isCurrentSession)(key, sessionId)) return false;
    settleNativeTerminal(key, sessionId!, terminal, identity); return true;
  }
return {nativeObservationCurrent,settleNativeTerminal,reconcileNativeTerminal,nativeTrackedTurns,nativeObservation};
}
