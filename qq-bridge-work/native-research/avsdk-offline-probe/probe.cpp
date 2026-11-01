#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <atomic>
#include <chrono>
#include <mutex>
#include <vector>
#include <type_traits>
#include <cctype>
#include "ppapi/c/ppb_core.h"
#include "ppapi/c/ppb_instance.h"
#include "ppapi/c/ppp_instance.h"
#include "ppapi/c/ppp_messaging.h"

/** Pepper公开插件查询ABI；本探针只查询静态接口，不初始化账号或调用通话动作。 */
using PluginGetInterface = const void* (*)(const char* interfaceName);
using BrowserGetInterface = const void* (*)(const char* interfaceName);
using PluginInitialize = int32_t (*)(int32_t module, BrowserGetInterface browser);
using PluginShutdown = void (*)();

// PPB_Core;1.0布局参照Chromium公开ppapi/c/ppb_core.h；不提供账号、窗口或媒体接口。
using CompletionCallback = PP_CompletionCallback;
using CoreInterface = PPB_Core_1_0;
struct ScheduledCallback {
    std::chrono::steady_clock::time_point due;
    CompletionCallback callback;
    int32_t result;
};
static DWORD mainThreadId{};
static std::atomic<uint32_t> unsupportedResources{};
static std::mutex callbackMutex;
static std::vector<ScheduledCallback> callbacks;

static void resourceUnavailable(int32_t) { ++unsupportedResources; }
static double currentTime() {
    FILETIME value{};
    GetSystemTimeAsFileTime(&value);
    ULARGE_INTEGER ticks{};
    ticks.LowPart = value.dwLowDateTime;
    ticks.HighPart = value.dwHighDateTime;
    return static_cast<double>(ticks.QuadPart) / 10000000.0 - 11644473600.0;
}
static double currentTicks() {
    LARGE_INTEGER value{}, frequency{};
    QueryPerformanceCounter(&value);
    QueryPerformanceFrequency(&frequency);
    return static_cast<double>(value.QuadPart) / static_cast<double>(frequency.QuadPart);
}
static PP_Bool isMainThread() { return GetCurrentThreadId() == mainThreadId ? PP_TRUE : PP_FALSE; }
static void scheduleCallback(int32_t delayMs, CompletionCallback callback, int32_t result) {
    if (callback.func == nullptr || delayMs > 60000) return;
    std::lock_guard<std::mutex> lock{callbackMutex};
    if (callbacks.size() >= 128) return;
    callbacks.push_back({std::chrono::steady_clock::now() + std::chrono::milliseconds{delayMs < 0 ? 0 : delayMs}, callback, result});
}
static const CoreInterface core{resourceUnavailable, resourceUnavailable, currentTime, currentTicks, scheduleCallback, isMainThread};
// 只声明未创建的窗口/图形资源：方法按公开ABI返回失败，不伪造可用设备。
// ABI来源：chromium/chromium 136.0.7065.0 ppapi/c/ppb_{instance,view,graphics_3d}.h。
struct Point { int32_t x; int32_t y; };
struct Size { int32_t width; int32_t height; };
struct Rect { Point point; Size size; };
using InstanceInterface = PPB_Instance_1_0;
struct ViewInterface {
    int32_t (*isView)(int32_t resource);
    int32_t (*getRect)(int32_t resource, Rect* rect);
    int32_t (*isFullscreen)(int32_t resource);
    int32_t (*isVisible)(int32_t resource);
    int32_t (*isPageVisible)(int32_t resource);
    int32_t (*getClipRect)(int32_t resource, Rect* rect);
    float (*getDeviceScale)(int32_t resource);
    float (*getCssScale)(int32_t resource);
    int32_t (*getScrollOffset)(int32_t resource, Point* point);
};
struct GraphicsInterface {
    int32_t (*getAttribMaxValue)(int32_t instance, int32_t attribute, int32_t* value);
    int32_t (*create)(int32_t instance, int32_t share, const int32_t* attributes);
    int32_t (*isGraphics)(int32_t resource);
    int32_t (*getAttribs)(int32_t context, int32_t* attributes);
    int32_t (*setAttribs)(int32_t context, const int32_t* attributes);
    int32_t (*getError)(int32_t context);
    int32_t (*resize)(int32_t context, int32_t width, int32_t height);
    int32_t (*swap)(int32_t context, CompletionCallback callback);
};
static int32_t resourceFalse(int32_t) { ++unsupportedResources; return 0; }
static PP_Bool bindUnavailable(int32_t, int32_t) { ++unsupportedResources; return PP_FALSE; }
// 此宿主的实例是嵌入式实例，非整页插件；这是有效查询结果，不是缺失能力。
static PP_Bool embeddedInstance(int32_t) { return PP_FALSE; }
static int32_t rectUnavailable(int32_t, Rect* rect) { ++unsupportedResources; if (rect != nullptr) *rect = {}; return 0; }
static int32_t pointUnavailable(int32_t, Point* point) { ++unsupportedResources; if (point != nullptr) *point = {}; return 0; }
static float scaleUnavailable(int32_t) { ++unsupportedResources; return 0; }
static int32_t attribUnavailable(int32_t, int32_t, int32_t* value) { ++unsupportedResources; if (value != nullptr) *value = 0; return -5; }
static int32_t graphicsUnavailable(int32_t, int32_t, const int32_t*) { ++unsupportedResources; return 0; }
static int32_t attributesUnavailable(int32_t, int32_t*) { ++unsupportedResources; return -5; }
static int32_t setAttributesUnavailable(int32_t, const int32_t*) { ++unsupportedResources; return -5; }
static int32_t errorUnavailable(int32_t) { ++unsupportedResources; return -5; }
static int32_t resizeUnavailable(int32_t, int32_t, int32_t) { ++unsupportedResources; return -5; }
static int32_t swapUnavailable(int32_t, CompletionCallback) { ++unsupportedResources; return -5; }
static const InstanceInterface instanceInterface{bindUnavailable, embeddedInstance};
static const ViewInterface viewInterface{resourceFalse, rectUnavailable, resourceFalse, resourceFalse, resourceFalse,
    rectUnavailable, scaleUnavailable, scaleUnavailable, pointUnavailable};
