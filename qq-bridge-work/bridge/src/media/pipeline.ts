/// <reference types="node" />
import type {MediaReference,ImageBytes,FaceMedia,ModelMediaResult,ModelMediaLimits,MediaPreview} from './contracts.js';
import type {PromptText,PromptImage} from '../messaging/prompt-dispatch.js';
import type {createImageTools} from './image-tools.js';
interface ImageLookup {size?:unknown;data?:unknown;base64?:unknown;file?:unknown;url?:unknown;}
interface FaceLookup {q_des?:unknown;emoji_name_alias?:unknown[];url?:unknown;}
interface MediaError {message?:unknown;}
/** HTTP字节由已有限制的安全抓取器提供；本组件负责网关/本地文件范围与模型预览边界。 */
export interface MediaPipelineDependencies extends Pick<ReturnType<typeof createImageTools>,'emojiIdFromFileName'|'emojiCdnCandidates'|'acceptImageBuffer'|'mimeFromUrl'|'base64FromMaybe'|'isProbablySafeImageFileRef'> {
 readonly traceNativeReceive:(phase:string,bytes?:unknown)=>void;
 readonly normalizeImageForModel:(buffer:Buffer,mimeType:string,options:ModelMediaLimits&{label:string})=>Promise<ModelMediaResult>;
 readonly modelMediaLimits:ModelMediaLimits;readonly log:(message:string)=>void;
 readonly fs:Pick<typeof import('node:fs'),'realpathSync'|'existsSync'|'statSync'|'readFileSync'>;readonly path:Pick<typeof import('node:path'),'sep'>;
 readonly cfg:{onebot?:{homeDir?:unknown}};readonly MAX_MEDIA_BYTES:number;readonly MAX_MEDIA_COUNT:number;
 readonly safeFetchBuffer:(url:string,maxBytes:number)=>Promise<{buffer:Buffer}>;
 readonly bot:{getImage:(request:{file:string})=>Promise<unknown>;fetchFaceEntity:(id:number)=>Promise<unknown>};
 readonly Buffer:typeof globalThis.Buffer;readonly Math:Pick<Math,'round'>;
}
/**
 * 解析实际图片字节并构造模型/MCP两种媒体视图，构造不执行IO。
 * @param deps 受限抓取、网关查询、目录检查及归一化能力，按调用实时读取。
 * @returns 失败提示或已验证字节；数量、字节和像素上限保持，收藏使用原始字节。
 */
