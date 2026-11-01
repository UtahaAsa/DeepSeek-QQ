/// <reference types="node" />
/// <reference lib="dom" />
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {z} from 'zod';
/** 普通请求和长轮询共用参数；正文先由调用方序列化，附加头只接收字符串。 */
export type AgentRequestInit = Omit<RequestInit,'headers'> & {headers?: Record<string,string>; timeoutMs?: number};
/** HTTP载荷保持unknown；每个工具只在既有字段检查的位置投影，不隐式相信远端JSON。 */
export type AgentApi = (route: string, init?: AgentRequestInit) => Promise<unknown>;
export interface LegacyMcpError {message?: unknown; code?: unknown;}
export interface ImageFailure {error: string; submitted?: false; rateLimit?: unknown; retryAfterSeconds?: unknown;}
/** 每个注册函数用Pick限制所需能力；真实SDK从schema推导回调参数及返回格式。 */
export interface McpToolDependencies {
 readonly server: Pick<McpServer,'tool'>; readonly z: typeof z;
 readonly agentApi: AgentApi; readonly agentApiLongPoll: AgentApi;
 readonly serializeModelData: (value: unknown) => string;
 readonly nativeFeatureTokenSchema: z.ZodString | z.ZodOptional<z.ZodString>;
 readonly nativeFeatureHeaders: (featureToken?: string, token?: string) => Record<string,string>;
 readonly unquoteJsonString: (value: string) => string;
 readonly cfg: {nativeFeatureProtocol?: unknown}; readonly QQ_AVATAR_MAX_BASE64_CHARS: number;
 readonly errorText: (value: unknown, fallback: string) => string;
 readonly projectImageGenerationError: (code: unknown, details?: unknown) => ImageFailure;
 readonly imageGenerationErrorInstruction: (failure: ImageFailure) => string;
 readonly onebot: (action: string, params?: Record<string,unknown>) => Promise<unknown>;
 readonly getAccess: () => {allowGroups: string[]; denyGroups: string[]; allowAllWhenEmpty: boolean};
 readonly isAllowed: (allow: string[], deny: string[], id: unknown, allowAllWhenEmpty: boolean) => boolean;
 readonly legacyReadToolAllowed: () => Promise<boolean>;
}
/** 旧媒体工具已假定的图片字段；类型不新增格式验证，输出仍经过原有失败分支。 */
export interface LegacyMcpImage {data?: string; mimeType?: string; file?: unknown; kind?: unknown; index?: unknown; text?: unknown;}
export interface LegacyImageResponse {image?: LegacyMcpImage; error?: unknown; note?: unknown; sticker?: {id?: unknown; desc?: unknown};}
export interface LegacyActionResponse {outcome: string; submitted?: unknown; confirmed?: unknown; action?: unknown; instruction?: unknown;
 field?: unknown; reason: string; backupId?: unknown; restoration?: unknown; audience: string; serverReceipt?: unknown; tid?: unknown;}
