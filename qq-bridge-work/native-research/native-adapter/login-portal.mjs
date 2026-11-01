import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

/**
 * 启动仅绑定 IPv4 回环的手动登录页面，无外部资源、无二维码文件或访问日志。
 * @param {object} controller 手动登录控制器；创建页面本身不触发 start。
 * @param {{sessionTrial?:boolean,textTrial?:boolean,receiveOnly?:boolean,gateway?:boolean,parentPortal?:string|null}} options 选择固定页面；
 *   receiveOnly须同时启用textTrial，不注册发送/确认/重连路由；parentPortal仅接受无凭据回环地址作为返回链接。
 * @returns {Promise<{url:string, close:function():Promise<void>}>} 本机地址和幂等关闭函数。
 * @note Host固定匹配实际端口；仅首页允许same-site顶层document导航。
 *   状态/二维码/子资源不适用此例外；写操作仍须同源且携带固定自定义头。
 */
export async function createLoginPortal(controller, { sessionTrial = false, textTrial = false, receiveOnly = false, gateway = false, parentPortal = null } = {}) {
  if (receiveOnly && !textTrial) throw new Error('RECEIVE_MODE_REQUIRES_TEXT');
  const assets = new Map([
    ['/', ['text/html; charset=utf-8', textTrial ? 'text-page.html' : 'login-page.html']],
    ['/page.css', ['text/css; charset=utf-8', 'login-page.css']],
    ['/whale-ui.css', ['text/css; charset=utf-8', 'whale-ui.css']],
    ['/page.js', ['text/javascript; charset=utf-8', textTrial ? 'text-page.js' : 'login-page.js']],
  ].map(([route, [type, file]]) => [route, { type, body: readFileSync(new URL(file, import.meta.url)) }]));
  if (gateway || !textTrial) assets.set('/character.png', { type: 'image/png', body: readFileSync(new URL('../../bridge/plugins/qq-mode-console/client/companion.png', import.meta.url)) });
  if (receiveOnly) {
    assets.get('/').body = readFileSync(new URL('receive-page.html', import.meta.url));
    assets.get('/page.js').body = readFileSync(new URL('receive-page.js', import.meta.url));
  }
  if (gateway) {
    assets.get('/').body = readFileSync(new URL('gateway-page.html', import.meta.url));
    assets.get('/page.js').body = readFileSync(new URL('gateway-page.js', import.meta.url));
    assets.get('/page.css').body = readFileSync(new URL('gateway-page.css', import.meta.url));
    if (typeof parentPortal === 'string' && /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(parentPortal)
        && Number(parentPortal.slice(parentPortal.lastIndexOf(':') + 1)) <= 65535) {
      assets.get('/').body = Buffer.from(assets.get('/').body.toString('utf8').replace('href="#workspace-entry"',
        'href="' + parentPortal + '"'));
      assets.get('/').body = Buffer.from(assets.get('/').body.toString('utf8').replace('</main>',
        '<p><a href="' + parentPortal + '" rel="noreferrer">返回管理入口</a>（QQ结束后可在此重新准备）</p></main>'));
      assets.get('/').body = Buffer.from(assets.get('/').body.toString('utf8').replace('<p id="error" role="alert"></p>',
        '<p id="error" role="alert"></p><section id="connection-recovery" class="panel" hidden aria-label="连接恢复">'
        + '<h2>检查或恢复QQ连接</h2><p>返回管理入口查看状态，再重新准备本人连接。</p>'
        + '<a class="button-link" href="' + parentPortal + '" rel="noreferrer">返回管理入口</a>'
        + '<p class="subtitle">如果管理入口也打不开，双击项目目录中的“服务救援.cmd”。</p></section>'));
      assets.get('/').body = Buffer.from(assets.get('/').body.toString('utf8').replace('</nav>',
        '<a href="' + parentPortal + '/roles" rel="noreferrer">角色卡管理</a><a href="' + parentPortal + '/voice" rel="noreferrer">语音设置</a><a href="' + parentPortal + '/image-generation" rel="noreferrer">图片生成设置</a></nav>'));
    }
  }
  if (sessionTrial && !textTrial) {
    assets.get('/').body = Buffer.from(assets.get('/').body.toString('utf8')
      .replaceAll('手动登录验证', '账号会话验证')
      .replace('登录成功后自动结束；本轮仅确认登录状态，不接入聊天。', '登录后验证账号会话初始化，再自动结束；本轮不收发聊天消息。'));
  }
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const respond = (code, type, body) => { response.writeHead(code, { 'Content-Type': type }); response.end(body); };
    const route = request.url?.split('?')[0];
    // 组合入口位于另一回环端口，正常顶层导航会标记same-site。
    // 仅首页导航例外；不包含状态、二维码、静态跨源子资源或任何操作。
    const localEntryNavigation = request.method === 'GET' && route === '/' &&
      request.headers['sec-fetch-site'] === 'same-site' && request.headers['sec-fetch-mode'] === 'navigate' &&
      request.headers['sec-fetch-dest'] === 'document' && (!request.headers.origin || request.headers.origin === origin);
    if (request.headers.host !== origin.slice('http://'.length) ||
        (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']) && !localEntryNavigation)) {
      respond(403, 'text/plain', 'Forbidden'); return;
    }
    if (request.method === 'GET' && assets.has(route)) {
      const asset = assets.get(route); respond(200, asset.type, asset.body); return;
    }
    if (request.method === 'GET' && route === '/state') {
      respond(200, 'application/json', JSON.stringify(controller.snapshot())); return;
    }
    if (request.method === 'GET' && route === '/qr.png') {
      const qr = controller.readQr(); respond(qr ? 200 : 404, qr ? 'image/png' : 'text/plain', qr || 'Unavailable'); return;
    }
    const isScope = (textTrial || gateway) && route === '/scope';
    const actionRoutes = ['/action/start', '/action/refresh', '/action/stop', ...(textTrial && !receiveOnly ? ['/action/send-private', '/action/send-group', '/action/confirm-private', '/action/confirm-group', '/action/reconnect'] : [])];
    if (request.method === 'POST' && (actionRoutes.includes(route) || isScope)) {
      const size = Number(request.headers['content-length'] || 0), scopeLimit = gateway ? 4096 : 2048;
      if (request.headers.origin !== origin || request.headers['x-qq-local-action'] !== '1' || request.headers['transfer-encoding'] ||
          !Number.isSafeInteger(size) || size < 0 || (isScope ? size < 1 || size > scopeLimit || request.headers['content-type'] !== 'application/json' : size !== 0)) {
        request.resume(); respond(403, 'text/plain', 'Forbidden'); return;
      }
      try {
        if (isScope) {
          let body = '', received = 0;
          for await (const chunk of request) { received += chunk.length; if (received > scopeLimit) throw new Error('BODY_LIMIT'); body += chunk.toString('utf8'); }
          if (!controller.configure(JSON.parse(body))) { respond(400, 'text/plain', 'Scope refused'); return; }
        } else if (route === '/action/stop') { void controller.stop(); }
        else if (route === '/action/start') controller.start();
        else if (route === '/action/refresh') controller.refresh();
        else if (route === '/action/reconnect') void controller.reconnect().catch(() => {});
        else if (route.startsWith('/action/send-')) void controller.sendTest(route.slice('/action/send-'.length)).catch(() => {});
        else if (route.startsWith('/action/confirm-')) controller.confirmReceipt(route.slice('/action/confirm-'.length));
        respond(200, 'application/json', JSON.stringify(controller.snapshot()));
      } catch { respond(500, 'text/plain', 'Action failed'); }
      return;
    }
    request.resume(); respond(404, 'text/plain', 'Not found');
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  return { url: origin, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
