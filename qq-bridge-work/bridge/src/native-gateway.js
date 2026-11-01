// Generated from native-gateway.ts. Edit the TypeScript source and run build:typed.
import fs from 'node:fs';
import path from 'node:path';
import { readGatewayConnection } from '../../native-research/native-adapter/gateway-broker.mjs';
import { normalizeNativeScope, nativeScopeFromLists } from '../../native-research/native-adapter/scope-policy.mjs';
/**
 * 核验已就绪的所属网关，再通过命名管道读取仅内存使用的连接信息。
 * @param {string|undefined} statusPath 显式状态文件；未设置表示保留既有桥接模式。
 * @param {object} options allowedRoot 为自有服务数据根；allowFixture 仅供合成验收。
 * @returns {Promise<object|null>} 凭据对象只供客户端构造，不得写入配置或日志。
 * @throws {Error} 固定错误；code仅标识失败阶段，不含路径、账号或原始异常。
 */
export async function connectNativeGateway(statusPath, { allowedRoot, allowFixture = false, requireSend = true } = {}) {
    if (!statusPath)
        return null;
    let stage = 'PATH';
    try {
        const root = fs.realpathSync(allowedRoot), file = fs.realpathSync(statusPath);
        if (path.basename(file) !== 'status.json' || !file.toLowerCase().startsWith((root + path.sep).toLowerCase()))
            throw new Error();
        if (fs.statSync(file).size > 16384)
            throw new Error();
        stage = 'STATUS';
        const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (previous.schemaVersion !== 1 || previous.component !== 'qq-native-gateway' ||
            !/^http:\/\/127\.0\.0\.1:\d+$/.test(previous.controlUrl) || !/^[a-f0-9-]{36}$/.test(previous.instanceId))
            throw new Error();
        stage = 'HEALTH';
        const response = await fetch(previous.controlUrl + '/health', { headers: { 'X-QQ-Gateway-Instance': previous.instanceId }, signal: AbortSignal.timeout(3000) });
        if (!response.ok)
            throw new Error();
        const state = await response.json();
        if (state.instanceId !== previous.instanceId || state.supervisorPid !== previous.supervisorPid || state.startedAt !== previous.startedAt)
            throw new Error();
        stage = 'BROKER';
        const connection = await readGatewayConnection(state, { allowFixture });
        stage = 'SEND_PERMISSION';
        if (requireSend && !connection.allowSend)
            throw new Error();
        return connection;
    }
    catch {
        const error = new Error('NATIVE_GATEWAY_NOT_READY_OR_NOT_AUTHORIZED');
        error.code = 'NATIVE_GATEWAY_' + stage + '_FAILED';
        throw error;
    }
}
/**
 * 将范围及无凭据端点应用到内存配置；令牌始终保留在单独连接对象中。
 * @param {object} cfg 本次进程配置；不会读写配置文件。
 * @param {object} connection 已核验的原生连接信息。
 * @returns {void} 原地限制目标，禁用发现/端点跟随、外部专有路径及旧HTTP访问。
 * @note HTTP指向同一自有OneBot监听器（固定404），避免回退访问其它本机服务。
 */
export function applyNativeGatewayConfig(cfg, connection) {
    const scope = connection.scope ? normalizeNativeScope(connection.scope, { allowEmpty: true })
        : nativeScopeFromLists(connection.allow.private, connection.allow.groups);
    cfg.onebot = { ...(cfg.onebot ?? cfg.snowluma), wsUrl: connection.url, httpUrl: connection.url.replace('ws:', 'http:'),
        accessToken: '', autoDiscover: false, followDiscoveredEndpoint: false, homeDir: '', launcherPath: '' };
    cfg.snowluma = cfg.onebot; // 只读旧配置兼容别名；不据此发现或启动外部程序。
    cfg.allow = structuredClone(connection.allow);
    cfg.allowAllWhenEmpty = false;
    cfg.nativeScope = scope;
    cfg.dsh.authToken = '';
    cfg.dsh.authTokenExplicit = false;
    cfg.dsh.allowRemote = false;
}
