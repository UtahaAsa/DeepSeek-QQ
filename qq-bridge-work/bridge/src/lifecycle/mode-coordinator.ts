/// <reference types="node" />
import type {SessionRegistry} from '../sessions/creation.js';
import type {normalizeModeInput,settingFromDshNamespace} from '../config/mode-inputs.js';
interface ModeError {message?:unknown;}
interface LocalMode {mode?:unknown;closedAgentPreset?:unknown;}
interface DshSettings {namespaces:{ns?:unknown;user?:unknown;value?:unknown}[];}
interface DshPresets {presets:{id?:unknown;isDefault?:unknown}[];}
export interface ModeConfiguration {ownerQQ?:unknown;agentPreset?:unknown;nativeScope?:unknown;socialV2?:{enabled?:unknown;agentPreset?:unknown;[key:string]:unknown};}
export interface ModeCoordinatorDependencies<Configuration extends ModeConfiguration> {
 readonly cfg:Configuration;readonly nativeBinding:unknown;readonly STATE_DIR:string;
 readonly unwrap:(value:unknown,method:string)=>unknown;readonly api:{settings:{describe:(options:Record<string,never>)=>Promise<unknown>};agentPresets:{list:(options:Record<string,never>)=>Promise<unknown>}};
 readonly normalizeModeInput:typeof normalizeModeInput;readonly settingFromDshNamespace:typeof settingFromDshNamespace;
 readonly normalizeOwnerQQ:(value:unknown)=>number|null;readonly log:(...values:unknown[])=>void;
 readonly readJsonSafe:(file:string,fallback:null)=>unknown;readonly path:Pick<typeof import('node:path'),'join'>;
 readonly allowed:(kind:string,id:unknown,cfg:Configuration)=>boolean;readonly state:SessionRegistry;
 readonly retireSession:(key:string)=>unknown;readonly socialV2:{conversations:Pick<Map<string,unknown>,'keys'>};
 readonly setupSleepTimerV2:(key:string)=>void;readonly scheduleProactiveCheckV2:(key:string)=>void;
 readonly flushQueue:()=>Promise<unknown>;readonly slangWindows:Pick<Map<string,unknown>,'keys'>;readonly maybeQueueSlangExtraction:(key:string)=>void;
 readonly cleanupSocialForModeChange:()=>void;readonly clearAllSocialV2Timers:()=>void;readonly drainAllPromptQueues:(reason:string)=>void;
 readonly setInterval:typeof globalThis.setInterval;
}
/**
 * 管理模式、预设选择、会话策略和DSH探活，构造无IO且不启动轮询。
 * @param deps 实时配置/会话及受限RPC和清理能力；未知RPC按旧协议投影。
 * @returns state为实时可写视图，供控制台与断流处理共享；startDshWatch显式启动一次轮询。
 * @note 群聊预设严格选择，清单未知时不退役会话；异常语义和模式清理顺序保持。
 */