static const GraphicsInterface graphicsInterface{attribUnavailable, graphicsUnavailable, resourceFalse, attributesUnavailable,
    setAttributesUnavailable, errorUnavailable, resizeUnavailable, swapUnavailable};
enum class UnavailablePolicy { zero, error, glError };
static void recordUnsupported(uint32_t index);
template<typename Function, UnavailablePolicy policy, uint32_t index> struct UnavailableFunction;
template<typename Result, UnavailablePolicy policy, uint32_t index, typename... Arguments>
struct UnavailableFunction<Result (*)(Arguments...), policy, index> {
    static Result call(Arguments...) {
        recordUnsupported(index);
        if constexpr (!std::is_void_v<Result>) {
            if constexpr (policy == UnavailablePolicy::error) return static_cast<Result>(-12);
            else if constexpr (policy == UnavailablePolicy::glError) return static_cast<Result>(0x0502);
            else return Result{};
        }
    }
};
struct InterfaceEntry { const char* name; const void* table; };
struct FunctionEntry { const char* interfaceName; const char* methodName; };
#include "unsupported-interface-tables.inc"
#include "ppapi-var.hpp"
#include "trace-self.hpp"
static void recordUnsupported(uint32_t index) {
    const uint32_t count{++unsupportedResources};
    if (count <= 24 && index < sizeof(defaultFunctions) / sizeof(defaultFunctions[0])) {
        const auto& item{defaultFunctions[index]};
        std::printf("{\"stage\":\"unsupported_interface_method\",\"interface\":\"%s\",\"method\":\"%s\"}\n", item.interfaceName, item.methodName);
        std::fflush(stdout);
    }
}
static const void* browserInterface(const char* name) {
    if (name == nullptr) return nullptr;
    bool recognized{false};
    const void* table{nullptr};
    for (const auto& entry : defaultInterfaces) if (std::strcmp(name, entry.name) == 0) {
        recognized = true;
        table = entry.table;
        std::printf("{\"stage\":\"browser_interface_requested\",\"interface\":\"%s\",\"provided\":true}\n", entry.name);
        break;
    }
    if (!recognized) {
        bool safeName{std::strncmp(name, "PPB_", 4) == 0 && std::strlen(name) <= 80};
        for (const char* cursor{name}; safeName && *cursor; ++cursor)
            if (!std::isalnum(static_cast<unsigned char>(*cursor)) && std::strchr("_();.", *cursor) == nullptr) safeName = false;
        if (safeName) std::printf("{\"stage\":\"browser_interface_unrecognized\",\"interface\":\"%s\"}\n", name);
        else std::printf("{\"stage\":\"browser_interface_unrecognized\"}\n");
    }
    std::fflush(stdout);
    if (std::strcmp(name, "PPB_Core;1.0") == 0) return &core;
    if (std::strcmp(name, "PPB_Instance;1.0") == 0) return &instanceInterface;
    if (std::strcmp(name, "PPB_View;1.2") == 0) return &viewInterface;
    if (std::strcmp(name, "PPB_Graphics3D;1.0") == 0) return &graphicsInterface;
    if (std::strcmp(name, "PPB_Var;1.2") == 0) return &pepperProbe::varInterface;
    if (std::strcmp(name, "PPB_VarDictionary;1.0") == 0) return &pepperProbe::dictionaryInterface;
    if (std::strcmp(name, "PPB_VarArray;1.0") == 0) return &pepperProbe::arrayInterface;
    if (std::strcmp(name, "PPB_VarArrayBuffer;1.0") == 0) return &pepperProbe::bufferInterface;
    if (std::strcmp(name, "PPB_Messaging;1.2") == 0) return &pepperProbe::messagingInterface;
    return table;
}

