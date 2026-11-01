#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <node_api.h>
#include <uv.h>
#include "adapter.h"

namespace {
struct HostData {
    void* isolate;
    bool started;
    bool traceCleanup;
};

bool checked(napi_env env, napi_status status) noexcept {
    if (status == napi_ok) return true;
    napi_throw_error(env, "ERR_NATIVE_CONTROL", "Native control operation failed");
    return false;
}

HostData* hostData(napi_env env, napi_callback_info info) noexcept {
    void* data{nullptr};
    if (!checked(env, napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data))) return nullptr;
    return static_cast<HostData*>(data);
}

napi_value booleanValue(napi_env env, bool value) noexcept {
    napi_value result{nullptr};
    if (!checked(env, napi_get_boolean(env, value, &result))) return nullptr;
    return result;
}

napi_value start(napi_env env, napi_callback_info info) noexcept {
    HostData* data{hostData(env, info)};
    if (data == nullptr) return nullptr;
    const bool accepted{BridgeBeginSession(data->isolate)};
    if (accepted) data->started = true;
    return booleanValue(env, accepted);
}

napi_value stop(napi_env env, napi_callback_info info) noexcept {
    HostData* data{hostData(env, info)};
    if (data == nullptr) return nullptr;
    return booleanValue(env, data->started && BridgeRequestStop(data->isolate));
}

napi_value finish(napi_env env, napi_callback_info info) noexcept {
    HostData* data{hostData(env, info)};
    if (data == nullptr) return nullptr;
    return booleanValue(env, data->started && BridgeFinishSession(data->isolate));
}

napi_value snapshot(napi_env env, napi_callback_info info) noexcept {
    HostData* data{hostData(env, info)};
    if (data == nullptr) return nullptr;
    napi_value result{nullptr};
    napi_value number{nullptr};
    napi_value stopping{nullptr};
    napi_value unknown{nullptr};
    if (!checked(env, napi_create_object(env, &result)) ||
        !checked(env, napi_create_uint32(env, BridgeGetPhase(), &number)) ||
        !checked(env, napi_get_boolean(env, BridgeIsEnvironmentStopping(data->isolate), &stopping)) ||
        !checked(env, napi_get_boolean(env, BridgeIsEnvironmentStopping(nullptr), &unknown)) ||
        !checked(env, napi_set_named_property(env, result, "phase", number)) ||
        !checked(env, napi_set_named_property(env, result, "isStopping", stopping)) ||
        !checked(env, napi_set_named_property(env, result, "unknownIsStopping", unknown))) return nullptr;
    return result;
}

struct HandleCounts {
    unsigned int total;
    unsigned int active;
    unsigned int referenced;
    unsigned int activeReferenced;
    unsigned int closing;
};

void countHandle(uv_handle_t* handle, void* opaque) noexcept {
    auto* counts{static_cast<HandleCounts*>(opaque)};
    const auto type{uv_handle_get_type(handle)};
    const unsigned int index{type >= UV_UNKNOWN_HANDLE && type < UV_HANDLE_TYPE_MAX ? static_cast<unsigned int>(type) : 0};
    const bool active{uv_is_active(handle) != 0};
    const bool referenced{uv_has_ref(handle) != 0};
    ++counts[index].total;
    counts[index].active += active ? 1 : 0;
    counts[index].referenced += referenced ? 1 : 0;
    counts[index].activeReferenced += active && referenced ? 1 : 0;
    counts[index].closing += uv_is_closing(handle) != 0 ? 1 : 0;
}

bool setNumber(napi_env env, napi_value object, const char* name, unsigned int value) noexcept {
    napi_value number{nullptr};
    return checked(env, napi_create_uint32(env, value, &number)) &&
        checked(env, napi_set_named_property(env, object, name, number));
}

/**
 * 同步统计当前 Node 环境的 libuv 句柄类型与存活状态。
 * @param env 当前线程的 Node 环境。
 * @return loopAlive 和按固定 libuv 类型汇总的数量；错误抛 JS 异常。
 * @note 只允许在该环境的 JS 线程调用；不关闭、不取消引用、不输出地址/载荷，
 *       不枚举原生组件自行创建的其它线程事件循环。
 */
