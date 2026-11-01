/**
 * 生成唯一工作台入口；管理功能进入DSH的QQ工作台，连接恢复按需展开。
 * @param {string|null} qqUrl 所属QQ手动连接页的无凭据回环地址。
 * @param {boolean} canRestart 是否提供本人重新准备连接页的按钮。
 * @returns {string} 本机入口HTML；启动凭据只在点击后的同源交接中使用。
 */
export function renderPortal(qqUrl, canRestart = false) {
  let target = '#';
  try { const url = new URL(qqUrl); if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/') target = url.origin; } catch {}
  const recovery = canRestart ? '<button id="restart-qq" type="button">重新准备 QQ 控制台</button>'
    : '<a href="' + target + '" rel="noreferrer">打开本人连接页面</a>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek QQ工作台</title>
<style>body{--bg:#f3f7ff;--panel:#fff;--ink:#162744;--muted:#465b7c;--brand:#255bc7;font:16px/1.7 "Microsoft YaHei UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;padding:24px}main{max-width:660px;margin:8vh auto;background:var(--panel);padding:32px;border-radius:18px}h1{font-size:28px;color:var(--brand);margin:0}p{margin:12px 0;color:var(--muted)}button,a,summary{box-sizing:border-box;min-height:44px;font:inherit}button,a{display:inline-flex;align-items:center;padding:10px 16px;margin:8px 0;border-radius:8px}button{border:0;background:var(--brand);color:var(--panel);cursor:pointer}button:disabled{opacity:.65;cursor:wait}a{color:var(--brand)}summary{cursor:pointer;padding:8px 0}details{margin-top:32px;border-top:1px solid #8ca0c0;padding-top:12px}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--brand);outline-offset:3px}#feedback{min-height:54px}@media(prefers-color-scheme:dark){body{--bg:#111b2c;--panel:#1a2940;--ink:#edf3ff;--muted:#c1cee3;--brand:#a6c4ff}button{color:#112643}}@media(max-width:480px){body{padding:16px}main{margin:24px auto;padding:24px}h1{font-size:25px}}</style></head>
<body><main><h1>DeepSeek QQ工作台</h1><p>在DSH中统一管理角色、聊天授权、图片、语音和QQ功能。</p><button id="open-dsh" type="button">进入 DSH QQ工作台</button><p id="feedback" role="status" aria-live="polite">进入后可在左侧“QQ工作台”继续。原有模型、声音与会话保持。</p>
<details><summary>连接恢复</summary><p>QQ连接结束时，可在这里重新准备本人连接页面。按QQ提示处理验证后，返回工作台。</p>${recovery}</details>
<p>当前为内部验收候选。设置生效、实际收发与持续运行分别核验。</p><noscript>请启用JavaScript后打开本机工作台。</noscript></main>
<script>
const button=document.getElementById('open-dsh'),feedback=document.getElementById('feedback'),restart=document.getElementById('restart-qq');
button.addEventListener('click',async()=>{button.disabled=true;button.setAttribute('aria-busy','true');feedback.textContent='正在进入QQ工作台…';try{
const response=await fetch('/dsh-launch',{method:'POST',headers:{'X-QQ-Local-Action':'1'},cache:'no-store',signal:AbortSignal.timeout(8000)});
if(!response.ok)throw new Error();const data=await response.json(),destination=new URL(data.url);
if(destination.hostname!=='127.0.0.1'||destination.protocol!=='http:')throw new Error();
destination.hash='qq-workspace';window.location.replace(destination.href);
}catch{feedback.textContent='入口暂时未能打开，请稍后重试。';button.disabled=false;button.removeAttribute('aria-busy');}});
if(restart)restart.addEventListener('click',async()=>{restart.disabled=true;feedback.textContent='正在准备本人连接页面…';try{
const response=await fetch('/qq-restart',{method:'POST',headers:{'X-QQ-Local-Action':'1'},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error();const data=await response.json(),url=new URL(data.url);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error();window.location.assign(url.href);
}catch{feedback.textContent='连接页面暂时未能准备，DSH工作台仍保持运行。';restart.disabled=false;}});
</script></body></html>`;
}
