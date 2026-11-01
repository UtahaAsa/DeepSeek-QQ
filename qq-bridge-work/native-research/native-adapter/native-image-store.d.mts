/// <reference types="node" />
/** 现有JS图片检查函数的消费边界；不表示整个原生句柄仓库已完成TS迁移。 */
export interface NativeImageInfo {size:number;width:number;height:number;format:string;mimeType:string;sha256:string;md5:string;}
/** 单张原生图片的既有字节上限。 */
export declare const IMAGE_MAX_BYTES:number;
/**
 * 检查字节与容器像素边界，无网络或解码器调用。
 * @param bytes 图片字节；非法输入抛固定IMAGE_LIMIT/IMAGE_FORMAT_INVALID错误。
 * @returns 尺寸、格式和摘要；不承诺完整解码或视觉正确性，不包含animated字段。
 */
export declare function inspectNativeImage(bytes:Buffer):NativeImageInfo;
