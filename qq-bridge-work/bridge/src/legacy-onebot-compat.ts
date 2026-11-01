// 旧外部网关的兼容接缝；原生模式关闭发现与自愈，不调用这些兼容操作。
// 保留原模块与许可/历史说明，避免以改名掩盖来源。
export { discoverSnowLumaConnection as discoverLegacyOnebotConnection,
  persistSnowLumaEndpoint as persistLegacyOnebotEndpoint, persistToken } from './snowluma-conn.js';
