/** 固定公开试用接口；不接受模型、聊天或页面传入替代服务器。 */
export const PUBLIC_FLUX = Object.freeze({
  provider: 'hf-flux-schnell-public',
  endpoint: 'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer',
  model: 'FLUX.1-schnell', size: '1024x1024', quality: '', responseFormat: 'default',
});

/**
 * 判断已规范化的供应商配置是否为无需凭据的固定公共FLUX接口。
 * @param {object|null} settings 已通过权威配置校验的设置。
 * @returns {boolean} 仅固定公共供应商返回true；不联网、不修改输入。
 */
export const isPublicFlux = (settings:unknown):boolean => (settings as {provider?:unknown}|null)?.provider === PUBLIC_FLUX.provider;

/**
 * 校验公共任务返回的临时图像地址；禁止任意服务器文件、查询参数或跨域地址。
 * @param {URL} url 已解析且通过公网HTTPS语法校验的URL。
 * @returns {boolean} 仅当前官方Space的Gradio临时图片路径返回true。
 */
export const isPublicFluxImageUrl = (url:URL):boolean => url.origin === new URL(PUBLIC_FLUX.endpoint).origin && !url.search &&
  /^\/(?:gradio_api\/)?file=\/tmp\/gradio\/[a-f0-9]{32,128}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.(?:png|webp|jpe?g)$/.test(url.pathname);