export function createMediaPipeline(deps:MediaPipelineDependencies) {
async function toModelMedia(buffer:Buffer, mimeType:string, label = '图片'):Promise<ModelMediaResult> {
    (0, deps.traceNativeReceive)('normalize_begin', buffer?.length);
    const out = await (0, deps.normalizeImageForModel)(buffer, mimeType, { ...deps.modelMediaLimits, label });
    (0, deps.traceNativeReceive)('normalize_end', out.buffer?.length);
    if (!out.ok) {
      (0, deps.log)(`[media] ${label} 不提供：${out.error}`);
      return out;
    }
    if (out.note) (0, deps.log)(`[media] ${label}: ${out.note}`);
    return out;
  }

function isSafeLocalMediaPath(filePath:unknown) {
    try {
      const real = deps.fs.realpathSync(String(filePath));
      const homeDir = deps.cfg.onebot?.homeDir ? String(deps.cfg.onebot.homeDir) : null;
      if (!homeDir) return false;
      const realHome = deps.fs.realpathSync(homeDir);
      return real === realHome || real.startsWith(realHome + deps.path.sep);
    } catch {
      return false;
    }
  }

async function fetchOneBotImage(media:MediaReference):Promise<ImageBytes|null> {
    // 表情包（市场/收藏表情）优先走 CDN：get_image 对市场表情必然失败
    // （OneBot兼容通道 缓存里没有该文件），先试 URL 能省一次失败往返，也更可靠。
    const emojiId = String(media.emojiId || (0, deps.emojiIdFromFileName)(media.file) || '');
    const isSticker = media.kind === 'sticker' || !!emojiId || String(media.subType || '') === '1';
    const label = isSticker ? '表情' : '图片';
    const failures:string[] = [];
    const urls:string[] = [];
    const pushUrl = (raw:unknown) => {
      const s = String(raw ?? '').trim();
      if (!/^https?:\/\//i.test(s) || urls.includes(s)) return;
      urls.push(s);
    };
    pushUrl(media.url);
    for (const candidate of (0, deps.emojiCdnCandidates)(emojiId)) pushUrl(candidate);

    const tryUrls = async () => {
      for (const url of urls) {
        try {
          const fetched = await (0, deps.safeFetchBuffer)(url, deps.MAX_MEDIA_BYTES);
          const accepted = (0, deps.acceptImageBuffer)(fetched.buffer, `${label} URL `);
          if (accepted) return { ...accepted, mimeType: accepted.mimeType || (0, deps.mimeFromUrl)(url) };
          failures.push(`${url} 不是有效图片`);
        } catch (error) {
          failures.push(`${url}: ${(error as MediaError | null)?.message ?? error}`);
        }
      }
      return null;
    };
    // 只有 file 是安全缓存文件名时才允许交给网关（防任意路径/内网 URL 注入）。
    const tryGetImage = async () => {
      if (!(media.kind === 'image' || media.kind === 'sticker')) return null;
      if (!media.file || !(0, deps.isProbablySafeImageFileRef)(media.file)) return null;
      try {
        (0, deps.traceNativeReceive)('media_get_begin');
        const info = await deps.bot.getImage({ file: String(media.file) }) as ImageLookup|null;
        (0, deps.traceNativeReceive)('media_get_end', info?.size);
        const obj = info && typeof info === 'object' ? info : {};
        const base64 = (0, deps.base64FromMaybe)(obj.data) || (0, deps.base64FromMaybe)(obj.base64) || (0, deps.base64FromMaybe)(obj.file);
        if (base64) {
          // 粗略估计 base64 解码后大小，超限直接拒绝，避免超大字符串撑爆内存
          if (base64.length * 3 / 4 <= deps.MAX_MEDIA_BYTES) {
            (0, deps.traceNativeReceive)('media_decode_begin');
            const accepted = (0, deps.acceptImageBuffer)(deps.Buffer.from(base64, 'base64'), 'get_image 返回的图片');
            (0, deps.traceNativeReceive)('media_decode_end', accepted?.buffer?.length);
            if (accepted) return accepted;
          } else {
            (0, deps.log)(`get_image 返回的图片 base64 超限，已跳过（${deps.Math.round(base64.length * 3 / 4 / 1024)}KB）`);
          }
        }
        if (obj.url) {
          try {
            const fetched = await (0, deps.safeFetchBuffer)(String(obj.url), deps.MAX_MEDIA_BYTES);
            const accepted = (0, deps.acceptImageBuffer)(fetched.buffer, 'get_image URL 图片');
            if (accepted) return { ...accepted, mimeType: accepted.mimeType || (0, deps.mimeFromUrl)(obj.url) };
          } catch (error) {
            failures.push(`get_image url: ${(error as MediaError | null)?.message ?? error}`);
          }
        }
        if (typeof obj.file === 'string' && !obj.file.startsWith('base64://') && deps.fs.existsSync(obj.file) && isSafeLocalMediaPath(obj.file)) {
          const stat = deps.fs.statSync(obj.file);
          if (stat.size > deps.MAX_MEDIA_BYTES) {
            (0, deps.log)(`本地图片文件超限，已跳过（${deps.Math.round(stat.size / 1024)}KB）`);
          } else {
            const accepted = (0, deps.acceptImageBuffer)(deps.fs.readFileSync(obj.file), '本地图片');
            if (accepted) return accepted;
          }
        }
      } catch (error) {
        failures.push(`get_image: ${(error as MediaError | null)?.message ?? error}`);
      }
      return null;
    };

    const result = isSticker
      ? (await tryUrls()) ?? (await tryGetImage())
      : (await tryGetImage()) ?? (await tryUrls());
    if (result) return result;
    if (failures.length) {
      (0, deps.log)(`[media] ${label}获取失败（${failures.length} 次尝试）：${failures.slice(0, 3).join(' | ')}`);
    }
    return null;
  }

async function fetchFaceMedia(media:MediaReference):Promise<FaceMedia> {
    const faceId = Number(media.faceId);
    // 系统小表情（face 段）：只有数字 id 才有对应实体；拿不到时至少保留 summary 文案。
    const fallbackText = media.summary ? `[表情:${media.summary}]` : `[表情#${media.faceId}]`;
    if (!Number.isInteger(faceId)) return { text: fallbackText };
    try {
      const face = await deps.bot.fetchFaceEntity(faceId) as FaceLookup|null;
      if (face && typeof face === 'object') {
        const desc = face.q_des || (Array.isArray(face.emoji_name_alias) && face.emoji_name_alias[0]) || '';
        if (face.url) {
          try {
            const fetched = await (0, deps.safeFetchBuffer)(String(face.url), deps.MAX_MEDIA_BYTES);
            const accepted = (0, deps.acceptImageBuffer)(fetched.buffer, '表情图片');
            if (accepted) return { ...accepted, mimeType: accepted.mimeType || (0, deps.mimeFromUrl)(face.url), text: desc ? `[表情:${desc}]` : '' };
          } catch (error) {
            (0, deps.log)(`表情图片抓取失败: ${(error as MediaError | null)?.message ?? error}`);
          }
        }
        return { text: desc ? `[表情:${desc}]` : fallbackText };
      }
    } catch (error) {
      (0, deps.log)(`fetchFaceEntity 失败: ${(error as MediaError | null)?.message ?? error}`);
    }
    return { text: fallbackText };
  }

async function resolveMediaList(mediaList:unknown):Promise<(PromptText|PromptImage)[]> {
    const parts:(PromptText|PromptImage)[] = [];
    let index = 0;
    let totalBytes = 0;
    for (const media of Array.isArray(mediaList) ? mediaList as (MediaReference|null|undefined)[] : []) {
      index += 1;
      if (index > deps.MAX_MEDIA_COUNT) {
        parts.push({ type: 'text', text: `[图片/表情 ${index}（超过单条上限 ${deps.MAX_MEDIA_COUNT}，已跳过）]` });
        continue;
      }
      if (!media || typeof media !== 'object') continue;
      if (media.kind === 'face') {
        const face = await fetchFaceMedia(media);
        const prep = face.buffer ? await toModelMedia(face.buffer, face.mimeType, `表情#${media.faceId ?? index}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > deps.MAX_MEDIA_BYTES) {
            parts.push({ type: 'text', text: `[表情${index}（图片总大小超限，已跳过）]` });
            continue;
          }
          totalBytes += prep.buffer.length;
          if (face.text) parts.push({ type: 'text', text: face.text });
          if (prep.note) parts.push({ type: 'text', text: `（${prep.note}）` });
          parts.push({ type: 'image', mediaType: prep.mimeType, data: prep.buffer.toString('base64'), name: `face-${media.faceId}.${(prep.mimeType || 'png').split('/')[1]}` });
        } else if (prep && !prep.ok) {
          // 压不到可用体积：明确说明原因，别让模型对着「（获取失败）」瞎猜。
          parts.push({ type: 'text', text: `[表情${index}（${prep.error}）]` });
        } else {
          parts.push({ type: 'text', text: face.text || `[表情#${media.faceId}]` });
        }
      } else {
        const img = await fetchOneBotImage(media);
        const sticker = media.kind === 'sticker';
        const summary = sticker && media.summary ? `:${String(media.summary).slice(0, 20)}` : '';
        const label = sticker ? (summary ? `[表情${summary}]` : `[表情${index}]`) : `[图片${index}]`;
        const prep = img?.buffer ? await toModelMedia(img.buffer, img.mimeType, `${label}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > deps.MAX_MEDIA_BYTES) {
            parts.push({ type: 'text', text: `${label}（图片总大小超限，已跳过）` });
            continue;
          }
          totalBytes += prep.buffer.length;
          parts.push({ type: 'text', text: label });
          if (prep.note) parts.push({ type: 'text', text: `（${prep.note}）` });
          parts.push({ type: 'image', mediaType: prep.mimeType, data: prep.buffer.toString('base64'), name: `qq-${sticker ? 'sticker' : 'image'}-${index}.${(prep.mimeType || 'image/jpeg').split('/')[1]}` });
        } else if (prep && !prep.ok) {
          parts.push({ type: 'text', text: `${label}（${prep.error}）` });
        } else {
          parts.push({ type: 'text', text: `${label}（获取失败）` });
        }
      }
    }
    return parts;
  }

async function fetchMediaData(mediaList:unknown):Promise<MediaPreview[]> {
    const out:MediaPreview[] = [];
    let index = 0;
    let totalBytes = 0;
    for (const media of Array.isArray(mediaList) ? mediaList as (MediaReference|null|undefined)[] : []) {
      index += 1;
      if (index > deps.MAX_MEDIA_COUNT) {
        out.push({ index, kind: media?.kind === 'face' ? 'face' : (media?.kind === 'sticker' ? 'sticker' : 'image'), text: `（超过单条上限 ${deps.MAX_MEDIA_COUNT}，已跳过）` });
        continue;
      }
      if (!media || typeof media !== 'object') continue;
      if (media.kind === 'face') {
        const face = await fetchFaceMedia(media);
        const prep = face.buffer ? await toModelMedia(face.buffer, face.mimeType, `表情#${media.faceId ?? index}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > deps.MAX_MEDIA_BYTES) {
            out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: '（图片总大小超限，已跳过）' });
            continue;
          }
          totalBytes += prep.buffer.length;
          out.push({
            index,
            kind: 'face',
            faceId: media.faceId ? String(media.faceId) : undefined,
            mimeType: prep.mimeType,
            data: prep.buffer.toString('base64'),
            text: [face.text || '', prep.note ? `（${prep.note}）` : ''].filter(Boolean).join(' ')
          });
        } else if (prep && !prep.ok) {
          out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: `（获取失败：${prep.error}）` });
        } else {
          out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: face.text || `[表情#${media.faceId}]` });
        }
      } else {
        const img = await fetchOneBotImage(media);
        const kind = media.kind === 'sticker' ? 'sticker' : 'image';
        const noun = kind === 'sticker' ? '表情' : '图片';
        const base:Omit<MediaPreview,'text'> = {
          index,
          kind,
          ...(media.file ? { file: String(media.file) } : {}),
          ...(media.url ? { url: String(media.url) } : {}),
          ...(media.emojiId ? { emojiId: String(media.emojiId) } : {}),
          ...(media.summary ? { summary: String(media.summary) } : {}),
          ...(media.subType ? { subType: String(media.subType) } : {})
        };
        const prep = img?.buffer ? await toModelMedia(img.buffer, img.mimeType, `${noun}${index}`) : null;
        if (prep?.ok) {
          if (totalBytes + prep.buffer.length > deps.MAX_MEDIA_BYTES) {
            out.push({ ...base, text: `（${noun}总大小超限，已跳过）` });
            continue;
          }
          totalBytes += prep.buffer.length;
          out.push({
            ...base,
            mimeType: prep.mimeType,
            data: prep.buffer.toString('base64'),
            text: prep.note ? `（${prep.note}）` : ''
          });
        } else if (prep && !prep.ok) {
          out.push({ ...base, text: `（${noun}获取失败：${prep.error}）` });
        } else {
          out.push({ ...base, text: `（${noun}获取失败）` });
        }
      }
    }
    return out;
  }
return {toModelMedia,isSafeLocalMediaPath,fetchOneBotImage,fetchFaceMedia,resolveMediaList,fetchMediaData};
}
