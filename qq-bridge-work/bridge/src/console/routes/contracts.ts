import type {ConsoleRouteContext, ConsoleResponse, ConsoleRequestHead} from '../request-context.js';
/** 单次路由共享的宿主上下文；响应头和请求体校验能力仍归宿主持有。 */
export type NamedRouteContext = ConsoleRouteContext & {res: ConsoleResponse; SECURITY_HEADERS: Record<string,string>};
/** 匹配必须同步且无副作用；处理错误交给宿主，完成后不再继续匹配。Context可声明连接事件等额外能力，默认契约保持兼容。 */
export interface NamedConsoleRoute<Context extends NamedRouteContext = NamedRouteContext> {
  matches: (req: ConsoleRequestHead, url: URL) => boolean;
  handle: (context: Context) => Promise<void>;
}
/** 类型只限制命名和处理契约，不赋予路由访问权限。 */
export type NamedConsoleRoutes<Name extends string, Context extends NamedRouteContext = NamedRouteContext> = {[Key in Name]: NamedConsoleRoute<Context>};
