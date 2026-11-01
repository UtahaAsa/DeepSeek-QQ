#pragma once

#ifdef BRIDGE_ADAPTER_BUILD
#define BRIDGE_API extern "C" __declspec(dllexport)
#else
#define BRIDGE_API extern "C" __declspec(dllimport)
#endif

/**
 * 为独立宿主绑定唯一的 V8 isolate；只允许 cold -> active 一次。
 * @param isolate 非空的不透明标识，仅比较地址，绝不解引用。
 * @return 成功绑定返回 true；空指针、重复绑定或已结束返回 false。
 * @note 线程安全，不抛异常；此门控不是 Node 内部 Environment 状态查询。
 */
BRIDGE_API bool BridgeBeginSession(void* isolate) noexcept;

/**
 * 标记绑定宿主即将停止；必须先于宿主的原生服务清理调用。
 * @param isolate 与绑定时相同的不透明标识。
 * @return active/stopping 的同一宿主返回 true，其它情况返回 false。
 * @note 线程安全、幂等、不抛异常；不负责停止任何 QQ 服务或后台线程。
 */
BRIDGE_API bool BridgeRequestStop(void* isolate) noexcept;

/**
 * 关闭已停止的绑定；此后整个进程内不能重新绑定。
 * @param isolate 已请求停止的绑定标识。
 * @return stopping -> finished 成功返回 true，其它情况返回 false。
 * @note 调用方先确认原生服务已结束；线程安全、不抛异常，不卸载 DLL。
 */
BRIDGE_API bool BridgeFinishSession(void* isolate) noexcept;

/**
 * 查询本组件的保守停止门控。
 * @param isolate 要比较的不透明标识，允许为空或未知值。
 * @return 仅 active 且标识匹配时返回 false；其它情况均返回 true。
 * @note 线程安全、不解引用参数、不抛异常；不声称复现 QQ 的内部退出语义。
 */
BRIDGE_API bool BridgeIsEnvironmentStopping(void* isolate) noexcept;

/**
 * 返回脱敏阶段编号：0 cold、1 active、2 stopping、3 finished。
 * @return 当前阶段编号，不暴露任何进程内地址。
 * @note 线程安全、不抛异常；只作诊断，不驱动宿主状态。
 */
BRIDGE_API unsigned int BridgeGetPhase() noexcept;
