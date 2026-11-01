/// <reference types="node" />
/// <reference lib="dom" />
interface HostConfiguration {consolePort: number; consoleToken?: unknown;}
interface HostStatus {qq?: {available?: unknown; online?: unknown}; dshReady?: unknown; mode?: unknown;}
// QQ 原生桥接只读状态服务；不控制进程、不安装程序、不输出账号或本机路径。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const root = process.env.QQ_BRIDGE_RUNTIME_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = new McpServer({ name: 'qq-native-host', version: '0.2.1-r2' });
server.tool('qq_native_status', '只读检查本项目QQ桥接与原生通道的在线状态。返回最小状态；不读取账号库、不启停服务、不发送消息。', {}, async () => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8').replace(/^\uFEFF/, '')) as HostConfiguration;
    const port = config.consolePort;
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error();
    const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
    const token = valid(config.consoleToken) ? config.consoleToken : fs.readFileSync(path.join(root, 'state/console-token'), 'utf8').trim();
    if (!valid(token)) throw new Error();
    const response = await fetch('http://127.0.0.1:' + port + '/api/status', { headers: { 'X-Console-Token': token,
      'X-Agent-Call': '1' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const body = await response.json() as HostStatus;
    const value = { available: body.qq?.available === true, online: body.qq?.online === true,
      dshReady: body.dshReady === true, mode: ['chat', 'reserved', 'reserved2', 'closed-agent'].includes(body.mode as string) ? body.mode : 'unconfirmed' };
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch {
    return { content: [{ type: 'text', text: JSON.stringify({ available: false, online: false,
      error: 'QQ_BRIDGE_UNAVAILABLE', hint: '请在QQ工作台检查连接状态；需要登录时由本人开始连接。' }) }] };
  }
});
await server.connect(new StdioServerTransport());
