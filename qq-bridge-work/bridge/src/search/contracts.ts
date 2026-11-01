/// <reference types="node" />
/** 操作员搜索配置；缺省值沿原解析器补齐，不因类型迁移更换供应商或模型。 */
export interface SearchConfiguration {provider?:'auto'|'deepseek'|'bing';apiKey?:string;apiKeyEnv?:string;baseURL?:string;model?:string;maxUses?:number;maxTokens?:number;maxResults?:number;timeoutMs?:number;}
export interface SearchResult {title:string;url:string;snippet?:string;publishedAt?:string;}
export interface SearchResponse {query:string;provider:'deepseek'|'bing';results:SearchResult[];fallbackFrom?:string;note?:string;}
export interface SearchOptions {root?:string;config?:SearchConfiguration;provider?:SearchConfiguration['provider'];}
export interface SearchPostOptions {headers:import('node:http').OutgoingHttpHeaders;body:string;timeoutMs:number;maxBytes?:number;}
export interface SearchPostResponse {status:number;text:string;}
/** 原Messages结构的局部投影；正文/链接在既有type与URL检查后转换。 */
export interface SearchBlock {type?:unknown;citations?:({url?:unknown;cited_text?:unknown}|null)[];content?:({type?:unknown;url?:unknown;title?:unknown;page_age?:unknown}|null)[];}
export interface SearchError {code?:unknown;message?:unknown;}
