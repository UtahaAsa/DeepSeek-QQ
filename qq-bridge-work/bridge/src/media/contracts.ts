/// <reference types="node" />
/** 外部媒体引用仍是未知字段，实际路径/URL/格式校验沿原出口执行。 */
export interface MediaReference {kind?:unknown;file?:unknown;url?:unknown;emojiId?:unknown;subType?:unknown;summary?:unknown;faceId?:unknown;}
export interface ImageBytes {buffer:Buffer;mimeType:string;}
export type FaceMedia = (ImageBytes & {text?:string}) | {buffer?:undefined;mimeType?:undefined;text:string};
/** 模型预览失败不得被当成可编码的图片；原始收藏字节不走此归一化出口。 */
export type ModelMediaResult = {ok:true;buffer:Buffer;mimeType:string;note?:string} | {ok:false;buffer?:undefined;mimeType?:undefined;note?:string;error:unknown};
export interface ModelMediaLimits {enabled:boolean;maxModelBytes?:unknown;maxLongEdge?:unknown;gifFrames?:unknown;gifTile?:unknown;timeoutMs?:unknown;ffmpegPath?:unknown;}
export interface MediaPreview {index:number;kind:'face'|'sticker'|'image';faceId?:string;file?:string;url?:string;emojiId?:string;summary?:string;subType?:string;mimeType?:string;data?:string;text:string;}
export interface ForwardMediaMessage<Media extends MediaReference> {nestedForwardIds?:string[];media?:Media[];}
export interface ForwardMediaPacket<Media extends MediaReference> {messages?:ForwardMediaMessage<Media>[];nestedPreviews?:{messages?:ForwardMediaMessage<Media>[]}[];nestedForwardIds?:string[];}
