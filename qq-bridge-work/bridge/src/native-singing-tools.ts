import type {NativeToolDependencies} from './native-sticker-tools.js';
import type {z} from 'zod';
/**
 * 注册当前会话的歌曲库、异步生成、进度与一次发送工具；不提供任意文件/URL输入。
 * @param {object} options 沿用本机MCP的server/z/agentApi/headers和会话令牌校验。
 * @returns {void} 生成与发送分开；只有confirmed=true才可声称QQ已收到。
 */
export function registerNativeSingingTools({ server, z, agentApi, headers, featureTokenSchema, serialize }: NativeToolDependencies): void {
  const identity = { key: z.string().regex(/^(private|group):[1-9]\d{0,19}$/), featureToken: featureTokenSchema, token: z.string().optional() };
  const job = z.string().regex(/^[a-f0-9]{32}$/);
  const definitions: [string,string,z.ZodRawShape,string][] = [
    ['qq_list_songs', '查看本机已登记、可用RVC转换的歌曲。只能唱返回的songId，不能编造曲库或把普通TTS当唱歌。', {}, 'catalog'],
    ['qq_prepare_song', '准备当前聊天需要的RVC歌声。返回任务编号；preparing表示仍在加载，prepared才生成完成。只创建本地音频，不发送QQ；失败不自动重试。',
      { songId: z.string().regex(/^[a-z0-9-]{1,48}$/), pitch: z.number().int().min(-12).max(12).optional() }, 'prepare'],
    ['qq_song_status', '查询本次聊天歌声任务状态；preparing时如实说明还在准备，不密集轮询。prepared后可调用qq_send_song。', { job }, 'status'],
    ['qq_send_song', '把当前聊天已完成的RVC歌声任务作为一条QQ语音发送，只允许一次。仅confirmed=true才能说已发出；未知或失败不可自动重发。', { job }, 'send'],
  ];
  for (const [name, description, fields, operation] of definitions) server.tool(name, description, { ...identity, ...fields }, async input => {
    try {
      const { featureToken, token, ...body } = input;
      const value = await agentApi('/api/native/singing/' + operation, { method: 'POST', body: JSON.stringify(body),
        headers: headers(featureToken, token), timeoutMs: operation === 'send' ? 60000 : 15000 });
      return { content: [{ type: 'text', text: serialize(value) }] };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'SINGING_UNAVAILABLE：本次唱歌操作未确认。检查当前任务和本机语音发送许可，不要声称已生成或已发送，也不要自动重试发送。' }] };
    }
  });
}
