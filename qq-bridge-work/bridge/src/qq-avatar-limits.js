// Generated from qq-avatar-limits.ts. Edit the TypeScript source and run build:typed.
/** 单张头像下载上限；容纳512方形PNG，仍低于模型图片通道的3.2MiB风险边界。 */
export const QQ_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** 同一上限的完整Base64字符数；MCP与读取器保持一致，不能再次用旧256KiB门槛拒绝。 */
export const QQ_AVATAR_MAX_BASE64_CHARS = 4 * Math.ceil(QQ_AVATAR_MAX_BYTES / 3);
/** 头像读取器的驻留字节总预算；单张放宽不扩大总预算。 */
export const QQ_AVATAR_CACHE_MAX_BYTES = 8 * 1024 * 1024;
