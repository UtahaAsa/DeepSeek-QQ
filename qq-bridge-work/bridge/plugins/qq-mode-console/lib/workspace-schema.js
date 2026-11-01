import z from './schema-runtime.js';
import { WORKSPACE_MODULES, defaultWorkspaceSettings } from './workspace-policy.js';

/**
 * DSH持久偏好表单；号码范围和预算由运行侧再次严格规范化。
 * @returns {object} 可序列化Schemastery对象，只有显式非敏感偏好字段。
 * @note 构造无I/O；热写入此表单仅保存偏好，不冒充运行权限生效。
 */
export function createWorkspaceSchema() {
  const defaults = defaultWorkspaceSettings();
  const enumOf = values => z.union(values.map(value => z.const(value)));
  const range = (min, max, value) => z.number().min(min).max(max).step(1).default(value);
  const scope = () => z.object({ mode: enumOf(['disabled', 'selected', 'all']).default('disabled'),
    ids: z.array(z.string().pattern(/^[1-9]\d{0,19}$/)).max(64).default([]),
    exclude: z.array(z.string().pattern(/^[1-9]\d{0,19}$/)).max(64).default([]) });
  return z.object({ schemaVersion: z.const(1).default(1), reuseLogin: z.boolean().default(true), scope: z.object({ private: scope(), groups: scope() }),
    modules: z.object(Object.fromEntries(WORKSPACE_MODULES.map(module => [module.id, z.object({
      enabled: z.boolean().default(false), options: z.object(Object.fromEntries(Object.keys(module.options).map(key => [key, z.boolean().default(false)]))) })]))),
    idle: z.object({ idleMinutes: range(5, 1440, 30), cooldownMinutes: range(15, 10080, 120), dailyLimit: range(1, 10, 3),
      globalDailyLimit: range(1, 100, 12), quietEnabled: z.boolean().default(true),
      quietStart: z.string().pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('23:00'),
      quietEnd: z.string().pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('08:00') }),
    qzone: z.object({ audience: enumOf(['self', 'friends', 'public']).default('self'),
      cooldownMinutes: range(5, 1440, 120), dailyLimit: range(1, 20, 3) }) }).default(defaults).extra('volatile', true);
}
