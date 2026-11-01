/// <reference types="node" />
import type {McpToolDependencies,LegacyMcpError,LegacyImageResponse,LegacyActionResponse,LegacyMcpImage} from './contracts.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
interface GeneratedImageResponse {file?: string; generated?: unknown; sent?: unknown; size: number; mimeType?: unknown; maxAgeSeconds?: unknown;}
interface ForwardMedia {url?: unknown; file?: unknown; faceId?: unknown; [key: string]: unknown;}
interface ForwardMessage {media?: ForwardMedia[];}
interface ForwardResponse {messages?: ForwardMessage[]; nestedPreviews?: {messages?: ForwardMessage[]}[];}
/** 注册qq_generate_image；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGenerateImage(deps: Pick<McpToolDependencies,"agentApi"|"imageGenerationErrorInstruction"|"projectImageGenerationError"|"serializeModelData"|"server"|"z">): void {
  const { agentApi, imageGenerationErrorInstruction, projectImageGenerationError, serializeModelData, server, z } = deps;
  server.tool(
    'qq_generate_image',
    '按当前聊天需要生成一张图片，可能产生已配置供应商的费用。所有原生聊天模式可用，须本机独立开启并完成配置。只能使用当前输入提供的会话和生成会话令牌；失败不能自动重试。返回图片编号后可在回复中使用 [[qq-image:完整编号]]，生成完成不代表QQ已送达。',
    {
      key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/).describe('当前输入的会话标识，不选择其它会话'),
      prompt: z.string().min(1).max(4000).describe('当前请求的绘图描述，最多2000个字符；不附加号码、凭据或无关聊天'),
      generationToken: z.string().regex(/^[a-f0-9]{64}$/).describe('当前提示给出的生成会话令牌，不能猜测或使用旧对话令牌')
    },
    async ({ key, prompt, generationToken }) => {
      try {
        const body = await agentApi('/api/images/generate', { method: 'POST', body: JSON.stringify({ key, prompt, generationToken }), timeoutMs: 255000 }) as GeneratedImageResponse;
        if (!/^qqimg_[a-f0-9]{32}$/.test(body?.file ?? '') || body.generated !== true || body.sent !== false ||
          !Number.isSafeInteger(body.size) || body.size < 1 || body.size > 8 * 1024 * 1024) throw new Error();
        return {
          content: [{
            type: 'text', text: serializeModelData({
              file: body.file, size: body.size,
              mimeType: body.mimeType, generated: true, sent: false, maxAgeSeconds: body.maxAgeSeconds,
              instruction: '在当前会话的回复中使用 [[qq-image:' + body.file + ']] 才会进入发送流程；不能宣称已送达。'
            })
          }]
        };
      } catch (error) {
        const failure = projectImageGenerationError((error as LegacyMcpError | null)?.code, error);
        return {
          content: [{
            type: 'text', text: serializeModelData({
              ...failure,
              instruction: imageGenerationErrorInstruction(failure)
            })
          }], isError: true
        };
      }
    }
  );
}

/** 注册qq_get_message_images；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetMessageImages(deps: Pick<McpToolDependencies,"agentApi"|"cfg"|"nativeFeatureHeaders"|"nativeFeatureTokenSchema"|"server"|"z">): void {
  const { agentApi, cfg, nativeFeatureHeaders, nativeFeatureTokenSchema, server, z } = deps;
  server.tool(
    'qq_get_message_images',
    '获取指定 QQ 消息中的图片/表情，并直接以图像内容返回给模型（视觉模型可“看懂”）。当消息文本里出现 [图片]、[表情] 或 hasMedia=true 时调用。支持一条消息里的多张图片/表情；二代模式下必须携带会话令牌。**动图（GIF/动态表情）会被桥接抽帧拼成多格图再给你**：说明里会写「动图 N 帧/…s，已抽 X 帧拼成 A×B 网格，行优先 左上→右下」——按格子顺序理解动作即可，不要把它当成一张九宫格照片；没有这类说明就是静态图。体积过大的图会被自动缩放/重编码，说明里会给出原始尺寸与体积；如果真的压不到可用体积，返回里会直接写明原因（例如「超过上限」），此时如实告诉对方你看不到，不要编造画面。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      messageId: z.union([z.number(), z.string()]).describe(cfg.nativeFeatureProtocol === 1
        ? '使用本轮提示【当前图片消息】中的messageId；没有有效编号时不猜测，不用DSH事件序号或本地seq'
        : '要查看的消息 id（QQ 消息 id 可为负数；二代也可用本地 seq）'),
      featureToken: nativeFeatureTokenSchema,
      token: z.string().optional().describe('二代会话令牌（reserved2 下必填，见唤醒提示中的【会话令牌】）')
    },
    async ({ key, messageId, token, featureToken }) => {
      try {
        const q = new URLSearchParams({ key, messageId: String(messageId) });
        const data = await agentApi(`/api/images/message?${q.toString()}`, {
          headers: nativeFeatureHeaders(featureToken, token),
          timeoutMs: 180000
        }) as {images?: LegacyMcpImage[]; note?: unknown};
        const images = Array.isArray(data?.images) ? data.images : [];
        if (!images.length) {
          return { content: [{ type: 'text', text: `消息 ${messageId} 没有可返回的图片/表情：${data?.note || '未找到'}` }] };
        }
        const content: CallToolResult['content'] = [];
        const textParts = [];
        for (const img of images) {
          if (img?.data && img?.mimeType) {
            // 精简历史不保留原始file字段；读图时须补回当前会话的有效原生编号。
            // 只投影随机句柄，不能把上游文件路径或URL带进模型的回发指令。
            const handle = cfg.nativeFeatureProtocol === 1 && typeof img.file === 'string' && /^qqimg_[a-f0-9]{32}$/.test(img.file) ? img.file : null;
            const reference = cfg.nativeFeatureProtocol === 1 ? handle
              ? ` 完整图片编号：${handle}；回发原图可用 [[qq-image:${handle}]]。仅本会话有效，最长十分钟，失效后不可猜测替换。`
              : ' 本项没有可用的原图回发编号，不要编造。' : '';
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : ''}]${reference}`);
            content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
          } else {
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : '（获取失败）'}]`);
          }
        }
        if (textParts.length) {
          content.unshift({ type: 'text', text: `消息 ${messageId} 的媒体内容（${images.length} 项）：\n${textParts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取图片失败：${(error as LegacyMcpError | null)?.message ?? error}` }], isError: true };
      }
    }
  );
}

/** 注册qq_get_forward_msg；参数/描述/权限和原入口保持一致。
 * @param {object} deps 所属MCP实例的服务器、schema及API依赖。
 * @returns {void} 同步注册；调用失败由原工具回调返回isError。
 */
