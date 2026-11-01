// Generated from dsh-client.ts. Edit the TypeScript source and run build:typed.
import { resolveDshHome, discoverDshLaunchToken, readBrowserSessionSecret, mintBrowserSessionCookie, discoverDshSessionCookie, isLoopbackBase, BROWSER_SESSION_KEY, MINTED_COOKIE_LIFETIME_MS, MINTED_COOKIE_REFRESH_MARGIN_MS } from './dsh/auth-primitives.js';
import { endpointOf, inboxItemsOfProjections, inboxItemIds, controlBaselineInboxItems, wrapArgs, waitWithSignal, unwrap, FOLLOW_SNAPSHOT_MESSAGES } from './dsh/protocol.js';
import { createTurnCollector, blocksToText } from './dsh/turn-collector.js';
export { resolveDshHome, discoverDshLaunchToken, MINTED_COOKIE_LIFETIME_MS, readBrowserSessionSecret, mintBrowserSessionCookie, discoverDshSessionCookie, isLoopbackBase } from './dsh/auth-primitives.js';
export { FOLLOW_SNAPSHOT_MESSAGES, inboxItemsOfProjections, inboxItemIds, controlBaselineInboxItems, unwrap } from './dsh/protocol.js';
export { createTurnCollector, blocksToText } from './dsh/turn-collector.js';
// Node 环境的 DSH Web API 客户端。
// 兼容 DSH 0.1.2-alpha.1 引入、并在 0.1.5-rc.1 上复核通过的协议：
// 1. RPC 方法从点号改为斜杠（host.describe -> host/describe 等）；
// 2. payload 包装为 { args: { <参数名>: 原payload } }（session/list 用 _request，其余多为 request）；
// 3. 新增浏览器会话鉴权：先用 dsh.authToken（进程启动 token）换取 Cookie，再带 Cookie 访问 API/WS；
// 4. 事件流不再是 events.mux 下行，而是 /api/remote.mux 上按 session/follow 打开的流，
//    Remote Event（提问/审批）走同一条 mux 上的 $events 逻辑流 + $events/result 回执。
// 复核记录（DSH 0.1.5-rc.1，逐项实测）：session/{list,create,prompt,selectModel,rename},
// workspace/{create,rename,archiveSession}, settings/describe, agentPresets/list 的参数形状与
// 返回结构均与本文件一致；session/prompt 在新版强制要求 requestId（wrapArgs 已自动补）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import YAML from 'js-yaml';
import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client';
export class NodeApiClient extends AbstractApiClient {
    /**
     * 创建DSH客户端；构造不访问凭据或网络。
     * @param {string} baseUrl DSH地址。
     * @param {number|undefined} timeoutMs 请求超时。
     * @param {object} auth token仅驻内存；launchTokenOnly=true禁止浏览器密钥和日志发现。
     * @note 单JS线程；原生模式没有启动凭据时拒绝请求，实例不跨线程共享。
     */
    constructor(baseUrl, timeoutMs, auth) {
        super(timeoutMs);
        this.baseUrl = String(baseUrl ?? 'http://127.0.0.1:3080').replace(/\/+$/, '');
        this.auth = auth ?? {};
        // 原生集成只接受所属启动链路的内存凭据，禁止探测浏览器密钥或旧日志。
        this.launchTokenOnly = this.auth.launchTokenOnly === true;
        this.launchToken = this.auth.token || '';
        this.cookie = null;
        this.cookiePromise = null;
        this._authEpoch = 0;
        this._muxSendOpen = null;
        // 持久化签名密钥的探测缓存：undefined=未探测，null=不可用，Buffer=可用。
        // 探一次就够（文件在 DSH 生命周期内不变），避免每个请求都读一次磁盘。
        this._secret = undefined;
        // token 是用户显式配置的（true）还是从日志猜的（false）。猜来的不优先于离线铸造。
        this.tokenExplicit = this.auth.tokenExplicit === true;
        // 上次用的鉴权策略（'minted' | 'token' | null）与「改用 launch token」的偏好。
        // _preferToken **只在铸造出来的 Cookie 真的被 401 时**才置位（见 _doFetchWithAuth）：
        // invalidateAuth() 也会被 remote.mux 流结束（WS 抖动 / DSH 重启）调用，那是常态事件，
        // 拿它当「铸造无效」的证据会把客户端钉死在过期 token 上。
        this._strategy = null;
        this._preferToken = false;
        // 铸造 Cookie 的到期时刻；到期前主动重铸，避免先撞一次 401 再重试。
        this._cookieExpiresAt = 0;
        // 期望 follow 的会话集合：**跨重连保留**。DSH 重启或 WS 中断后必须重放，
        // 否则已有会话再也收不到 session 事件（turn/end 丢失 → QQ 上永远没有回复，且无报错）。
        this._desiredFollows = new Set();
    }
    /** Node 没有 location；把 base 固定为配置的 DSH 地址（回环地址天然通过 /api 信任栅栏）。 */
    resolveBase() {
        return this.baseUrl;
    }
    /** 使当前 Cookie/launch token 失效；DSH 重启或 401 后会自动重新发现最新 token。 */
    invalidateAuth() {
        this._authEpoch += 1;
        this.cookie = null;
        this.cookiePromise = null;
        this._cookieExpiresAt = 0;
        // 密钥文件可能刚被 DSH 重建（首次启动写入凭据），重探一次。
        this._secret = undefined;
        // 这里**刻意不碰 _preferToken**：本方法也被 endStream()（remote.mux 流结束）调用，
        // 而 WS 抖动/DSH 重启都会走到那里——那是常态事件，不是「铸造的 Cookie 无效」的证据。
        // 策略切换只在 _doFetchWithAuth 真正收到 401 时决定。
        this._strategy = null;
        const discovered = this.launchTokenOnly ? '' : discoverDshLaunchToken();
        if (discovered)
            this.launchToken = discovered;
    }
    /** 持久化签名密钥（惰性探测 + 记忆）。 */
    browserSessionSecret() {
        if (this.launchTokenOnly)
            return null;
        if (this._secret === undefined)
            this._secret = readBrowserSessionSecret();
        return this._secret;
    }
    /**
     * 是否具备至少一种鉴权手段：显式配置/可发现的 launch token，或持久化签名密钥。
     * 两者都没有时请求按匿名发出——由服务端回 401，而不是在客户端提前抛错。
     */
    hasAuth() {
        if (this.launchTokenOnly)
            return Boolean(this.launchToken);
        return Boolean(this.launchToken) || this.browserSessionSecret() !== null;
    }
    /**
     * 换取或铸造一个会话 Cookie。
     *
     * 两条路：
     * 1. 有 launch token（config.json 的 dsh.authToken，或从日志发现）→ 走 DSH 的
     *    官方 token 交换；token 是进程启动凭据，只能放进 URL 查询串。
     * 2. 没有 launch token → 用持久化签名密钥**离线铸造** Cookie
     *    （见文件头的说明）。这条路不依赖启动器是否把 stdout 记进日志，
     *    所以 DSH 换启动方式/升级都不再需要重新适配。
     * @param signal - 取消信号。
     * @returns 可直接放进 Cookie 头的串。
     */
    /** 铸造并缓存一个会话 Cookie，同时记下到期时刻。 */
    _mintCookie(secret) {
        this.cookie = mintBrowserSessionCookie(this.baseUrl, secret);
        this._cookieExpiresAt = Date.now() + MINTED_COOKIE_LIFETIME_MS;
        this._strategy = 'minted';
        return this.cookie;
    }
    async ensureAuth(signal) {
        signal?.throwIfAborted();
        if (this.launchTokenOnly && !this.launchToken)
            throw new Error('DSH_LAUNCH_CREDENTIAL_REQUIRED');
        // 铸造来的 Cookie 到期前主动重铸：铸造是纯本地 HMAC、没有网络往返，
        // 比「用到 401 再重试」便宜，也不会在重试窗口里丢掉一次 RPC。
        if (this.cookie && this._strategy !== 'minted')
            return this.cookie;
        if (this.cookie && Date.now() < this._cookieExpiresAt - MINTED_COOKIE_REFRESH_MARGIN_MS)
            return this.cookie;
        this.cookie = null;
        const secret = this.browserSessionSecret();
        // 铸造只对回环地址成立：签名密钥取自本机 DSH_HOME，远程 DSH 用的是另一份密钥，
        // 拿本机密钥去签只会换来 401。
        const canMint = secret !== null && isLoopbackBase(this.baseUrl);
        // 优先级：默认**铸造优先**——它不依赖「启动器有没有把 stdout 记进日志」，也不随
        // DSH 重启失效，是唯一不需要每次升级重新适配的一条路。两个例外：
        // 用户在 config.json 里显式填了 dsh.authToken（那是明确意图，尊重它），
        // 或铸造刚被 401（_preferToken，见 _doFetchWithAuth）。
        if (canMint && !this._preferToken && !this.tokenExplicit)
            return this._mintCookie(secret);
        if (!this.launchToken) {
            if (canMint)
                return this._mintCookie(secret);
            throw new Error('DSH 鉴权不可用：没有可用的 launch token（config.json 的 dsh.authToken 为空，日志里也没发现），'
                + `也读不到 ${path.join(resolveDshHome(), '.credentials.yaml')} 里的 `
                + `${BROWSER_SESSION_KEY} 签名密钥。请在 config.json 里显式设置 dsh.authToken，`
                + '或确认 DSH_HOME 指向真正的 .dsh 目录。');
        }
        // launch token 是**进程启动凭据**，交换时只能放进 URL 查询串（DSH 的协议就这么定的）。
        // 因此绝不能把它发往非回环地址：那会把凭据交给中间人、写进对端访问日志、
        // 也可能落在代理/CDN 的请求行日志里。要连远程 DSH 请显式声明 dsh.allowRemote。
        if (!this.auth.allowRemote && !isLoopbackBase(this.baseUrl)) {
            throw new Error(`拒绝把 DSH launch token 发往非本机地址（${this.baseUrl}）：那是进程启动凭据，只应交给 127.0.0.1。确实要连远程 DSH 时请在 config.json 里显式设置 dsh.allowRemote: true`);
        }
        if (this.cookiePromise)
            return waitWithSignal(this.cookiePromise, signal);
        const promise = (async () => {
            const epoch = this._authEpoch;
            const url = new URL(this.baseUrl);
            url.pathname = '/';
            url.search = '';
            url.hash = '';
            url.searchParams.set('token', this.launchToken);
            const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
            const setCookie = res.headers.get('set-cookie');
            await res.body?.cancel();
            if (!setCookie)
                throw new Error(`DSH token exchange failed: HTTP ${res.status}`);
            if (epoch !== this._authEpoch)
                throw new Error('DSH auth session invalidated during token exchange');
            this.cookie = setCookie.split(';')[0];
            this._strategy = 'token';
            return this.cookie;
        })();
        this.cookiePromise = promise;
        const clearPromise = () => {
            if (this.cookiePromise === promise)
                this.cookiePromise = null;
        };
        // 不丢弃 finally 返回的 rejected Promise，否则调用方已 catch 仍会触发进程级未处理拒绝。
        promise.then(clearPromise, clearPromise);
        return waitWithSignal(promise, signal);
    }
    async doFetch(input, init) {
        return this._doFetchWithAuth(input, init, false);
    }
    /**
     * 退役会话前先移除 pending inbox，再取消正在运行的 turn。
     * DSH 的 session/cancel 保留 inbox，archiveSession 只隐藏会话，均不能代替清队列。
     */
    async stopSessionWork(sessionId, { signal, timeoutMs = 8000 } = {}) {
        if (typeof sessionId !== 'string' || !sessionId)
            throw new Error('sessionId is required');
        const deadline = AbortSignal.timeout(timeoutMs);
        const sig = signal ? AbortSignal.any([signal, deadline]) : deadline;
        let removed = 0;
        let failure;
        // AbortSignal.reason和Promise拒绝值允许为false/null等，不能以错误值真假判定成功。
        let failed = false;
        try {
            // 为取消当前 turn 留出时间，即使 control 流没有及时返回 baseline。
            const queueSignal = AbortSignal.any([sig, AbortSignal.timeout(Math.min(5000, timeoutMs))]);
            // _readSessionQueue 已把 inbox 项校验成 MessageId 列表（取不到 id 会直接抛错）。
            const itemIds = await this._readSessionQueue(sessionId, queueSignal);
            for (const itemId of new Set(itemIds)) {
                const response = await this.callUnary('session/updateQueue', {
                    sessionId, itemId, action: { kind: 'remove' }
                }, sig);
                if (response.result?.ok)
                    removed += 1;
                else if (response.result?.error?.code !== 'session/queue-item-not-found')
                    unwrap(response, 'session/updateQueue');
                // 已被 agent 取走的队列项不再存在；接下来的 cancel 会取消当前 turn。
            }
        }
        catch (error) {
            failure = error;
            failed = true;
        }
        try {
            const response = await this.callUnary('session/cancel', { sessionId }, sig);
            if (!response.result?.ok && response.result?.error?.code !== 'session/not-found')
                unwrap(response, 'session/cancel');
        }
        catch (error) {
            failure ??= error;
            failed = true;
        }
        if (failed)
            throw failure;
        return { removed };
    }
    /**
     * 读取一个会话的待处理 inbox 项（退役/重置前要清掉的队列）。
     *
     * 两条路，都解析同一份 `inbox` 投影（见 {@link inboxItemsOfProjections}）：
     * 1. **主路径 `session/projections`**（DSH 0.2.0 起的一元 RPC，非激活读取）：
     *    `{request:{sessionId}}` → `{ asOfSeq, values } | null`。一条普通 HTTP RPC，
     *    可取消、可超时、可单测，不需要为「看一眼队列」开一条 WebSocket。
     * 2. **回退 `session/control`**：该 endpoint 不存在（更早的 DSH）时，退回全宿主
     *    控制流的开场 baseline，从 `value.projections[sessionId].values` 取同一份数据。
     *
     * 历史教训：这里曾经只认 `value.queues[sessionId]`（0.1.7 的形状），0.2.0 把它并入
     * 投影表之后，每次退役会话都抛 "invalid session/control baseline"，队列清不掉、
     * 旧任务继续烧 token。所以现在的解析放在**具名导出**里，由 test-dsh-client-* 直接钉住。
     */
    async _readSessionQueue(sessionId, signal) {
        await this.ensureAuth(signal);
        signal?.throwIfAborted();
        try {
            const response = await this.callUnary('session/projections', { sessionId }, signal);
            if (response.result?.ok) {
                // value === null ⇒ 会话不在宿主注册表里（已归档/从未挂载）⇒ 没有待处理项。
                return inboxItemIds(inboxItemsOfProjections(response.result.value?.values));
            }
            // `session/not-found` 同样意味着没有队列可清；其余错误交给回退路径判定。
            if (response.result?.error?.code === 'session/not-found')
                return [];
            // endpoint 不存在之类的协议级错误 ⇒ 走 control 流回退。
        }
        catch (error) {
            signal?.throwIfAborted();
            // 一元 RPC 失败（旧 DSH 不认这个 endpoint / 网关拒绝）时回退，不把异常当结论。
            void error;
        }
        return this._readSessionQueueViaControl(sessionId, signal);
    }
    /** 回退路径：全宿主 `session/control` 流的开场 baseline。 */
    async _readSessionQueueViaControl(sessionId, signal) {
        signal?.throwIfAborted();
        const url = new URL('/api/remote.mux', this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url, { headers: { cookie: this.cookie } });
        const streamId = randomUUID();
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error, items) => {
                if (settled)
                    return;
                settled = true;
                signal?.removeEventListener('abort', abort);
                socket.removeEventListener('open', open);
                socket.removeEventListener('message', message);
                socket.removeEventListener('error', failed);
                socket.removeEventListener('close', failed);
                if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
                    socket.close();
                // 只有基线解析成功会提供数组（包括空数组）；任意取消/异常值都必须拒绝。
                if (items === undefined)
                    reject(error);
                else
                    resolve(items);
            };
            const abort = () => finish(signal.reason);
            const failed = () => finish(new Error('session/control connection closed before baseline'));
            const open = () => {
                try {
                    socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/control', payload: { args: {} } }));
                }
                catch (error) {
                    finish(error);
                }
            };
            const message = (event) => {
                try {
                    const frame = JSON.parse(event.data);
                    if (frame.streamId !== streamId)
                        return;
                    if (frame.type === 'error' || frame.type === 'end') {
                        finish(new Error(`session/control ended before baseline${frame.error?.code ? ` (${frame.error.code})` : ''}`));
                    }
                    else if (frame.type === 'item' && frame.value?.type === 'baseline') {
                        finish(null, inboxItemIds(controlBaselineInboxItems(frame.value, sessionId)));
                    }
                }
                catch (error) {
                    finish(error);
                }
            };
            socket.addEventListener('open', open);
            socket.addEventListener('message', message);
            socket.addEventListener('error', failed);
            socket.addEventListener('close', failed);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted)
                abort();
        });
    }
    async _doFetchWithAuth(input, init, isRetry) {
        if (this.launchTokenOnly && !this.launchToken)
            throw new Error('DSH_LAUNCH_CREDENTIAL_REQUIRED');
        const authEpoch = this._authEpoch;
        init?.signal?.throwIfAborted();
        const headers = new Headers(init?.headers);
        if (this.hasAuth()) {
            try {
                const cookie = await this.ensureAuth(init?.signal);
                headers.set('cookie', cookie);
            }
            catch (error) {
                if (!isRetry && this.launchToken && /token exchange failed|invalidated during token exchange/i.test((error?.message ?? ''))) {
                    // 交换失败通常意味着那个 launch token 已经过期（DSH 重启过，日志里的是上一个
                    // 进程的）。解除「改用 token」的偏好，否则客户端会一直抱着一个死 token 不放 ——
                    // 这正是「一次 401 之后所有 RPC 永久失败」的成因。
                    this._preferToken = false;
                    if (authEpoch === this._authEpoch)
                        this.invalidateAuth();
                    return this._doFetchWithAuth(input, init, true);
                }
                throw error;
            }
        }
        init?.signal?.throwIfAborted();
        const response = await fetch(input, { ...init, headers });
        if (!isRetry && response.status === 401 && this.hasAuth()) {
            await response.body?.cancel();
            // 策略切换只在**真的收到 401** 时决定（不能放在 invalidateAuth 里：那里也会被
            // WS 流结束调用）。铸造的 Cookie 被 401 ⇒ 本机密钥对不上（典型：DSH_HOME 指向了
            // 另一个 .dsh），改用 launch token；token 交换被 401 ⇒ 那个 token 已死，改回铸造。
            if (this._strategy === 'minted' && this.launchToken)
                this._preferToken = true;
            else if (this._strategy === 'token')
                this._preferToken = false;
            // 同一旧 Cookie 的并发 401 只能触发一次换票，不能使已开始的新换票失效。
            if (authEpoch === this._authEpoch)
                this.invalidateAuth();
            return this._doFetchWithAuth(input, init, true);
        }
        return response;
    }
    /**
     * 覆写 unary RPC：适配 DSH 0.1.2 起、0.1.5 仍沿用的斜杠 endpoint 和 { args } 包装，
     * 并且只解析最外层信封，不依赖官方包的 value schema
     * （桥接依赖的 @deepseek-ai/dsh-host-apiproxy 是独立的旧版客户端包，DSH 升级不影响它）。
     * 注意：新版基类里 callUnary 是 protected/private，这里用同名 public 方法覆写即可，
     * 业务侧一律走桥接自己的 sessions/workspace/settings 门面，不依赖基类的域方法。
     */
    async callUnary(method, payload, signal, timeoutPolicy = 'default') {
        const endpoint = endpointOf(method);
        const message = {
            type: 'client-request',
            rpcId: this.mintRpcId(),
            method: endpoint,
            payload: wrapArgs(method, payload)
        };
        this.onEnvelope(message);
        const response = await this.postJson(`/api/${endpoint}`, message, signal, timeoutPolicy);
        const full = await response.json();
        if (!full || full.type !== 'server-response' || full.rpcId !== message.rpcId || !full.result) {
            throw new Error(`invalid server-response for ${endpoint}`);
        }
        this.onEnvelope(full);
        return { rpcId: full.rpcId, result: full.result };
    }
    /**
     * respond 在新版 DSH 中由 Remote Event 结果通道承担：POST /api/$events/result。
     * 调用方传 { clientId, eventId, outcome }；旧版 { type:'client-response', ... } 仍保留旧路径，
     * 若旧路径 404 会由上层捕获并记录，不会影响新版链路。
     */
    async respond(message, signal) {
        if (message?.clientId && message?.eventId && message?.outcome) {
            const response = await this.callUnary('$events/result', {
                clientId: message.clientId,
                eventId: message.eventId,
                outcome: message.outcome
            }, signal);
            if (!response.result?.ok) {
                const { code, message: errMsg } = response.result?.error ?? {};
                throw new Error(`$events/result rejected${code ? ` (${code})` : ''}: ${errMsg ?? 'unknown error'}`);
            }
            return response;
        }
        this.onEnvelope(message);
        const response = await this.postJson('/api/respond', message, signal);
        return response.json();
    }
    /** 新版 DSH 的 agentPresets 命名空间是复数；旧版基类仍映射到 agentPreset.list。 */
    agentPresets = {
        list: (payload, signal) => this.callUnary('agentPresets.list', payload, signal),
    };
    /**
     * 新版事件流：连接 /api/remote.mux，自动 follow 所有 session，并把
     * session/follow 的 event 帧映射成旧 pumpMux 能消费的 session/event 信封。
     */
    events = {
        mux: (_payload, signal, onOpen) => this.openRemoteEventStream(signal, onOpen),
        host: (_payload, signal, onOpen) => this.openRemoteEventStream(signal, onOpen),
        follow: (sessionId) => this._followSession(sessionId),
        /**
         * 取消一个会话的订阅（会话被退役/重置时调用）。
         *
         * 不做这件事的话 `_desiredFollows` 只增不减：每次重连都会为一个早已不存在的会话
         * 重开一条 follow 流，并让 DSH 回一整份历史快照 —— 内存、重连延迟和账本基线行数
         * 都会随「历史上创建过的会话数」线性增长。
         * 已经打开的流由 DSH 在会话消失时自行结束。
         */
        forget: (sessionId) => {
            if (!sessionId)
                return;
            this._desiredFollows.delete(String(sessionId));
        },
    };
    openRemoteEventStream(signal, onOpen) {
        const gen = this._remoteMuxGenerator(signal, onOpen);
        return {
            [Symbol.asyncIterator]: () => gen,
            follow: (sessionId) => this._followSession(sessionId),
            forget: (sessionId) => { if (sessionId)
                this._desiredFollows.delete(String(sessionId)); }
        };
    }
    _followSession(sessionId) {
        if (!sessionId)
            return;
        const sid = String(sessionId);
        // 先记账再发送：即使此刻没有连接（或正处在重连窗口内），重连时也会重放。
        this._desiredFollows.add(sid);
        if (this._muxSendOpen)
            this._muxSendOpen(sid);
    }
    async *_remoteMuxGenerator(signal, onOpen) {
        const own = signal === undefined ? new AbortController() : undefined;
        const sig = signal ?? own.signal;
        sig.throwIfAborted();
        await this.ensureAuth(sig);
        sig.throwIfAborted();
        const url = new URL('/api/remote.mux', this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url, { headers: { cookie: this.cookie } });
        const inbox = [];
        let wake;
        let socketOpen = false;
        let eventStreamId = null;
        let eventClientId = null;
        let ended = false;
        const followed = new Set();
        const streamToSession = new Map();
        const sessionToStream = new Map();
        const enqueue = (item) => {
            inbox.push(item);
            wake?.();
            wake = undefined;
        };
        const endStream = () => {
            if (ended)
                return;
            ended = true;
            if (this._muxSendOpen === sendOpen)
                this._muxSendOpen = null;
            // 连接断开（含鉴权失败/DSH 重启）时丢弃旧 Cookie，重连会重新 token exchange。
            if (!sig.aborted)
                this.invalidateAuth();
            enqueue({ kind: 'end' });
        };
        const sendOpen = (sessionId) => {
            if (ended || !socketOpen || sessionToStream.has(sessionId) || followed.has(sessionId))
                return;
            const streamId = randomUUID();
            streamToSession.set(streamId, sessionId);
            sessionToStream.set(sessionId, streamId);
            followed.add(sessionId);
            try {
                socket.send(JSON.stringify({
                    type: 'open',
                    streamId,
                    endpoint: 'session/follow',
                    payload: {
                        args: {
                            request: {
                                address: { kind: 'session', sessionId },
                                // 开场快照的历史深度。默认只有 50 条，不足以回填逐轮花费；
                                // 调大只影响首帧体积（每个已 follow 的会话一帧），不改变事件通道语义。
                                maxMessages: FOLLOW_SNAPSHOT_MESSAGES
                            }
                        }
                    }
                }));
            }
            catch (error) {
                console.error('[dsh-client] failed to open session/follow:', error?.message ?? error);
                // 发送失败时不能把该会话永久记为已订阅；结束传输，让上层重连并重放。
                sessionToStream.delete(sessionId);
                streamToSession.delete(streamId);
                followed.delete(sessionId);
                endStream();
            }
        };
        const sendOpenEvents = () => {
            if (ended || !socketOpen || eventStreamId)
                return;
            const streamId = randomUUID();
            eventStreamId = streamId;
            try {
                socket.send(JSON.stringify({
                    type: 'open',
                    streamId,
                    endpoint: '$events',
                    payload: { args: {} }
                }));
            }
            catch (error) {
                console.error('[dsh-client] failed to open $events stream:', error?.message ?? error);
                eventStreamId = null;
                endStream();
            }
        };
        const handleOpen = () => {
            if (ended || sig.aborted)
                return;
            socketOpen = true;
            this._muxSendOpen = sendOpen;
            // 重放**全部**期望 follow（跨重连保留），而不只是本次连接排队的那些。
            // 少了这一步，DSH 一重启，所有已存在的 QQ 会话就会静默失联。
            for (const sid of this._desiredFollows)
                sendOpen(sid);
            sendOpenEvents();
            if (!ended)
                onOpen?.();
        };
        const handleMessage = (event) => {
            let msg;
            try {
                if (typeof event.data !== 'string')
                    throw new Error('binary frame');
                msg = JSON.parse(event.data);
                if (!msg || typeof msg.type !== 'string' || typeof msg.streamId !== 'string')
                    throw new Error('unexpected remote stream frame');
            }
            catch (error) {
                console.error('[dsh-client] dropping malformed remote.mux frame:', error?.message ?? error);
                return;
            }
            const sessionId = streamToSession.get(msg.streamId);
            const isEventStream = msg.streamId === eventStreamId;
            if (msg.type === 'item') {
                if (isEventStream && msg.value) {
                    const value = msg.value;
                    if (value.type === 'ready') {
                        eventClientId = value.clientId;
                    }
                    else if (value.type === 'waterfall' && eventClientId) {
                        if (value.event === 'approval/request') {
                            enqueue({
                                kind: 'frame',
                                envelope: {
                                    rpcId: value.eventId,
                                    payload: {
                                        type: 'approval/requested',
                                        sessionId: value.agentId,
                                        clientId: eventClientId,
                                        eventId: value.eventId,
                                        toolName: value.request?.toolName,
                                        callId: value.request?.callId,
                                        reason: value.request?.reason
                                    }
                                }
                            });
                        }
                        else if (value.event === 'user-questions/request') {
                            enqueue({
                                kind: 'frame',
                                envelope: {
                                    rpcId: value.eventId,
                                    payload: {
                                        type: 'question/requested',
                                        sessionId: value.agentId,
                                        clientId: eventClientId,
                                        eventId: value.eventId,
                                        questions: value.request?.questions
                                    }
                                }
                            });
                        }
                        // 其他 emit/waterfall 事件当前桥接不需要，保持忽略。
                    }
                    // emit/cancel 帧忽略
                }
                else if (sessionId && msg.value?.type === 'event') {
                    enqueue({
                        kind: 'frame',
                        envelope: {
                            rpcId: msg.streamId,
                            payload: { type: 'session/event', sessionId, event: msg.value.event }
                        }
                    });
                }
                else if (sessionId && msg.value?.type === 'snapshot') {
                    // 打开/重连单会话流时的开场快照：带 projections（整条日志的权威 token 累计）
                    // 与 records（最多 maxMessages 条历史事件）。
                    // **单独一种帧类型**下发，绝不混进 session/event：快照里含历史 turn 的
                    // turn/end，若走事件通道会让桥接把「早已结束的回合」当成新的回合去发 QQ 回复。
                    enqueue({
                        kind: 'frame',
                        envelope: {
                            rpcId: msg.streamId,
                            payload: { type: 'session/snapshot', sessionId, snapshot: msg.value }
                        }
                    });
                }
                // 其余 snapshot 之外的帧（assistant-stream 等）当前桥接不需要，保持忽略。
            }
            else if (msg.type === 'end') {
                if (isEventStream) {
                    eventStreamId = null;
                    eventClientId = null;
                    // 仅清掉 id 会让提问/审批通道永久失联；结束 mux 由桥接重连并重开。
                    endStream();
                }
                else if (sessionId) {
                    sessionToStream.delete(sessionId);
                    streamToSession.delete(msg.streamId);
                    followed.delete(sessionId);
                    // DSH 正常结束了单条会话流（follow 被回收 / 会话被归档 / 服务端空闲清理）。
                    // 旧代码在这里什么都不做：不重订阅、不打日志，而重放只在 socket 'open' 时发生，
                    // 于是这个会话**永久失联**且毫无提示。更糟的是若它断在回合中间，
                    // collectors/v2TurnStartAt 会一直留着 → isConversationBusyV2 永远为真 →
                    // 该群所有唤醒都被塞进 pendingWakeReasons，群彻底哑掉且没有租约能救。
                    // 这里主动重开一次订阅；仍然想订阅的会话才重开（forget 过的就让它走）。
                    if (this._desiredFollows.has(sessionId)) {
                        console.error(`[dsh-client] session/follow 已被服务端结束，重新订阅：${sessionId}`);
                        setTimeout(() => {
                            if (!ended && this._desiredFollows.has(sessionId))
                                sendOpen(sessionId);
                        }, 2000);
                    }
                }
            }
            else if (msg.type === 'error') {
                if (isEventStream) {
                    console.error('[dsh-client] $events stream failed:', msg.error?.code || 'unknown error');
                    eventStreamId = null;
                    eventClientId = null;
                    endStream();
                }
                else if (sessionId) {
                    sessionToStream.delete(sessionId);
                    streamToSession.delete(msg.streamId);
                    followed.delete(sessionId);
                    // 只有已不存在的会话才永久取消订阅；临时服务错误必须在重连后重试。
                    if (msg.error?.code === 'session/not-found')
                        this._desiredFollows.delete(sessionId);
                    enqueue({
                        kind: 'frame',
                        envelope: { rpcId: msg.streamId, payload: { type: 'stream/error', error: msg.error } }
                    });
                    if (msg.error?.code !== 'session/not-found')
                        endStream();
                }
            }
        };
        const handleClose = () => endStream();
        const handleError = () => endStream();
        const handleAbort = () => {
            endStream();
            if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
                socket.close();
        };
        socket.addEventListener('open', handleOpen);
        socket.addEventListener('message', handleMessage);
        socket.addEventListener('close', handleClose, { once: true });
        socket.addEventListener('error', handleError, { once: true });
        sig.addEventListener('abort', handleAbort, { once: true });
        if (sig.aborted)
            handleAbort();
        try {
            while (true) {
                while (inbox.length > 0) {
                    const item = inbox.shift();
                    if (item.kind === 'end')
                        return;
                    yield item.envelope;
                }
                await new Promise((resolve) => { wake = resolve; });
            }
        }
        finally {
            if (this._muxSendOpen === sendOpen)
                this._muxSendOpen = null;
            sig.removeEventListener('abort', handleAbort);
            socket.removeEventListener('open', handleOpen);
            socket.removeEventListener('message', handleMessage);
            socket.removeEventListener('close', handleClose);
            socket.removeEventListener('error', handleError);
            own?.abort();
            handleAbort();
        }
    }
}
