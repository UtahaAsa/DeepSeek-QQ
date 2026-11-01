// Generated from messaging/outbound-policy.ts. Edit the TypeScript source and run build:typed.
/**
 * @typedef {{bound:boolean,current:boolean,allowSend?:boolean,generation:number,inboundGeneration?:number|null}} NativePolicySnapshot
 */
/**
 * 构造所属桥接的出站守卫；只通过回调读取当前状态，不缓存权限结论。
 * @param {{getMode:()=>unknown,getOwner:()=>unknown,getSessionId:(key:string)=>unknown,sessionPolicy:(key:string)=>unknown,isAllowed:(key:string)=>boolean,getNativeState:()=>NativePolicySnapshot,readRoleState:()=>{mode?:unknown}}} options 所属实例状态读取能力。
 * @returns {{shouldAuditKey:(key:string)=>boolean,captureSendGuard:(key:string)=>(()=>void),shouldBlockSilentReply:(key:string)=>boolean}} 审计范围、静默判定和发送守卫。
 * @note 构造无副作用；守卫保留捕获时的策略、会话和原生代次，每次执行均重新核验。
 */
export function createOutboundPolicy({ getMode, getOwner, getSessionId, sessionPolicy, isAllowed, getNativeState, readRoleState }) {
    /**
     * @param {string} key 会话键。
     * @returns {boolean} 只有closed-agent模式下的精确管理员私聊跳过内容审计。
     */
    function shouldAuditKey(key) {
        if (getMode() === 'closed-agent')
            return !(key === `private:${String(getOwner() ?? '')}`);
        return true;
    }
    /**
     * @param {string} key 会话键。
     * @returns {()=>void} 提交前校验函数。
     * @throws {Error} 当前权限、策略、已绑定会话或原生代次发生变化时拒绝发送。
     */
    function captureSendGuard(key) {
        const policy = sessionPolicy(key), sessionId = getSessionId(key), captured = getNativeState();
        const nativeGeneration = captured.inboundGeneration ?? captured.generation;
        return () => {
            const native = getNativeState();
            if (native.bound && (!native.current || !native.allowSend || nativeGeneration !== native.generation)
                || !isAllowed(key) || policy !== sessionPolicy(key) || (sessionId && getSessionId(key) !== sessionId)) {
                throw new Error('发送已取消：会话、模式或白名单已变化');
            }
        };
    }
    /**
     * @param {string} key 会话键。
     * @returns {boolean} 静默状态下阻止管理员私聊以外的回复。
     * @note 每次读取角色状态；IO错误沿用调用方语义。
     */
    function shouldBlockSilentReply(key) {
        const roleState = readRoleState();
        return roleState.mode === 'silent' && key !== `private:${String(getOwner() ?? '')}`;
    }
    return Object.freeze({ shouldAuditKey, captureSendGuard, shouldBlockSilentReply });
}
