// Generated from onebot-client.ts. Edit the TypeScript source and run build:typed.
/// <reference types="node" />
// 独立的 OneBot v11 正向 WebSocket 客户端；仅使用 Node 内置模块。
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
/** 将输入转换为 OneBot 文本段，不解释 CQ 码。@param value 待转换文本。@returns 明确的text消息段。 */
export function text(value) { return { type: 'text', data: { text: String(value) } }; }
/**
 * 本机 OneBot v11 客户端。所有操作在 Node 事件循环执行，无工作线程共享状态。
 * 构造不联网；connect 建连，close 停止重连且拒绝待处理请求；不会重放失败的发送。
 * request 返回完整协议响应，raw 返回成功响应的 data；失败、超时和取消以 Promise 拒绝表示。
 */
export class OneBotWebSocketClient extends EventEmitter {
    #socket = null;
    #opening = null;
    #pending = new Map();
    #retryTimer = null;
    #stopped = true;
    #retryCount = 0;
    /**
     * @param {object} options 连接配置：url 为回环 ws/wss 地址；accessToken 仅用于握手；
     * reconnect 控制自动重连；connectTimeoutMs/requestTimeoutMs 为正毫秒数；
     * WebSocketCtor 可注入模拟传输。构造不会读取文件、账号配置或环境凭据。
     * policyRevision为原生网关的权限版本；请求入队时固定该版本，热改后旧请求不获得新资格。
     */
    constructor({ url, accessToken = '', reconnect = true, connectTimeoutMs = 10000, requestTimeoutMs = 15000, reconnectMinMs = 1000, reconnectMaxMs = 30000, WebSocketCtor = globalThis.WebSocket, policyRevision = undefined } = {}) {
        super({ captureRejections: true });
        this.url = url;
        this.accessToken = accessToken;
        this.policyRevision = policyRevision;
        this.reconnect = reconnect !== false;
        this.connectTimeoutMs = connectTimeoutMs;
        this.requestTimeoutMs = requestTimeoutMs;
        this.reconnectMinMs = reconnectMinMs;
        this.reconnectMaxMs = reconnectMaxMs;
        this.WebSocketCtor = WebSocketCtor;
        for (const value of [connectTimeoutMs, requestTimeoutMs, reconnectMinMs, reconnectMaxMs]) {
            if (!Number.isFinite(value) || value <= 0)
                throw new TypeError('OneBot timeout must be positive');
        }
        if (typeof WebSocketCtor !== 'function')
            throw new TypeError('Node WebSocket is required');
        // EventEmitter 的无监听 error 会抛异常；网络故障由 Promise/订阅报告。
        this.on('error', () => { });
    }
    /** 当前传输是否 OPEN；不表示 QQ 账号在线。@returns {boolean} 传输状态。 */
    get isConnected() { return this.#socket?.readyState === 1; }
    #notify(name, value) {
        try {
            this.emit(name, value);
        }
        catch {
            if (name !== 'error')
                this.#notify('error', new Error('OneBot event listener failed'));
        }
    }
    #scheduleReconnect() {
        if (this.#stopped || !this.reconnect || this.#retryTimer || this.#socket)
            return;
        const delay = Math.min(this.reconnectMaxMs, this.reconnectMinMs * 2 ** Math.min(this.#retryCount++, 10));
        this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            if (!this.#stopped)
                this.connect().catch(() => { });
        }, delay);
    }
    #disconnect(socket, error, code = 1006) {
        if (this.#socket !== socket)
            return;
        this.#socket = null;
        if (this.#opening) {
            clearTimeout(this.#opening.timer);
            this.#opening.reject(error);
            this.#opening = null;
        }
        for (const entry of [...this.#pending.values()])
            entry.finish(error);
        try {
            socket.close();
        }
        catch { }
        this.#notify('close', { code });
        this.#scheduleReconnect();
    }
    /** 建立或复用连接；重复并发调用共享握手。@returns {Promise<void>} 超时/握手失败时拒绝。 */
    connect() {
        if (this.isConnected)
            return Promise.resolve();
        if (this.#opening)
            return this.#opening.promise;
        let address;
        try {
            address = new URL(this.url);
            if (!['ws:', 'wss:'].includes(address.protocol) || address.username || address.password
                || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) {
                throw new Error('OneBot requires a loopback ws/wss URL without embedded credentials');
            }
            if (this.accessToken)
                address.searchParams.set('access_token', String(this.accessToken));
        }
        catch {
            return Promise.reject(new Error('Invalid local OneBot endpoint'));
        }
        this.#stopped = false;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = null;
        let resolveOpen, rejectOpen;
        const promise = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
        const opening = { promise, resolve: resolveOpen, reject: rejectOpen, timer: null };
        this.#opening = opening;
        let socket;
        try {
            socket = new this.WebSocketCtor(address.href);
        }
        catch {
            this.#opening = null;
            rejectOpen(new Error('OneBot WebSocket construction failed'));
            this.#scheduleReconnect();
            return promise;
        }
        this.#socket = socket;
        opening.timer = setTimeout(() => this.#disconnect(socket, new Error('OneBot connection timed out')), this.connectTimeoutMs);
        socket.addEventListener('open', () => {
            if (this.#socket !== socket)
                return;
            clearTimeout(opening.timer);
            this.#opening = null;
            this.#retryCount = 0;
            resolveOpen();
            this.#notify('open');
        });
        socket.addEventListener('error', () => {
            if (this.#socket !== socket)
                return;
            const error = new Error('OneBot WebSocket transport error');
            this.#notify('error', error);
            this.#disconnect(socket, error);
        });
        socket.addEventListener('close', event => this.#disconnect(socket, new Error('OneBot connection closed'), event.code));
        socket.addEventListener('message', event => {
            if (this.#socket !== socket)
                return;
            let packet;
            try {
                if (typeof event.data !== 'string')
                    throw new Error('Expected JSON text');
                packet = JSON.parse(event.data);
                if (!packet || typeof packet !== 'object' || Array.isArray(packet))
                    throw new Error('Expected object');
            }
            catch {
                this.#notify('error', new Error('Invalid OneBot JSON frame'));
                return;
            }
            if (Object.hasOwn(packet, 'echo')) {
                const pending = this.#pending.get(String(packet.echo));
                if (pending) {
                    if (!['ok', 'async', 'failed'].includes(packet.status) || typeof packet.retcode !== 'number') {
                        pending.finish(new Error('Invalid OneBot response envelope'));
                    }
                    else
                        pending.finish(null, packet);
                }
                return;
            }
            if (!packet.post_type)
                return;
            this.#notify('event', packet);
            if (packet.post_type === 'message')
                this.#notify(`message:${packet.message_type}`, packet);
            if (packet.post_type === 'notice')
                this.#notify(`notice:${packet.notice_type}`, packet);
        });
        return promise;
    }
    /** 停止重连并终止当前请求；可再次显式 connect。@param {number} code 关闭码。@param {string} reason 本地说明（不发送敏感内容）。 */
    close(code = 1000, reason = '') {
        this.#stopped = true;
        clearTimeout(this.#retryTimer);
        this.#retryTimer = null;
        const socket = this.#socket;
        if (socket) {
            try {
                socket.close(code, reason);
            }
            catch { }
            this.#disconnect(socket, new Error('OneBot client closed'), code);
        }
    }
    /**
     * 调用任意 OneBot 动作，不自动重试动作。
     * @param {string} action 动作名。@param {object} params 参数。
     * @param {object} options 可选 signal/timeoutMs/echo；超时包含等待握手的时间。
     * @returns {Promise<object>} 完整响应（含失败 retcode）；传输/取消/超时则拒绝。
     */
    request(action, params = {}, options = {}) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(action))
            return Promise.reject(new TypeError('Invalid OneBot action'));
        const echo = String(options.echo ?? randomUUID());
        // 在调用时固定版本；等待连接期间的撤权不能使旧请求获得新资格。
        const policyRevision = options.policyRevision ?? this.policyRevision;
        if (this.#pending.has(echo))
            return Promise.reject(new Error('Duplicate OneBot echo'));
        const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
            return Promise.reject(new TypeError('Invalid request timeout'));
        if (options.signal?.aborted)
            return Promise.reject(new Error('OneBot request aborted'));
        return new Promise((resolve, reject) => {
            let timer;
            const abort = () => finish(new Error('OneBot request aborted'));
            const finish = (error, value) => {
                if (!this.#pending.has(echo))
                    return;
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', abort);
                this.#pending.delete(echo);
                if (error)
                    reject(error);
                else
                    resolve(value);
            };
            this.#pending.set(echo, { finish });
            timer = setTimeout(() => finish(new Error('OneBot action timed out')), timeoutMs);
            options.signal?.addEventListener('abort', abort, { once: true });
            this.connect().then(() => {
                if (!this.#pending.has(echo))
                    return; // 取消/超时后绝不能补发。
                try {
                    this.#socket.send(JSON.stringify({ action, params, echo,
                        ...(policyRevision === undefined ? {} : { qq_policy_revision: policyRevision }) }));
                }
                catch {
                    finish(new Error('OneBot action could not be sent'));
                }
            }, error => finish(error));
        });
    }
    /** 返回成功动作的 data；业务失败以 Promise 拒绝，只暴露错误码。@param {string} action 动作名。@param {object} params 参数。@param {object} options 同 request。@returns {Promise<unknown>} 响应数据。 */
    async raw(action, params = {}, options) {
        const packet = await this.request(action, params, options);
        if (packet.status !== 'ok' || packet.retcode !== 0) {
            const imageCodes = ['IMAGE_NOT_CACHED', 'IMAGE_DISABLED', 'IMAGE_LIMIT', 'IMAGE_FORMAT_INVALID', 'IMAGE_DOWNLOAD_FAILED', 'IMAGE_DOWNLOAD_TIMEOUT', 'IMAGE_CHUNK_INVALID'];
            const code = action === 'get_image' && typeof packet.message === 'string' && imageCodes.includes(packet.message) ? packet.message : null;
            throw Object.assign(new Error(`OneBot action rejected (retcode=${packet.retcode}${code ? ', code=' + code : ''})`), code ? { code } : {});
        }
        return packet.data;
    }
    /** 订阅事件；返回取消订阅函数。@param {string} name 事件名。@param {Function} callback 回调。@returns {Function} 解除订阅。 */
    subscribe(name, callback) { this.on(name, callback); return () => this.off(name, callback); }
    /** 订阅全部上游事件。@param {Function} callback 事件回调。@returns {Function} 解除订阅函数。 */
    onEvent(callback) { return this.subscribe('event', callback); }
    /** 订阅私聊消息。@param {Function} callback 消息回调。@returns {Function} 解除订阅函数。 */
    onPrivateMessage(callback) { return this.subscribe('message:private', callback); }
    /** 订阅群聊消息。@param {Function} callback 消息回调。@returns {Function} 解除订阅函数。 */
    onGroupMessage(callback) { return this.subscribe('message:group', callback); }
    /** 订阅指定通知。@param {string} type notice_type。@param {Function} callback 回调。@returns {Function} 解除订阅函数。 */
    onNotice(type, callback) { return this.subscribe(`notice:${type}`, callback); }
    /** 可选扩展事件，缺失不影响标准事件。@param {Function} callback 状态回调。@returns {Function} 解除订阅函数。 */
    onBotStatus(callback) { return this.onNotice('bot_status', callback); }
    /** 读取登录身份，不代表收信正常。@param {object} options 同 request。@returns {Promise<object>} 身份数据，失败拒绝。 */
    getLoginInfo(options) { return this.raw('get_login_info', {}, options); }
    /** 读取网关/账号状态。@param {object} options 同 request。@returns {Promise<object>} 状态数据，失败拒绝。 */
    getStatus(options) { return this.raw('get_status', {}, options); }
    /** 读取网关版本。@param {object} options 同 request。@returns {Promise<object>} 版本数据，失败拒绝。 */
    getVersionInfo(options) { return this.raw('get_version_info', {}, options); }
    /** 发送私聊，调用方须先校验白名单。@param {number|string} id 用户号。@param {object|Array} message 消息段。@param {object} options 同 request。@returns {Promise<object>} 发送结果，失败拒绝且不重放。 */
    sendPrivateMessage(id, message, options) { return this.raw('send_private_msg', { user_id: id, message: Array.isArray(message) ? message : [message] }, options); }
    /** 发送群消息，调用方须先校验白名单。@param {number|string} id 群号。@param {object|Array} message 消息段。@param {object} options 同 request。@returns {Promise<object>} 发送结果，失败拒绝且不重放。 */
    sendGroupMessage(id, message, options) { return this.raw('send_group_msg', { group_id: id, message: Array.isArray(message) ? message : [message] }, options); }
    /** 读取消息。@param {number|string} id 消息 ID。@param {object} options 同 request。@returns {Promise<object>} 消息数据，失败拒绝。 */
    getMessage(id, options) { return this.raw('get_msg', { message_id: id }, options); }
    /** 读取图片信息。@param {object} params 含 file 图片标识。@param {object} options 同 request。@returns {Promise<object>} 图片数据，失败拒绝。 */
    async getImage(params, options) {
        const result = await this.raw('get_image', params, { timeoutMs: 20000, ...options });
        if (!result?.native_image)
            return result;
        const descriptor = result.native_image;
        if (!/^qqimg_[a-f0-9]{32}$/.test((descriptor.file ?? '')) || descriptor.file !== params.file ||
            !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 8 * 1024 * 1024 ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(descriptor.mimeType) || !/^[a-f0-9]{64}$/.test((descriptor.sha256 ?? '')))
            throw new Error('IMAGE_CHUNK_INVALID');
        const chunks = [];
        for (let offset = 0; offset < descriptor.size; offset += 24576) {
            const chunk = await this.raw('get_image', { file: descriptor.file, offset }, options);
            if (chunk?.file !== descriptor.file || chunk.offset !== offset || chunk.size !== descriptor.size || typeof chunk.data !== 'string' || chunk.data.length > 32768)
                throw new Error('IMAGE_CHUNK_INVALID');
            const bytes = Buffer.from(chunk.data, 'base64');
            if (bytes.length !== Math.min(24576, descriptor.size - offset) || bytes.toString('base64') !== chunk.data)
                throw new Error('IMAGE_CHUNK_INVALID');
            chunks.push(bytes);
        }
        const bytes = Buffer.concat(chunks, descriptor.size);
        if (createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256)
            throw new Error('IMAGE_CHUNK_INVALID');
        return { data: bytes.toString('base64'), mimeType: descriptor.mimeType, size: bytes.length };
    }
    /**
     * 上传调用方已取得的图片字节到原生会话句柄；不读取路径、下载URL或发送QQ消息。
     * @param {Buffer} bytes 有界图片字节；服务端重新校验格式和摘要。
     * @param {object} target kind/id 是已授权当前会话目标。
     * @param {object} options 可选signal/timeoutMs；默认总预算60秒，取消后停止后续块并尝试终止已知上传。
     * @returns {Promise<object>} 仅本运行有效的图片句柄；失败终止上传，不自动重放。
     * @note 单事件循环；取消/超时不等同已撤销服务端既有块，未知上传由原生有界缓存超时回收。
     */
    async uploadNativeImage(bytes, { kind, id } = {}, { signal, timeoutMs = 60000 } = {}) {
        if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8 * 1024 * 1024)
            throw new Error('IMAGE_LIMIT');
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
            throw new Error('IMAGE_LIMIT');
        const deadline = performance.now() + timeoutMs;
        const options = () => {
            const remaining = Math.ceil(deadline - performance.now());
            if (signal?.aborted || remaining <= 0)
                throw new Error('IMAGE_UPLOAD_FAILED');
            return { ...(signal ? { signal } : {}), timeoutMs: Math.min(this.requestTimeoutMs, remaining) };
        };
        const begin = await this.raw('upload_image', { operation: 'begin', size: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'), kind, target: String(id) }, options());
        if (!/^qqupload_[a-f0-9]{32}$/.test((begin?.upload ?? '')))
            throw new Error('IMAGE_CHUNK_INVALID');
        try {
            for (let offset = 0; offset < bytes.length; offset += 24576) {
                const chunk = bytes.subarray(offset, Math.min(offset + 24576, bytes.length));
                const response = await this.raw('upload_image', { operation: 'append', upload: begin.upload, offset, data: chunk.toString('base64') }, options());
                if (response?.offset !== offset + chunk.length)
                    throw new Error('IMAGE_CHUNK_INVALID');
            }
            const result = await this.raw('upload_image', { operation: 'finish', upload: begin.upload }, options());
            options();
            if (!/^qqimg_[a-f0-9]{32}$/.test((result?.file ?? '')) || result.size !== bytes.length)
                throw new Error('IMAGE_CHUNK_INVALID');
            return result;
        }
        catch {
            try {
                await this.raw('upload_image', { operation: 'abort', upload: begin.upload }, { timeoutMs: 1000 });
            }
            catch { }
            throw new Error('IMAGE_UPLOAD_FAILED');
        }
    }
    /** 读取群成员列表。@param {number|string} id 群号。@param {object} options 同 request。@returns {Promise<Array>} 成员列表，失败拒绝。 */
    getGroupMemberList(id, options) { return this.raw('get_group_member_list', { group_id: id }, options); }
    /** 读取群成员信息。@param {number|string} groupId 群号。@param {number|string} userId 用户号。@param {object} options 同 request。@returns {Promise<object>} 成员数据，失败拒绝。 */
    getGroupMemberInfo(groupId, userId, options) { return this.raw('get_group_member_info', { group_id: groupId, user_id: userId }, options); }
    /** 旧专有表情扩展已退役。@returns {Promise<never>} 始终拒绝，触发桥接既有降级。 */
    fetchFaceEntity() { return Promise.reject(new Error('Face entity extension is unavailable in the OneBot client')); }
}