export function createModeCoordinator<Configuration extends ModeConfiguration>(deps:ModeCoordinatorDependencies<Configuration>) {
// 请求序号处理乱序，显式状态写入使旧请求失效；定时轮询另做在途合并。
let modeRevision=0,presetRevision=0,readinessRevision=0,checkRevision=0;
let watchInFlight:Promise<void>|null=null;
let dshReady = false;
let dshCheckStarted = false;
let currentMode = 'chat';
let lastMode = currentMode;
let closedAgentPreset = '';
let dshPresetIds:string[] = [];
let dshDefaultPreset = '';
const checkDsh = async (releaseWatch = () => {}) => {
    const request=++checkRevision,readiness=readinessRevision;
    const isCurrent=()=>request===checkRevision&&readiness===readinessRevision;
    let ok = false;
    try {
      await deps.api.settings.describe({});
      ok = true;
    } catch {}
    if (!isCurrent()) return;
    if (ok) {
      await refreshMode(isCurrent);
      if (!isCurrent()) return;
      // DSH 起来后拉一次 preset 清单；DSH 重启（dshReady 由 false 变 true）时再拉一次。
      if (!dshReady || dshPresetIds.length === 0) {
        try { await refreshPresetList(isCurrent); } catch {}
        if (!isCurrent()) return;
      }
      reconcileSessionPolicies();
      if (!dshReady) {
        dshReady = true;
        lastMode = currentMode;
        (0, deps.log)(`DSH 已就绪（模式: ${currentMode}）`);
        if (currentMode === 'reserved2') {
          // 首次确定模式为 reserved2 后再恢复持久化的有限睡眠定时器，
          // 避免在 initial chat 模式下设置定时器导致 timeout 唤醒被模式守卫吞掉。
          for (const key of deps.socialV2.conversations.keys()) {
            (0, deps.setupSleepTimerV2)(key);
            (0, deps.scheduleProactiveCheckV2)(key);
          }
          (0, deps.log)('桥接模式已确定为 reserved2，恢复有限睡眠定时器');
        }
        // 探活已完成，补投可能等待模型队列；此时允许后续tick检查连接。
        releaseWatch();
        const recoveryMode=modeRevision;
        try { await (0, deps.flushQueue)(); } catch (error) { (0, deps.log)('补投队列异常:', (error as ModeError|null)?.message ?? error); }
        if (!isCurrent() || recoveryMode!==modeRevision) return;
        // DSH 恢复后，把离线期间攒下的黑话学习窗口补触发
        for (const key of [...deps.slangWindows.keys()]) (0, deps.maybeQueueSlangExtraction)(key);
      } else if (currentMode !== lastMode) {
        if (lastMode === 'reserved' && currentMode !== 'reserved') {
          (0, deps.cleanupSocialForModeChange)();
          (0, deps.log)('桥接模式已离开一代仿真模式，清理社交状态');
        }
        if (lastMode === 'reserved2' && currentMode !== 'reserved2') {
          (0, deps.clearAllSocialV2Timers)();
          (0, deps.drainAllPromptQueues)('模式切换，已取消排队中的投递');
          (0, deps.log)('桥接模式已离开二代仿真模式，清理 reserved2 定时器与排队投递');
        }
        if (currentMode === 'reserved2' && lastMode !== 'reserved2') {
          for (const key of deps.socialV2.conversations.keys()) {
            (0, deps.setupSleepTimerV2)(key);
            (0, deps.scheduleProactiveCheckV2)(key);
          }
          (0, deps.log)('桥接模式已进入二代仿真模式，重建有限睡眠定时器');
        }
        (0, deps.log)(`桥接模式已切换为: ${currentMode}`);
        lastMode = currentMode;
      }
    } else if (dshReady) {
      dshReady = false;
      (0, deps.log)('⚠️ DSH 不可用（重启中？），QQ 消息将入队等待');
    }
  };
// 从 DSH settings 读取桥接模式；命名空间未注册时回退本地 state/mode.json
  async function refreshMode(isOwnerCurrent = () => true) {
    const request=++modeRevision;
    const isCurrent=()=>request===modeRevision&&isOwnerCurrent();
    try {
      const s = (0, deps.unwrap)(await deps.api.settings.describe({}), 'settings.describe') as DshSettings;
      if (!isCurrent()) return;
      // DSH 的默认 preset（`agent-presets` 命名空间的 default）——closed-agent 的兜底值来源
      const presetNs = s.namespaces.find((n) => n.ns === 'agent-presets');
      const defaultPreset = (0, deps.settingFromDshNamespace)(presetNs, 'default');
      if (typeof defaultPreset === 'string' && defaultPreset) {
        dshDefaultPreset = defaultPreset;
      }
      const ns = s.namespaces.find((n) => n.ns === 'qq-mode');
      // 规范化后再比较：`simulation` 也走这里（见 MODE_INPUT_ALIASES）。
      // 读取必须 user 层优先：DSH 0.2.0-rc.2 写完 settings 后同进程内 value 不更新，
      // 只读 value 会让控制台切的模式被 5 秒轮询改回去（issue #22）。
      const fromDsh = (0, deps.normalizeModeInput)((0, deps.settingFromDshNamespace)(ns, 'mode'));
      if (fromDsh) {
        currentMode = fromDsh;
        // 原生托管实例以工作台选择为二代引擎开关；安装模板的安全缺省不能吞掉显式模式选择。
        // 仅影响进程内调度，不改磁盘配置，也不授予范围、发送、媒体或管理许可。
        if (deps.nativeBinding && (0, deps.settingFromDshNamespace)(ns, 'workspaceEnabled') === true) {
          deps.cfg.socialV2 = { ...deps.cfg.socialV2, enabled: fromDsh === 'reserved2' };
        }
        // DSH 设置页也可配置管理员 QQ；**留空表示不覆盖 config.json**
        // （见 plugins/qq-mode-console 的 schema 描述）。这里必须显式判断空串：
        // normalizeOwnerQQ('') 返回 null，若照旧 `!== undefined` 就直接赋值，
        // 设置页每次轮询都会把 config.json 里的 ownerQQ 抹成 null —— 而 5 秒一次的
        // refreshMode 会让它「几秒后必然发生」，后果是 closed-agent 谁都不放行、
        // 审批/提问永远等不到管理员回答。
        const rawOwnerValue = (0, deps.settingFromDshNamespace)(ns, 'ownerQQ');
        if (rawOwnerValue !== undefined) {
          const rawOwner = String(rawOwnerValue ?? '').trim();
          if (rawOwner) {
            try {
              deps.cfg.ownerQQ = (0, deps.normalizeOwnerQQ)(rawOwner);
            } catch (error) {
              (0, deps.log)(`DSH settings ownerQQ 无效，已忽略: ${(error as ModeError|null)?.message ?? error}`);
            }
          }
        }
        // DSH 的 qq-mode schema 只有 mode / ownerQQ 两个字段，没有 closedAgentPreset；
        // 该值仍以本地 state/mode.json 为准（用 typeof 判断，允许用空串显式清空），
        // 否则这里提前 return 会让控制台的 preset 下拉变成永远不生效的死设置。
        const localPreset = (0, deps.readJsonSafe)(deps.path.join(deps.STATE_DIR, 'mode.json'), null) as LocalMode|null;
        if (typeof localPreset?.closedAgentPreset === 'string') {
          closedAgentPreset = localPreset.closedAgentPreset;
        }
        return;
      }
    } catch {}
    if (!isCurrent()) return;
    const local = (0, deps.readJsonSafe)(deps.path.join(deps.STATE_DIR, 'mode.json'), null) as LocalMode|null;
    const fromLocal = local ? (0, deps.normalizeModeInput)(local.mode) : null;
    if (fromLocal) currentMode = fromLocal;
    if (typeof local?.closedAgentPreset === 'string' && local.closedAgentPreset) {
      closedAgentPreset = local.closedAgentPreset;
    }
  }

/** 拉取 DSH 当前可用的 agent preset 清单（供控制台下拉与 closed-agent 兜底使用）。 */
  async function refreshPresetList(isOwnerCurrent = () => true) {
    const request=++presetRevision;
    const isCurrent=()=>request===presetRevision&&isOwnerCurrent();
    try {
      const { presets: list } = (0, deps.unwrap)(await deps.api.agentPresets.list({}), 'agentPresets.list') as DshPresets;
      if (!isCurrent()) return;
      dshPresetIds = list.map((p) => String(p.id));
      if (!dshDefaultPreset) {
        const marked = list.find((p) => p.isDefault === true);
        if (marked) dshDefaultPreset = String(marked.id);
      }
    } catch (error) {
      if (!isCurrent()) return;
      (0, deps.log)(`获取 DSH preset 列表失败：${(error as ModeError|null)?.message ?? error}（会话将按配置的 preset 尝试创建）`);
    }
  }

/** 当前模式是否允许该会话进入 */
  function modeAllowed(key:string, kind:string, id:unknown, cfg:Configuration, mode:string) {
    if (mode === 'closed-agent') {
      // 封闭 agent 模式：仅 owner 私聊
      return key === `private:${String(cfg.ownerQQ ?? '')}`;
    }
    // chat / reserved / reserved2（仿真模式，暂同 chat 白名单）
    return (0, deps.allowed)(kind, id, cfg);
  }

/**
   * 解析一个 preset 名。
   *
   * strict=false（closed-agent，仅 owner 私聊）：名字不可用时回退到 DSH 默认 preset ——
   *   那里本来就用完整工具面，回退不构成提权。
   * strict=true（chat / reserved / reserved2，会话可能属于 QQ 群）：名字不可用时返回 ''，
   *   表示「没有可安全使用的 preset」，由调用方拒绝建会话（fail-closed）。
   *   **绝不能回退到 DSH 默认 preset（standard）**：standard 含 bash/文件读写等本地工具，
   *   一旦套在群聊会话上，群友即可驱动一个能操作本机的 agent（见 RULES.md「无本地工具」）。
   */
  function resolvePresetName(name:unknown, { strict = false } = {}) {
    const wanted = String(name ?? '').trim();
    if (!wanted) return strict ? '' : (dshDefaultPreset || '');
    // DSH 可能接受未知 preset 并套用默认值；清单未知时也必须 fail-closed。
    if (dshPresetIds.length === 0) return strict ? '' : wanted;
    if (dshPresetIds.includes(wanted)) return wanted;
    (0, deps.log)(`⚠️ preset "${wanted}" 不在 DSH 可用清单（${dshPresetIds.join(', ')}）中`);
    if (strict) {
      (0, deps.log)(`⛔ 群聊/仿真会话缺少 preset "${wanted}"，拒绝回退到 DSH 默认 preset（会把本地工具暴露给 QQ 群）；请运行 node scripts/setup-dsh.mjs 并重启 DSH`);
      return '';
    }
    return dshDefaultPreset || '';
  }

/** 当前模式下的会话预设；返回 undefined 表示「该模式下没有可安全使用的 preset」 */
  function modePreset(key:string, mode:string, cfg:Configuration) {
    if (mode === 'closed-agent') {
      const chosen = resolvePresetName(closedAgentPreset);
      if (!chosen) (0, deps.log)('⚠️ 无法确定 closed-agent 的 preset（DSH preset 清单未知），将按 DSH 默认 preset 建会话');
      return chosen || undefined;
    }
    // 二代仿真模式优先使用 socialV2.agentPreset；未配置时回退到默认聊天预设。
    // 非 closed-agent 一律 strict：宁可建不出会话，也不给群聊套上带本地工具的默认 preset。
    const wanted = mode === 'reserved2' ? (cfg.socialV2?.agentPreset || cfg.agentPreset) : cfg.agentPreset;
    return resolvePresetName(wanted, { strict: true }) || undefined;
  }

/** 判断一个会话 key 是否仍被当前模式/白名单允许（供唤醒调度与 HTTP 路由共用）。 */
  function isSessionAllowedInCurrentMode(key:string) {
    const m = /^(group|private):(\d+)$/.exec(key);
    if (!m) return false;
    return modeAllowed(key, m[1], deps.cfg.nativeScope ? m[2] : Number(m[2]), deps.cfg, currentMode);
  }

function sessionPolicy(key:string) {
    return JSON.stringify([currentMode, modePreset(key, currentMode, deps.cfg) ?? '', currentMode === 'closed-agent' ? deps.cfg.ownerQQ : null]);
  }

function isCurrentSession(key:string, sessionId:string|undefined) {
    return isSessionAllowedInCurrentMode(key) && deps.state.sessions[key] === sessionId
      && deps.state.sessionPolicies[key] === sessionPolicy(key);
  }

function reconcileSessionPolicies() {
    // DSH preset 清单未知时**绝不能**做退役判定。
    //
    // 为什么：`sessionPolicy()` 包含 `modePreset()` 的结果，而 `modePreset()` 依赖
    // `dshPresetIds`（来自 DSH 的 `agentPresets/list`）。启动瞬间或一次瞬时失败时
    // 这个清单可能是空的，`resolvePresetName(strict)` 于是返回 ''，算出来的策略就变成
    // `["reserved2","",null]` —— 与已存的 `["reserved2","qq-chat-v2",null]` 不等，
    // 于是**所有** QQ 会话在这一个 tick 里被集体退役：DSH 会话被停掉归档、agentToken 轮换、
    // 映射删除，每个群的上下文全丢，日志里只有一句「会话权限已变化」。
    // 一次网络抖动换来全体失忆，代价完全不成比例。清单为空时宁可不判定，等下一轮。
    if (dshPresetIds.length === 0) return;
    for (const [key, sessionId] of Object.entries(deps.state.sessions)) {
      if (!isCurrentSession(key, sessionId)) (0, deps.retireSession)(key);
    }
  }

function startDshWatch() {
    if (dshCheckStarted) return;
    dshCheckStarted = true;
    const tick=()=>{
      if(watchInFlight)return;
      const task=checkDsh(()=>{if(watchInFlight===task)watchInFlight=null;});watchInFlight=task;
      void task.catch((error:unknown)=>(0,deps.log)('DSH 探活异常:',error))
        .finally(()=>{if(watchInFlight===task)watchInFlight=null;});
    };
    tick();
    (0, deps.setInterval)(tick, 5000);
  }
return {refreshMode,refreshPresetList,modeAllowed,resolvePresetName,modePreset,isSessionAllowedInCurrentMode,sessionPolicy,isCurrentSession,reconcileSessionPolicies,startDshWatch,checkDsh,state:{get dshReady(){return dshReady;},set dshReady(value:boolean){readinessRevision++;dshReady=value;},get currentMode(){return currentMode;},set currentMode(value:string){modeRevision++;currentMode=value;},get lastMode(){return lastMode;},set lastMode(value:string){lastMode=value;},get closedAgentPreset(){return closedAgentPreset;},set closedAgentPreset(value:string){modeRevision++;closedAgentPreset=value;},get dshPresetIds(){return dshPresetIds;},set dshPresetIds(value:string[]){presetRevision++;dshPresetIds=value;},get dshDefaultPreset(){return dshDefaultPreset;},set dshDefaultPreset(value:string){modeRevision++;presetRevision++;dshDefaultPreset=value;}}};
}