static void pumpCallbacks() {
    const auto until{std::chrono::steady_clock::now() + std::chrono::milliseconds{100}};
    while (std::chrono::steady_clock::now() < until) {
        std::vector<ScheduledCallback> ready;
        {
            std::lock_guard<std::mutex> lock{callbackMutex};
            for (auto iterator{callbacks.begin()}; iterator != callbacks.end();) {
                if (iterator->due <= std::chrono::steady_clock::now()) { ready.push_back(*iterator); iterator = callbacks.erase(iterator); }
                else ++iterator;
            }
        }
        for (const auto& item : ready) item.callback.func(item.callback.user_data, item.result);
        Sleep(1);
    }
}

int main(int argc, char** argv) {
    if (argc == 2 && std::strcmp(argv[1], "--trace-initialize-contract") == 0) return probeTrace::traceSelf();
    if (argc == 2 && std::strcmp(argv[1], "--selftest-strings") == 0) {
        const bool passed{pepperProbe::selfTestStrings()};
        std::printf("{\"stage\":\"string_abi_selftest\",\"passed\":%s}\n", passed ? "true" : "false");
        return passed ? 0 : 6;
    }
    const bool instanceContract{argc == 2 && std::strcmp(argv[1], "--instance-contract") == 0};
    const bool processLifetime{instanceContract || (argc == 2 && std::strcmp(argv[1], "--process-lifetime-contract") == 0)};
    if (argc > 2 || (argc == 2 && !processLifetime && std::strcmp(argv[1], "--initialize-contract") != 0)) return 4;
    const bool initialize{argc == 2};
    mainThreadId = GetCurrentThreadId();
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    constexpr wchar_t pluginPath[]{L"C:\\Program Files\\Tencent\\QQNT\\versions\\9.9.35-52892\\resources\\app\\avsdk\\AVSDKPlugin.dll"};
    HMODULE module{LoadLibraryExW(pluginPath, nullptr,
        LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32)};
    if (module == nullptr) {
        std::printf("{\"stage\":\"load_failed\",\"win32Error\":%lu}\n", GetLastError());
        return 2;
    }
    auto getInterface{reinterpret_cast<PluginGetInterface>(GetProcAddress(module, "PPP_GetInterface"))};
    std::printf("{\"stage\":\"loaded\",\"initializeExport\":%s,\"interfaceExport\":%s,\"shutdownExport\":%s}\n",
        GetProcAddress(module, "PPP_InitializeModule") != nullptr ? "true" : "false",
        getInterface != nullptr ? "true" : "false",
        GetProcAddress(module, "PPP_ShutdownModule") != nullptr ? "true" : "false");
    std::fflush(stdout);
    bool initialized{false};
    if (initialize) {
        auto initializeModule{reinterpret_cast<PluginInitialize>(GetProcAddress(module, "PPP_InitializeModule"))};
        if (initializeModule == nullptr) return 5;
        const int32_t result{initializeModule(1, browserInterface)};
        initialized = result == 0;
        std::printf("{\"stage\":\"module_initialization\",\"result\":%d,\"initialized\":%s}\n", result, initialized ? "true" : "false");
        std::fflush(stdout);
        if (initialized) pumpCallbacks();
    }
    if (getInterface != nullptr) {
        const char* const interfaceNames[]{"PPP_Instance;1.1", "PPP_Messaging;1.0"};
        for (const char* name : interfaceNames) {
            const void* result{getInterface(name)};
            std::printf("{\"stage\":\"static_interface_query\",\"interface\":\"%s\",\"available\":%s}\n",
                name, result != nullptr ? "true" : "false");
            std::fflush(stdout);
        }
    }
    if (initialized && getInterface != nullptr) {
        const auto* instance{static_cast<const PPP_Instance_1_1*>(getInterface("PPP_Instance;1.1"))};
        const auto* messaging{static_cast<const PPP_Messaging_1_0*>(getInterface("PPP_Messaging;1.0"))};
        const char* const names[]{"DidCreate", "DidDestroy", "HandleMessage"};
        const uintptr_t addresses[]{instance != nullptr ? reinterpret_cast<uintptr_t>(instance->DidCreate) : 0,
            instance != nullptr ? reinterpret_cast<uintptr_t>(instance->DidDestroy) : 0,
            messaging != nullptr ? reinterpret_cast<uintptr_t>(messaging->HandleMessage) : 0};
        const uintptr_t base{reinterpret_cast<uintptr_t>(module)};
        for (size_t index{0}; index < 3; ++index) if (addresses[index] >= base && addresses[index] - base < 128 * 1024 * 1024)
            std::printf("{\"stage\":\"ppp_entry_rva\",\"method\":\"%s\",\"offset\":%llu}\n", names[index],
                static_cast<unsigned long long>(addresses[index] - base));
        std::fflush(stdout);
    }
    if (initialized && instanceContract) {
        const auto* pluginInstance{static_cast<const PPP_Instance_1_1*>(getInterface("PPP_Instance;1.1"))};
        const bool created{pluginInstance != nullptr && pluginInstance->DidCreate(1, 0, nullptr, nullptr) == PP_TRUE};
        std::printf("{\"stage\":\"plugin_instance_creation\",\"created\":%s}\n", created ? "true" : "false"); std::fflush(stdout);
        if (created) {
            // 仅检查固定SDK的消息入口静态代码已引用的一个函数指针，不扫描账号或其它进程内存。
            const uintptr_t base{reinterpret_cast<uintptr_t>(module)};
            const auto* location{reinterpret_cast<const uintptr_t*>(base + 20484672)};
            MEMORY_BASIC_INFORMATION mapping{};
            if (VirtualQuery(location, &mapping, sizeof(mapping)) == sizeof(mapping) && mapping.State == MEM_COMMIT
                && mapping.AllocationBase == module && !(mapping.Protect & (PAGE_NOACCESS | PAGE_GUARD))) {
                const uintptr_t dispatcher{*location};
                if (dispatcher >= base && dispatcher - base < 128 * 1024 * 1024)
                    std::printf("{\"stage\":\"ppp_entry_rva\",\"method\":\"MessageDispatcher\",\"offset\":%llu}\n",
                        static_cast<unsigned long long>(dispatcher - base));
            }
            // 消息分派器已静态证明低编号命令使用112个16字节函数项；仅投影代码RVA，不调用。
            for (int32_t command{0}; command < 112; ++command) {
                const auto* entry{reinterpret_cast<const uintptr_t*>(base + 0x1389730 + command * 16)};
                if (VirtualQuery(entry, &mapping, sizeof(mapping)) != sizeof(mapping) || mapping.State != MEM_COMMIT
                    || mapping.AllocationBase != module || (mapping.Protect & (PAGE_NOACCESS | PAGE_GUARD))) continue;
                const uintptr_t pointer{*entry};
                MEMORY_BASIC_INFORMATION code{};
                if (pointer < base || pointer - base >= 128 * 1024 * 1024 || VirtualQuery(reinterpret_cast<const void*>(pointer), &code, sizeof(code)) != sizeof(code)
                    || code.AllocationBase != module || !(code.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE))) continue;
                const int32_t adjustment{*reinterpret_cast<const int32_t*>(reinterpret_cast<const char*>(entry) + 8)};
                std::printf("{\"stage\":\"command_entry_rva\",\"command\":%d,\"offset\":%llu,\"thisAdjustment\":%d}\n",
                    command, static_cast<unsigned long long>(pointer - base), adjustment);
            }
            for (int32_t index{0}; index < 44; ++index) {
                const auto* entry{reinterpret_cast<const uintptr_t*>(base + 0x12d0010 + index * 8)};
                if (VirtualQuery(entry, &mapping, sizeof(mapping)) != sizeof(mapping) || mapping.State != MEM_COMMIT
                    || mapping.AllocationBase != module || (mapping.Protect & (PAGE_NOACCESS | PAGE_GUARD))) continue;
                const uintptr_t pointer{*entry}; MEMORY_BASIC_INFORMATION code{};
                if (pointer < base || pointer - base >= 128 * 1024 * 1024 || VirtualQuery(reinterpret_cast<const void*>(pointer), &code, sizeof(code)) != sizeof(code)
                    || code.AllocationBase != module || !(code.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE))) continue;
                std::printf("{\"stage\":\"command_entry_rva\",\"command\":%d,\"offset\":%llu,\"thisAdjustment\":0}\n",
                    100000 + index, static_cast<unsigned long long>(pointer - base));
            }
            std::printf("{\"stage\":\"instance_callback_pump_entered\"}\n"); std::fflush(stdout);
            pumpCallbacks();
            std::printf("{\"stage\":\"instance_callback_pump_returned\",\"unsupportedHostCalls\":%u}\n", unsupportedResources.load()); std::fflush(stdout);
            std::printf("{\"stage\":\"plugin_instance_destroy_entered\"}\n"); std::fflush(stdout);
            pluginInstance->DidDestroy(1);
            std::printf("{\"stage\":\"plugin_instance_destruction\",\"returned\":true}\n"); std::fflush(stdout);
        }
    }
    // 不创建PPP实例、不传账号路径、不发送任何登录、信令、通话或音频命令。
    if (initialized) {
        auto shutdownModule{reinterpret_cast<PluginShutdown>(GetProcAddress(module, "PPP_ShutdownModule"))};
        if (shutdownModule != nullptr) shutdownModule();
        std::printf("{\"stage\":\"module_shutdown\",\"unsupportedResourceCalls\":%u}\n", unsupportedResources.load());
        std::printf("{\"stage\":\"string_lifecycle\",\"remaining\":%zu,\"invalidReferences\":%u}\n",
            pepperProbe::stringValues.size(), pepperProbe::invalidStringReferences);
        std::fflush(stdout);
    }
    // 区分显式FreeLibrary与操作系统随正常进程退出的卸载，绝不捕获/吞掉退出异常。
    if (!processLifetime) FreeLibrary(module);
    else { std::printf("{\"stage\":\"normal_process_exit\",\"dynamicUnloadAttempted\":false}\n"); std::fflush(stdout); }
    return getInterface != nullptr ? 0 : 3;
}