napi_value loopInfo(napi_env env, napi_callback_info) noexcept {
    uv_loop_t* loop{nullptr};
    if (!checked(env, napi_get_uv_event_loop(env, &loop)) || loop == nullptr) return nullptr;
    HandleCounts counts[UV_HANDLE_TYPE_MAX]{};
    uv_walk(loop, countHandle, counts);
    napi_value result{nullptr};
    napi_value handles{nullptr};
    napi_value alive{nullptr};
    if (!checked(env, napi_create_object(env, &result)) ||
        !checked(env, napi_create_object(env, &handles)) ||
        !checked(env, napi_get_boolean(env, uv_loop_alive(loop) != 0, &alive))) return nullptr;
    for (unsigned int i{0}; i < UV_HANDLE_TYPE_MAX; ++i) {
        if (counts[i].total == 0) continue;
        napi_value row{nullptr};
        const char* name{uv_handle_type_name(static_cast<uv_handle_type>(i))};
        if (name == nullptr) name = "unknown";
        if (!checked(env, napi_create_object(env, &row)) ||
            !setNumber(env, row, "total", counts[i].total) ||
            !setNumber(env, row, "active", counts[i].active) ||
            !setNumber(env, row, "referenced", counts[i].referenced) ||
            !setNumber(env, row, "activeReferenced", counts[i].activeReferenced) ||
            !setNumber(env, row, "closing", counts[i].closing) ||
            !checked(env, napi_set_named_property(env, handles, name, row))) return nullptr;
    }
    if (!checked(env, napi_set_named_property(env, result, "loopAlive", alive)) ||
        !checked(env, napi_set_named_property(env, result, "handles", handles))) return nullptr;
    return result;
}

// 兜底仅关闭门控，不宣告原生服务已结束；正常路径须先显式 stop/清理/finish。
void cleanup(void* opaque) noexcept {
    HostData* data{static_cast<HostData*>(opaque)};
    bool stopAccepted{false};
    if (data->started) {
        stopAccepted = BridgeRequestStop(data->isolate);
    }
    if (data->traceCleanup) {
        fprintf(stdout, "{\"nativeCleanup\":true,\"stopAccepted\":%s,\"phase\":%u}\n",
            stopAccepted ? "true" : "false", BridgeGetPhase());
        fflush(stdout);
    }
    HeapFree(GetProcessHeap(), 0, data);
}
}

/**
 * 创建独立 Node 宿主的 start、stop、finish、snapshot、loopInfo 方法。
 * @param env Node 提供的环境，只在其所属线程调用 Node-API。
 * @param exports 导出对象；函数结果分别为接受标记或脱敏阶段快照。
 * @return 成功返回 exports；失败抛出 JavaScript 异常并返回空。
 * @note 无自动 QQ 加载；每个环境分别登记清理钩子，底层只允许一个绑定。
 */
NAPI_MODULE_INIT() {
    HMODULE nodeModule{GetModuleHandleW(L"node.exe")};
    using GetCurrent = void* (*)();
    auto getCurrent{reinterpret_cast<GetCurrent>(nodeModule == nullptr ? nullptr :
        GetProcAddress(nodeModule, "?GetCurrent@Isolate@v8@@SAPEAV12@XZ"))};
    void* isolate{getCurrent == nullptr ? nullptr : getCurrent()};
    if (isolate == nullptr) {
        napi_throw_error(env, "ERR_NATIVE_HOST", "Expected pinned Node x64 isolate export");
        return nullptr;
    }
    auto* data{static_cast<HostData*>(HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(HostData)))};
    if (data == nullptr) {
        napi_throw_error(env, "ERR_NATIVE_MEMORY", "Cannot allocate native host control");
        return nullptr;
    }
    data->isolate = isolate;
    wchar_t traceValue[2]{};
    data->traceCleanup = GetEnvironmentVariableW(L"QQ_BRIDGE_NATIVE_TEST_TRACE", traceValue, 2) == 1 && traceValue[0] == L'1';
    if (!checked(env, napi_add_env_cleanup_hook(env, cleanup, data))) {
        HeapFree(GetProcessHeap(), 0, data);
        return nullptr;
    }
    const napi_property_descriptor properties[]{
        {"start", nullptr, start, nullptr, nullptr, nullptr, napi_default, data},
        {"stop", nullptr, stop, nullptr, nullptr, nullptr, napi_default, data},
        {"finish", nullptr, finish, nullptr, nullptr, nullptr, napi_default, data},
        {"snapshot", nullptr, snapshot, nullptr, nullptr, nullptr, napi_default, data},
        {"loopInfo", nullptr, loopInfo, nullptr, nullptr, nullptr, napi_default, data},
    };
    if (!checked(env, napi_define_properties(env, exports, 5, properties))) return nullptr;
    return exports;
}
