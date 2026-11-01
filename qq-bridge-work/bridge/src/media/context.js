// Generated from media/context.ts. Edit the TypeScript source and run build:typed.
/**
 * 创建媒体/转发索引并提供提示和查找，构造无IO。
 * @param deps 实时模式、授权范围与会话读取能力。
 * @returns 索引与操作；宿主的会话重置沿用同一集合清理，普通模式查询不创建二代影子状态。
 */
export function createMediaContext(deps) {
    const nativeForwardMedia = new Map(), messageMediaStore = new Map(), seenForwardIds = new Map();
    function mediaHintFor(key, messageRef, mediaList) {
        if (!Array.isArray(mediaList) || mediaList.length === 0 || !messageRef)
            return '';
        if (deps.nativeBinding) {
            if (!/^(?:private|group):[1-9]\d{0,19}$/.test(key ?? ''))
                return '';
            const handles = mediaList.map((media) => String(media?.file ?? '')).filter((file) => /^qqimg_[a-f0-9]{32}$/.test(file)).slice(0, 32);
            const ref = /^-?[1-9]\d{0,29}$/.test(String(messageRef)) ? String(messageRef) : '';
            return `\n【本会话图片编号】${handles.join('、')}。编号只用于引用；是否读到内容以实际附带的图片字节为准。`
                + (ref ? `\n【当前图片消息】messageId="${ref}"。需要工具读取时直接用qq_get_message_images(key="${key}",messageId="${ref}",featureToken=本轮功能令牌)，无需先查询最近消息，不猜测seq或DSH事件序号。` : '');
        }
        if (deps.currentMode === 'reserved2') {
            return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。如需要查看/识别，请调用 mcp__qq_native__qq_get_message_images，参数 key="${key}", messageId="${messageRef}"。`;
        }
        return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。`;
    }
    function rememberNativeIncomingFeatureMetadata(kind, id, event) {
        if (!deps.nativeBinding || !deps.nativePolicyCurrent || !(0, deps.nativeScopeAllows)(deps.cfg.nativeScope, kind, String(id)))
            return;
        const key = `${kind}:${id}`, ref = String(event.message_id ?? event.msg_id ?? '');
        if (deps.nativeCapabilities.receiveImage && /^-?[1-9]\d{0,29}$/.test(ref)
            && (messageMediaStore.has(key) || messageMediaStore.size < 128)) {
            const media = (0, deps.extractMediaFromSegments)(event.message ?? []);
            if (media.length) {
                const entries = messageMediaStore.get(key) || new Map();
                entries.set(ref, media);
                while (entries.size > deps.MAX_MEDIA_STORE_PER_KEY)
                    entries.delete(entries.keys().next().value);
                messageMediaStore.set(key, entries);
            }
        }
        const forwards = (0, deps.extractForwardIds)(event.message ?? []);
        if (forwards.length && (seenForwardIds.has(key) || seenForwardIds.size < 128)) {
            const seen = seenForwardIds.get(key) || new Set();
            for (const value of forwards)
                seen.add(value);
            while (seen.size > 1000)
                seen.delete(seen.values().next().value);
            seenForwardIds.set(key, seen);
        }
    }
    function rememberNativeForwardResult(key, formatted) {
        const seen = seenForwardIds.get(key), media = [];
        const collect = (messages) => {
            for (const message of messages || []) {
                for (const id of message.nestedForwardIds || [])
                    if (seen && seen.size < 1000)
                        seen.add(id);
                if (deps.nativeCapabilities.receiveImage)
                    media.push(...message.media || []);
                else
                    message.media = [];
            }
        };
        collect(formatted.messages);
        for (const preview of formatted.nestedPreviews || [])
            collect(preview.messages);
        formatted.nestedForwardIds = [...new Set((formatted.messages || []).flatMap(message => message.nestedForwardIds || []))].slice(0, 1000);
        if (nativeForwardMedia.has(key) || nativeForwardMedia.size < 128)
            nativeForwardMedia.set(key, new Set(media.slice(0, 32).map(item => JSON.stringify(item))));
        return formatted;
    }
    function findMessageMedia(key, ref) {
        const refStr = String(ref ?? '').trim();
        if (!refStr)
            return [];
        // 二代：消息对象上直接带 media（仅在确实存在二代会话状态时读取，避免为 gen1 创建影子状态）
        if (deps.currentMode === 'reserved2' || deps.socialV2.conversations.has(key)) {
            try {
                const st = (0, deps.getSocialV2State)(key);
                if (st) {
                    // Unread can outlive the recent window. Compact model views retain
                    // handles instead of transport URLs, so both buffers must resolve.
                    for (const messages of [st.recentMessages, st.unread]) {
                        const found = (Array.isArray(messages) ? messages : []).find((m) => m && (String(m.messageId || '') === refStr || String(m.seq || '') === refStr));
                        if (found && Array.isArray(found.media) && found.media.length)
                            return found.media;
                    }
                }
            }
            catch { }
        }
        // 一代/普通模式：messageMediaStore
        const byRef = messageMediaStore.get(key);
        if (byRef) {
            const hit = byRef.get(refStr);
            if (Array.isArray(hit))
                return hit;
            // 兼容按 seq 查找（messageMediaStore 只存 messageId 时，尝试遍历所有值）
            for (const [storedRef, media] of byRef) {
                if (String(storedRef) === refStr && Array.isArray(media))
                    return media;
            }
        }
        return [];
    }
    return { mediaHintFor, rememberNativeIncomingFeatureMetadata, rememberNativeForwardResult, findMessageMedia, nativeForwardMedia, messageMediaStore, seenForwardIds };
}
