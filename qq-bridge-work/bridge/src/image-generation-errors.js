// Generated from image-generation-errors.ts. Edit the TypeScript source and run build:typed.
/** 固定供应商错误码；用于深度投影，不允许按外部错误前缀透传。 */
export const IMAGE_PROVIDER_ERROR_CODES = Object.freeze(['IMAGE_PROVIDER_URL_INVALID', 'IMAGE_PROVIDER_CONFIG_INVALID',
    'IMAGE_PROVIDER_CANCELLED', 'IMAGE_PROVIDER_REQUEST_INVALID', 'IMAGE_PROVIDER_OUTCOME_UNKNOWN', 'IMAGE_PROVIDER_TIMEOUT',
    'IMAGE_PROVIDER_DNS_REFUSED', 'IMAGE_PROVIDER_NETWORK_FAILED', 'IMAGE_PROVIDER_RATE_LIMITED', 'IMAGE_PROVIDER_REDIRECT_REFUSED',
    'IMAGE_PROVIDER_REJECTED', 'IMAGE_PROVIDER_DOWNLOAD_FAILED', 'IMAGE_PROVIDER_RESPONSE_INVALID', 'IMAGE_PROVIDER_RESPONSE_LIMIT',
    'IMAGE_PROVIDER_IMAGE_INVALID', 'IMAGE_PROVIDER_FAILED']);
/** 固定管理/模型错误码；不含供应商正文、配置输入或凭据。 */
export const IMAGE_GENERATION_API_ERRORS = Object.freeze([...IMAGE_PROVIDER_ERROR_CODES, 'IMAGE_GENERATION_CLOSED',
    'IMAGE_GENERATION_CLOCK_INVALID', 'IMAGE_GENERATION_CANCELLED', 'IMAGE_GENERATION_NOT_AUTHORIZED', 'IMAGE_GENERATION_RESULT_INVALID',
    'IMAGE_GENERATION_UPLOAD_FAILED', 'IMAGE_GENERATION_RATE_LIMITED', 'IMAGE_GENERATION_FAILED', 'IMAGE_GENERATION_CONFIG_INVALID',
    'IMAGE_GENERATION_REVISION_CONFLICT', 'IMAGE_GENERATION_CREDENTIAL_REQUIRED', 'IMAGE_GENERATION_NOT_CONFIGURED',
    'IMAGE_GENERATION_BUSY', 'IMAGE_GENERATION_INPUT_INVALID']);
const generationErrors = new Set(IMAGE_GENERATION_API_ERRORS);
/**
 * 投影生图失败的固定码及本地限流信息；丢弃任意诊断、句柄、地址和凭据。
 * @param {unknown} code 后端错误码；原生功能授权/输入错误只映射为对应生图固定码。
 * @param {object} details 可选错误附加字段；仅限流且明确未提交时保留合法剩余秒数。
 * @returns {object} error及可选submitted=false/rateLimit/retryAfterSeconds；同步纯函数，不修改输入。
 */
export function projectImageGenerationError(code, details = {}) {
    if (code === 'NATIVE_FEATURE_NOT_AUTHORIZED')
        code = 'IMAGE_GENERATION_NOT_AUTHORIZED';
    if (code === 'NATIVE_FEATURE_INPUT_INVALID')
        code = 'IMAGE_GENERATION_INPUT_INVALID';
    const error = generationErrors.has(code) ? code : 'IMAGE_GENERATION_FAILED';
    const limit = details?.rateLimit, seconds = details?.retryAfterSeconds;
    const localLimit = error === 'IMAGE_GENERATION_RATE_LIMITED' && details?.submitted === false
        && ['cooldown', 'daily'].includes(limit) && Number.isSafeInteger(seconds) && seconds >= 1
        && seconds <= (limit === 'cooldown' ? 60 : 86400);
    return { error, ...(localLimit ? { submitted: false, rateLimit: limit, retryAfterSeconds: seconds } : {}) };
}
/**
 * 给模型提供固定中文失败说明；本地拒绝不暗示供应商已经受理，不自动重试。
 * @param {object} value error及受控限流字段；不使用任意message或外部响应正文。
 * @returns {string} 经白名单投影的说明；同步纯函数，不修改输入。
 */
export function imageGenerationErrorInstruction(value) {
    const failure = projectImageGenerationError(value?.error, value), code = failure.error;
    if (code === 'IMAGE_GENERATION_RATE_LIMITED')
        return failure.submitted === false
            ? (failure.rateLimit === 'cooldown' ? '本会话60秒生成冷却尚未结束' : '本机今日生成次数已达上限')
                + '，约' + failure.retryAfterSeconds + '秒后解除。本次未向供应商提交，也没有生成新图片；不要自动重试或用旧图冒充本次结果。'
            : '本机生成频率或次数达到限制，本次未完成；不要自动重试或用旧图冒充本次结果。';
    if (['IMAGE_GENERATION_NOT_CONFIGURED', 'IMAGE_GENERATION_CREDENTIAL_REQUIRED'].includes(code))
        return '本机图片生成尚未完成配置，本次没有生成新图片；请本机操作者检查配置，不要自动重试。';
    if (code === 'IMAGE_GENERATION_NOT_AUTHORIZED')
        return '本次图片生成许可或会话资格已失效，本次未完成；不要使用旧令牌、自动重试或声称已生成。';
    if (['IMAGE_GENERATION_CANCELLED', 'IMAGE_GENERATION_CLOSED', 'IMAGE_PROVIDER_CANCELLED'].includes(code))
        return '本次图片生成已取消，没有可交付的新图片；供应商受理情况未确认，不要自动重试或声称已发送。';
    if (code === 'IMAGE_GENERATION_BUSY')
        return '本机另有图片生成仍在结算，本次未开始生成；不要自动重试。';
    if (code === 'IMAGE_GENERATION_INPUT_INVALID')
        return '本次图片生成输入不符合要求，没有可交付的新图片；不要自动重试。';
    if (IMAGE_PROVIDER_ERROR_CODES.includes(code))
        return '图片供应商请求未完成或结果未确认，没有可交付的新图片；供应商可能已受理，不要自动重试，请本机操作者检查固定错误码。';
    return '本次图片生成未完成，没有可交付的新图片；供应商受理情况未确认，不要自动重试、复用旧图冒充结果或声称已发送。';
}
