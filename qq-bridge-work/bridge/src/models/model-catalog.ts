import type {ModelConfiguration} from './session-models.js';
import type {ReasoningEffort} from '../config/inputs.js';
/** 未校验的RPC目录投影，仅描述旧实现使用的字段，不当成运行时校验。 */
interface LegacyCatalog {groups?: {id?: unknown; models?: {id?: unknown; reasoning?: {efforts?: {id?: unknown; name?: unknown; description?: unknown}[]; defaultEffort?: unknown}}[]}[];}
interface LegacyCatalogError {message?: unknown;}
/** 只暴露模型目录只读RPC；超时须保留任务结果类型。 */
export interface ModelCatalogDependencies {
 readonly getConfiguration: () => {dsh?: ModelConfiguration};
 readonly callUnary: (method: 'session.modelCatalog'|'session.models', params: Record<string,never>) => Promise<unknown>;
 readonly unwrap: (value: unknown, method: string) => unknown;
 readonly withTimeout: <Result>(task: Promise<Result>, ms: number, label: string) => Promise<Result>;
 readonly log: (message: string) => void;
}
import {REASONING_EFFORT_OPTIONS,REASONING_EFFORT_DEFAULT} from '../config/inputs.js';
/**
 * 构造所属桥接的模型能力查询；每实例持有在途请求与失败日志去重集合。
 * @param {object} options getConfiguration返回当前配置；callUnary、unwrap、withTimeout和log由宿主提供。
 * @returns {function():Promise<object>} 控制台模型摘要；查询失败返回既有内置档位。
 * @note 构造无请求；只合并并发查询，不长期缓存结果。超时只结束观察，不假定底层请求已取消。
 */
export function createModelCatalogQuery({getConfiguration,callUnary,unwrap,withTimeout,log}: ModelCatalogDependencies) {
  let modelCatalogInFlight: Promise<unknown> | null=null;
  const modelCatalogErrorLogged = new Set();
  async function fetchModelCatalog() {
    try {
      return await callUnary('session.modelCatalog', {});
    } catch (error) {
      const message = String((error as LegacyCatalogError | null)?.message ?? error);
      if (!/not.?found|unknown|unsupported|404|invalid server-response/i.test(message)) throw error;
      return callUnary('session.models', {});
    }
  }

  return async function queryModelCatalog() {
    const cfg=getConfiguration();
    const provider = String(cfg.dsh?.provider || 'deepseek-official');
    const model = String(cfg.dsh?.model || 'deepseek-flash');
    // 档位优先取 DSH 实际公布的能力（DSH 换档位词汇或换 provider 时自动跟随），失败退回内置白名单。
    let options = REASONING_EFFORT_OPTIONS.slice();
    let labels: Record<string,{name: unknown; description: unknown}> = {};
    let providerDefault: unknown = null;
    let catalogSource = 'fallback';
    try {
      if (!modelCatalogInFlight) {
        modelCatalogInFlight = withTimeout(fetchModelCatalog(), 3000, 'session/modelCatalog')
          .finally(() => { modelCatalogInFlight = null; });
      }
      const catalog = unwrap(await modelCatalogInFlight, 'session.modelCatalog') as LegacyCatalog | null;
      const group = (catalog?.groups ?? []).find((g) => g?.id === provider);
      const entry = (group?.models ?? []).find((m) => m?.id === model);
      const efforts = entry?.reasoning?.efforts ?? [];
      const advertised = efforts.map((e) => String(e?.id ?? '')).filter((id): id is ReasoningEffort => (REASONING_EFFORT_OPTIONS as readonly string[]).includes(id));
      if (advertised.length) {
        options = advertised;
        labels = Object.fromEntries(efforts.map((e) => [String(e.id), { name: e.name ?? '', description: e.description ?? '' }]));
        providerDefault = entry!.reasoning!.defaultEffort ?? null;
        catalogSource = 'dsh';
      }
    } catch (error) {
      // 同一条失败原因只记一次：控制台每次刷新都会打这条接口，否则日志会被刷爆。
      const reason = String((error as LegacyCatalogError | null)?.message ?? error);
      if (!modelCatalogErrorLogged.has(reason)) {
        modelCatalogErrorLogged.add(reason);
        log(`读取 DSH 模型能力失败，思考强度暂用内置清单：${reason}`);
      }
    }
    return {
      provider,
      model,
      reasoningEffort: String(cfg.dsh?.reasoningEffort || REASONING_EFFORT_DEFAULT),
      options,
      labels,
      default: REASONING_EFFORT_DEFAULT,
      providerDefault,
      catalogSource,
      // selectModel 会同时写会话级与 DSH 全局默认（~/.dsh/settings.yaml 的 agent-default-model），
      // 控制台要把这点明确告诉管理员，避免「只想调 QQ 助手却改了 Web GUI 新会话默认」的意外。
      globalSideEffect: true,
    };

  };
}
