// Generated from search/parsers.ts. Edit the TypeScript source and run build:typed.
import { URL } from 'node:url';
function normalizeSearchUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!/^https?:\/\//i.test(s))
        return '';
    // DeepSeek 的结果 URL 会带 `#1` 这类"第几条"的锚点（不是页面真实片段），去掉更干净；
    // 但真实的 `#section` 也可能有意义，所以只去纯数字锚点。
    const cleaned = s.replace(/#\d+$/, '');
    try {
        const url = new URL(cleaned);
        if (!['http:', 'https:'].includes(url.protocol))
            return '';
        if (url.username || url.password)
            return '';
        return url.toString();
    }
    catch {
        return '';
    }
}
/** 把 Anthropic Messages 响应映射成统一结果（参照 dsh-web-search-deepseek 的实现）。 */
export function mapDeepSeekResponse(response, maxResults = 8) {
    const blocks = Array.isArray(response?.content) ? response.content : [];
    const resultBlocks = blocks.filter((block) => block?.type === 'web_search_tool_result');
    if (!resultBlocks.length) {
        throw Object.assign(new Error('DeepSeek 没有返回 web_search_tool_result（可能未触发联网搜索）'), { code: 'NO_RESULT_BLOCK' });
    }
    const snippets = new Map();
    for (const block of blocks) {
        if (block?.type !== 'text')
            continue;
        for (const cite of block.citations ?? []) {
            const url = normalizeSearchUrl(cite?.url);
            if (!url || snippets.has(url))
                continue;
            const text = String(cite?.cited_text ?? '').trim();
            if (text)
                snippets.set(url, text);
        }
    }
    const seen = new Set();
    const results = [];
    for (const block of resultBlocks) {
        for (const item of block?.content ?? []) {
            if (item?.type !== 'web_search_result')
                continue;
            const url = normalizeSearchUrl(item.url);
            if (!url || seen.has(url))
                continue;
            seen.add(url);
            const title = String(item.title ?? '').trim().slice(0, 200);
            const snippet = String(snippets.get(url) ?? '').trim().slice(0, 500);
            results.push({
                title,
                url,
                ...(snippet ? { snippet } : {}),
                ...(item.page_age ? { publishedAt: String(item.page_age).slice(0, 40) } : {})
            });
            if (results.length >= maxResults)
                return results;
        }
    }
    return results;
}
function decodeEntities(text) {
    return String(text ?? '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
        .replace(/&#(\d+);/g, (_, dec) => {
        const code = Number(dec);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function pickTag(block, tag) {
    const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    return match ? decodeEntities(match[1]) : '';
}
/** Bing 的 RSS 结果（比 HTML 页面稳定：没有 JS、结构固定）。 */
export function parseBingRss(xml, maxResults = 8) {
    const results = [];
    const seen = new Set();
    for (const match of String(xml ?? '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const block = match[1];
        const url = normalizeSearchUrl(pickTag(block, 'link'));
        if (!url || seen.has(url))
            continue;
        const title = pickTag(block, 'title').slice(0, 200);
        const snippet = pickTag(block, 'description').slice(0, 500);
        seen.add(url);
        results.push({ title: title || url, url, ...(snippet ? { snippet } : {}) });
        if (results.length >= maxResults)
            break;
    }
    return results;
}
/** Bing 的 HTML 结果页（RSS 不可用时的兜底，保持旧实现的解析口径）。 */
export function parseBingHtml(html, maxResults = 8) {
    const results = [];
    const seen = new Set();
    const blocks = String(html ?? '').split('<li class="b_algo"').slice(1);
    for (const block of blocks) {
        const hrefMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i);
        if (!hrefMatch)
            continue;
        const url = normalizeSearchUrl(decodeEntities(hrefMatch[1]));
        if (!url || seen.has(url))
            continue;
        const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
        const title = titleMatch ? decodeEntities(titleMatch[1]).slice(0, 200) : '';
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const snippet = snippetMatch ? decodeEntities(snippetMatch[1]).slice(0, 500) : '';
        seen.add(url);
        results.push({ title: title || url, url, ...(snippet ? { snippet } : {}) });
        if (results.length >= maxResults)
            break;
    }
    return results;
}