export function registerQqGetForwardMsg(deps: Pick<McpToolDependencies,"agentApi"|"nativeFeatureHeaders"|"nativeFeatureTokenSchema"|"serializeModelData"|"server"|"z">): void {
  const { agentApi, nativeFeatureHeaders, nativeFeatureTokenSchema, serializeModelData, server, z } = deps;
  server.tool(
    'qq_get_forward_msg',
    '查看当前会话中出现的合并转发消息/聊天记录内容（只读）。当消息文本里出现 `[转发消息 id=...]`，或 `qq_get_unread_messages` / `qq_get_recent_messages` / `qq_get_message_detail` 返回的某条消息带 `forwardIds` / `hasForward: true` 时调用。只能查看当前会话确实收到过的转发消息 id，不能任意读取。返回内容会包含每条消息的 text、media（图片/表情元数据）与 nestedForwardIds；如果合并转发里有图片，工具会直接把最多 5 张图片以图像内容返回给视觉模型；如果里面有嵌套合并转发，会附带嵌套转发 id 和前几条预览，必要时可继续用本工具查看嵌套 id。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      featureToken: nativeFeatureTokenSchema,
      token: z.string().optional().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      id: z.string().describe('合并转发消息 id（来自消息里的 [转发消息 id=...] 或 forwardIds 数组）')
    },
    async ({ key, token, id, featureToken }) => {
      try {
        const q = new URLSearchParams({ key, id: String(id) });
        const data = await agentApi(`/api/socialV2/forward-message?${q.toString()}`, {
          headers: nativeFeatureHeaders(featureToken, token),
          timeoutMs: 120000
        }) as ForwardResponse;
        const content: CallToolResult['content'] = [{ type: 'text', text: serializeModelData(data) }];
        // 收集所有层级的图片/表情元数据（含嵌套预览），最多返回 5 张。
        const images: ForwardMedia[] = [];
        const seen = new Set();
        const collectMedia = (msgs: ForwardMessage[] | undefined) => {
          if (!Array.isArray(msgs)) return;
          for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            for (const media of Array.isArray(m.media) ? m.media : []) {
              if (!media || typeof media !== 'object') continue;
              const keyId = media.url || media.file || media.faceId || '';
              if (!keyId || seen.has(keyId)) continue;
              seen.add(keyId);
              images.push(media);
            }
          }
        };
        collectMedia(data?.messages);
        if (Array.isArray(data?.nestedPreviews)) {
          for (const np of data.nestedPreviews) collectMedia(np?.messages);
        }
        const MAX_IMAGES = 5;
        const imageTexts = [];
        if (images.length) {
          try {
            const mediaRes = await agentApi('/api/socialV2/forward-media', {
              method: 'POST',
              body: JSON.stringify({ key, media: images.slice(0, MAX_IMAGES) }),
              headers: nativeFeatureHeaders(featureToken, token),
              timeoutMs: 180000
            }) as {images?: LegacyMcpImage[]};
            const mediaImages = Array.isArray(mediaRes?.images) ? mediaRes.images : [];
            for (const img of mediaImages) {
              if (img?.data && img?.mimeType) {
                content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}${img.text ? ' ' + img.text : ''}]`);
              } else {
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}（${img.text || '获取失败'}）]`);
              }
            }
          } catch (error) {
            imageTexts.push(`[转发内图片（批量获取失败：${(error as LegacyMcpError | null)?.message ?? error}）]`);
          }
        }
        if (imageTexts.length) {
          content.unshift({ type: 'text', text: `合并转发 ${id} 的图片内容（${imageTexts.length} 项）：\n${imageTexts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `查看合并转发失败：${(error as LegacyMcpError | null)?.message ?? error}` }], isError: true };
      }
    }
  );
}
