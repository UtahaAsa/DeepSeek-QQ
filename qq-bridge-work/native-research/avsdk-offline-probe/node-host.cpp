// 离线候选复用已核对的PPAPI ABI；不装载到现有QQ进程。
#define main avsdkStandaloneProbeMain
#include "probe.cpp"
#undef main
#include <node_api.h>
#include <deque>
#include "ppapi-node-codec.hpp"

namespace nodeAvsdk {
struct MessageMetadata { int32_t command; int32_t type; int32_t correlation; };
static std::mutex messageMutex;
static std::deque<MessageMetadata> messages;
static std::atomic<uint32_t> droppedMessages{};
static uint32_t callbackFailures{};
static bool started{};
static bool closing{};
static HMODULE sdk{};
static const PPP_Instance_1_1* pluginInstance{};
static const PPP_Messaging_1_0* pluginMessaging{};
static bool enumerationSubmitted{};
static void observePrivateSignal(PP_Var value);
static void discardPrivateSignals();

static napi_value boolean(napi_env env, bool value) {
    napi_value result{};
    return napi_get_boolean(env, value, &result) == napi_ok ? result : nullptr;
}
static bool numberProperty(napi_env env, napi_value object, const char* name, double value) {
    napi_value field{};
    return napi_create_double(env, value, &field) == napi_ok
        && napi_set_named_property(env, object, name, field) == napi_ok;
}
static void observeMessage(PP_Instance, PP_Var value) {
    observePrivateSignal(value);
    int32_t command{-1}, correlation{-1};
    const auto found{pepperProbe::findValue(value)};
    if (value.type == PP_VARTYPE_DICTIONARY && found != pepperProbe::stringValues.end()) {
        const auto entry{found->second.dictionary.find("cmd")};
        if (entry != found->second.dictionary.end() && entry->second.type == PP_VARTYPE_INT32)
            command = entry->second.value.as_int;
        const auto id{found->second.dictionary.find("id")};
        if (id != found->second.dictionary.end() && id->second.type == PP_VARTYPE_INT32)
            correlation = id->second.value.as_int;
    }
    std::lock_guard<std::mutex> lock{messageMutex};
    if (messages.size() >= 128) { ++droppedMessages; return; }
    messages.push_back({command, static_cast<int32_t>(value.type), correlation});
}
static bool validThread() { return mainThreadId == GetCurrentThreadId(); }

static bool checkedWord(uintptr_t address, uintptr_t& value, HMODULE owner = nullptr) {
    MEMORY_BASIC_INFORMATION region{};
    if (!address || VirtualQuery(reinterpret_cast<const void*>(address), &region, sizeof(region)) != sizeof(region)
        || region.State != MEM_COMMIT || region.Protect & (PAGE_NOACCESS | PAGE_GUARD)
        || (owner != nullptr && region.AllocationBase != owner)
        || address+sizeof(uintptr_t) > reinterpret_cast<uintptr_t>(region.BaseAddress)+region.RegionSize) return false;
    std::memcpy(&value, reinterpret_cast<const void*>(address), sizeof(value)); return true;
}

/** 根据已核对的本机转发代码，仅投影4个音频后端的函数位置；不调用音频动作。 */
static napi_value liteavOldAudioMetadata(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    const HMODULE module{GetModuleHandleW(L"liteav.dll")}; if (module == nullptr) return boolean(env,false);
    using GetInstance = void* (*)();
    const auto get{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if (get == nullptr) return boolean(env,false);
    const uintptr_t instance{reinterpret_cast<uintptr_t>(get())};
    uintptr_t backend{}, table{};
    if (!checkedWord(instance+sizeof(uintptr_t),backend) || !checkedWord(backend,table)) return boolean(env,false);
    constexpr const struct { int32_t outerSlot; uint32_t offset; } positions[]{
        {151,0x290}, {152,0x298}, {165,0x2f8}, {166,0x300}};
    napi_value result{}; if (napi_create_array_with_length(env,4,&result)!=napi_ok) return nullptr;
    for (uint32_t index{}; index<4; ++index) {
        uintptr_t function{};
        if (!checkedWord(table+positions[index].offset,function,module)) return boolean(env,false);
        MEMORY_BASIC_INFORMATION code{};
        if (VirtualQuery(reinterpret_cast<const void*>(function),&code,sizeof(code))!=sizeof(code)
            || code.AllocationBase!=module || code.State!=MEM_COMMIT
            || !(code.Protect&(PAGE_EXECUTE|PAGE_EXECUTE_READ|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY))) return boolean(env,false);
        napi_value row{};
        if (napi_create_object(env,&row)!=napi_ok || !numberProperty(env,row,"outerSlot",positions[index].outerSlot)
            || !numberProperty(env,row,"backendSlot",positions[index].offset/sizeof(uintptr_t))
            || !numberProperty(env,row,"backendRva",static_cast<double>(function-reinterpret_cast<uintptr_t>(module)))
            || napi_set_element(env,result,index,row)!=napi_ok) return nullptr;
    }
    return result;
}

/** 返回已加载的固定本机 LiteAV 公开版本串；不创建账号或修改音频状态。 */
static napi_value liteavVersion(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    const HMODULE module{GetModuleHandleW(L"liteav.dll")};
    wchar_t file[2048]{};
    constexpr wchar_t expected[]{L"C:\\Program Files\\Tencent\\QQNT\\versions\\9.9.35-52892\\resources\\app\\avsdk\\liteav.dll"};
    if (module == nullptr || GetModuleFileNameW(module, file, 2048) == 0 || _wcsicmp(file, expected)) return boolean(env, false);
    using GetVersion = const char* (*)();
    const auto getVersion{reinterpret_cast<GetVersion>(GetProcAddress(module, "getLiteAvSDKVersion"))};
    if (getVersion == nullptr) return boolean(env, false);
    const char* value{getVersion()};
    if (value == nullptr) return boolean(env, false);
    size_t length{};
    for (; length < 100 && value[length] != '\0'; ++length) {
        const unsigned char letter{static_cast<unsigned char>(value[length])};
        if (!((letter >= '0' && letter <= '9') || (letter >= 'A' && letter <= 'Z')
            || (letter >= 'a' && letter <= 'z') || letter == '.' || letter == '_' || letter == '-' || letter == '+'))
            return boolean(env, false);
    }
    if (length == 0 || length == 100) return boolean(env, false);
    napi_value result{};
    return napi_create_string_utf8(env, value, length, &result) == napi_ok ? result : nullptr;
}

/**
 * 只投影固定 SDK 在本进程创建的公开 ITRTCCloud 虚表代码 RVA。
 * @return 最多192个所属 LiteAV 可执行代码偏移；不调用虚方法、入房或启动设备。
 * @note 只读自身进程；不接受地址/PID，不返回实例指针、账号或任何信令。
 */
static napi_value liteavInterfaceMetadata(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    const HMODULE module{GetModuleHandleW(L"liteav.dll")};
    if (module == nullptr) return boolean(env, false);
    using GetInstance = void* (*)();
    const auto getInstance{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if (getInstance == nullptr) return boolean(env, false);
    const void* instance{getInstance()};
    MEMORY_BASIC_INFORMATION objectRegion{};
    if (instance == nullptr || VirtualQuery(instance, &objectRegion, sizeof(objectRegion)) != sizeof(objectRegion)
        || objectRegion.State != MEM_COMMIT || objectRegion.Protect & (PAGE_NOACCESS | PAGE_GUARD)
        || reinterpret_cast<uintptr_t>(instance)+sizeof(uintptr_t) > reinterpret_cast<uintptr_t>(objectRegion.BaseAddress)+objectRegion.RegionSize)
        return boolean(env, false);
    uintptr_t table{};
    std::memcpy(&table, instance, sizeof(table));
    MEMORY_BASIC_INFORMATION tableRegion{};
    if (VirtualQuery(reinterpret_cast<const void*>(table), &tableRegion, sizeof(tableRegion)) != sizeof(tableRegion)
        || tableRegion.AllocationBase != module || tableRegion.State != MEM_COMMIT
        || tableRegion.Protect & (PAGE_NOACCESS | PAGE_GUARD)) return boolean(env, false);
    napi_value result{};
    if (napi_create_array_with_length(env, 0, &result) != napi_ok) return nullptr;
    for (uint32_t index{}; index < 192; ++index) {
        if (table+(index+1)*sizeof(uintptr_t) > reinterpret_cast<uintptr_t>(tableRegion.BaseAddress)+tableRegion.RegionSize) break;
        uintptr_t function{};
        std::memcpy(&function, reinterpret_cast<const void*>(table+index*sizeof(uintptr_t)), sizeof(function));
        MEMORY_BASIC_INFORMATION code{};
        if (VirtualQuery(reinterpret_cast<const void*>(function), &code, sizeof(code)) != sizeof(code)
            || code.AllocationBase != module || code.State != MEM_COMMIT
            || !(code.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY))) break;
        const uintptr_t rva{function-reinterpret_cast<uintptr_t>(module)};
        napi_value number{};
        if (rva >= 64*1024*1024 || napi_create_double(env, static_cast<double>(rva), &number) != napi_ok
            || napi_set_element(env, result, index, number) != napi_ok) return nullptr;
    }
    return result;
}

/** 仅取本进程固定 LiteAV 导出入口和固定候选槽的前64字节代码用于文件一致性核对。 */
static napi_value liteavCodeMetadata(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    const HMODULE module{GetModuleHandleW(L"liteav.dll")};
    if (module == nullptr) return boolean(env, false);
    using GetInstance = void* (*)();
    const auto getInstance{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if (getInstance == nullptr) return boolean(env, false);
    const void* instance{getInstance()};
    if (instance == nullptr) return boolean(env, false);
    uintptr_t table{};
    std::memcpy(&table, instance, sizeof(table));
    napi_value result{};
    if (napi_create_array_with_length(env, 0, &result) != napi_ok) return nullptr;
    constexpr int32_t slots[]{-1, 0, 1, 16, 64, 153, 154, 167, 168, 173};
    uint32_t index{};
    for (int32_t slot : slots) {
        uintptr_t address{};
        if (slot == -1) address = reinterpret_cast<uintptr_t>(GetProcAddress(module, "getLiteAvSDKVersion"));
        else {
            const uintptr_t location{table+static_cast<uint32_t>(slot)*sizeof(uintptr_t)};
            MEMORY_BASIC_INFORMATION row{};
            if (VirtualQuery(reinterpret_cast<const void*>(location), &row, sizeof(row)) != sizeof(row)
                || row.AllocationBase != module || row.State != MEM_COMMIT
                || location+sizeof(uintptr_t)>reinterpret_cast<uintptr_t>(row.BaseAddress)+row.RegionSize) return boolean(env, false);
            std::memcpy(&address, reinterpret_cast<const void*>(location), sizeof(address));
        }
        MEMORY_BASIC_INFORMATION code{};
        if (!address || VirtualQuery(reinterpret_cast<const void*>(address), &code, sizeof(code)) != sizeof(code)
            || code.AllocationBase != module || code.State != MEM_COMMIT
            || !(code.Protect & (PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY))
            || address+64>reinterpret_cast<uintptr_t>(code.BaseAddress)+code.RegionSize) return boolean(env, false);
        unsigned char bytes[64]{};
        std::memcpy(bytes, reinterpret_cast<const void*>(address), sizeof(bytes));
        constexpr char digits[]{"0123456789abcdef"}; char hex[129]{};
        for (uint32_t at{}; at<64; ++at) { hex[2*at]=digits[bytes[at]>>4]; hex[2*at+1]=digits[bytes[at]&15]; }
        napi_value row{}, prefix{};
        if (napi_create_object(env,&row)!=napi_ok || !numberProperty(env,row,"slot",slot)
            || !numberProperty(env,row,"rva",static_cast<double>(address-reinterpret_cast<uintptr_t>(module)))
            || napi_create_string_utf8(env,hex,128,&prefix)!=napi_ok
            || napi_set_named_property(env,row,"codePrefixHex",prefix)!=napi_ok
            || napi_set_element(env,result,index++,row)!=napi_ok) return nullptr;
    }
    return result;
}

/**
 * 核对由固定本机代码与调试API连续布局定位的171号只读版本查询。
 * @return 仅当函数位置、内存边界与返回串都符合固定12.1版本时返回true。
 * @note 无账号测试入口，不开启采集、不发送媒体、不调用其它候选虚方法。
 */
static napi_value liteavOldVersionQuery(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    const HMODULE module{GetModuleHandleW(L"liteav.dll")};
    if (module == nullptr) return boolean(env, false);
    using GetInstance = void* (*)();
    const auto get{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if (get == nullptr) return boolean(env, false);
    const void* instance{get()}; if (instance == nullptr) return boolean(env,false);
    uintptr_t table{}; std::memcpy(&table,instance,sizeof(table));
    const uintptr_t location{table+171*sizeof(uintptr_t)};
    MEMORY_BASIC_INFORMATION region{};
    if (VirtualQuery(reinterpret_cast<const void*>(location),&region,sizeof(region))!=sizeof(region)
        || region.AllocationBase!=module || region.State!=MEM_COMMIT
        || location+sizeof(uintptr_t)>reinterpret_cast<uintptr_t>(region.BaseAddress)+region.RegionSize) return boolean(env,false);
    uintptr_t function{}; std::memcpy(&function,reinterpret_cast<const void*>(location),sizeof(function));
    if (function-reinterpret_cast<uintptr_t>(module)!=32840) return boolean(env,false);
    using Query = const char* (*)(const void*);
    const char* value{reinterpret_cast<Query>(function)(instance)};
    constexpr char expected[]{"12.1.0.15418"};
    if (value==nullptr || VirtualQuery(value,&region,sizeof(region))!=sizeof(region) || region.State!=MEM_COMMIT
        || region.Protect&(PAGE_NOACCESS|PAGE_GUARD)
        || reinterpret_cast<uintptr_t>(value)+sizeof(expected)>reinterpret_cast<uintptr_t>(region.BaseAddress)+region.RegionSize)
        return boolean(env,false);
    return boolean(env,std::memcmp(value,expected,sizeof(expected))==0);
}

/** 仅在未创建 SDK 实例时验证消息值往返；不提交命令，拒绝无界输入。 */
static napi_value roundTrip(napi_env env, napi_callback_info info) {
    size_t count{1}; napi_value argument{};
    if (started || closing || napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr) != napi_ok || count != 1) {
        napi_throw_error(env, "PPAPI_VALUE_REFUSED", "PPAPI_VALUE_REFUSED"); return nullptr;
    }
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    PP_Var value{PP_MakeUndefined()}; CodecBudget encode, decode; napi_value result{};
    const bool success{fromJs(env, argument, value, encode) && toJs(env, value, result, decode)};
    pepperProbe::release(value);
    if (!success) { napi_throw_error(env, "PPAPI_VALUE_REFUSED", "PPAPI_VALUE_REFUSED"); return nullptr; }
    return result;
}

/** 返回所属编码器引用计数；不包含任何消息内容或原生地址。 */
static napi_value codecCounts(napi_env env, napi_callback_info) {
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    napi_value result{};
    if (napi_create_object(env, &result) != napi_ok
        || !numberProperty(env, result, "liveValues", pepperProbe::stringValues.size())
        || !numberProperty(env, result, "liveBytes", pepperProbe::stringBytes)
        || !numberProperty(env, result, "invalidReferences", pepperProbe::invalidStringReferences)) return nullptr;
    return result;
}

/**
 * 从无账号实例的静态 PP_Var 字符串中投影固定白名单消息字段名。
 * @return 已实际观察到的字段名数组；不返回设备、路径、信令或账号值。
 * @note 仅所属 JS 主线程；不读任意进程地址，不调用插件消息入口。
 */
static napi_value envelopeMetadata(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    constexpr const char* fields[]{"cmd", "seq", "params", "param", "args", "data", "type", "id", "callback", "event", "value", "arguments"};
    napi_value result{};
    if (napi_create_array_with_length(env, 0, &result) != napi_ok) return nullptr;
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    uint32_t index{};
    for (const char* field : fields) {
        bool found{};
        for (const auto& item : pepperProbe::stringValues)
            if (item.second.type == PP_VARTYPE_STRING && item.second.bytes == field) { found = true; break; }
        if (!found) continue;
        napi_value value{};
        if (napi_create_string_utf8(env, field, NAPI_AUTO_LENGTH, &value) != napi_ok
            || napi_set_element(env, result, index++, value) != napi_ok) return nullptr;
    }
    return result;
}

/**
 * 核对固定 SDK 消息入口实际引用的三项静态键，仅限自有无账号模块映像。
 * @return 按调用顺序排列的字段名；遇到未知类型、位置或键名即返回false。
 * @note 不接受地址参数，不读取外部进程，不返回原生地址或实际消息载荷。
 */
static napi_value inputFields(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    constexpr uintptr_t offsets[]{0x23a9de0, 0x23a9dd0, 0x23a9dc0};
    napi_value result{};
    if (napi_create_array_with_length(env, 3, &result) != napi_ok) return nullptr;
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    for (uint32_t index{}; index < 3; ++index) {
        const auto location{reinterpret_cast<const void*>(reinterpret_cast<uintptr_t>(sdk) + offsets[index])};
        MEMORY_BASIC_INFORMATION region{};
        if (VirtualQuery(location, &region, sizeof(region)) != sizeof(region)
            || region.AllocationBase != sdk || region.State != MEM_COMMIT
            || region.Protect & (PAGE_NOACCESS | PAGE_GUARD)
            || reinterpret_cast<uintptr_t>(location) + sizeof(PP_Var) > reinterpret_cast<uintptr_t>(region.BaseAddress) + region.RegionSize)
            return boolean(env, false);
        PP_Var key{};
        std::memcpy(&key, location, sizeof(key));
        const auto found{pepperProbe::findValue(key)};
        if (key.type != PP_VARTYPE_STRING || found == pepperProbe::stringValues.end()) return boolean(env, false);
        const auto& name{found->second.bytes};
        if (name != "cmd" && name != "id" && name != "param" && name != "value") return boolean(env, false);
        napi_value field{};
        if (napi_create_string_utf8(env, name.data(), name.size(), &field) != napi_ok
            || napi_set_element(env, result, index, field) != napi_ok) return nullptr;
    }
    return result;
}

/**
 * 在所属无账号进程提交一次固定的只读麦克风枚举命令64，验证消息封装。
 * @return 仅表示已调用消息入口，实际结果须由后续匹配id的元数据判断。
 * @note 不接受参数、不登录、不打开麦克风、不拨号；拒绝重复调用。
 */
static napi_value enumerateMicrophones(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread() || enumerationSubmitted || pluginMessaging == nullptr)
        return boolean(env, false);
    PP_Var message{pepperProbe::dictionaryCreate()}, params{pepperProbe::arrayCreate()};
    if (message.type != PP_VARTYPE_DICTIONARY || params.type != PP_VARTYPE_ARRAY) {
        pepperProbe::release(message); pepperProbe::release(params); return boolean(env, false);
    }
    bool valid{true};
    const struct { const char* key; PP_Var value; } fields[]{
        {"cmd", PP_MakeInt32(64)}, {"id", PP_MakeInt32(1200001)}, {"param", params}};
    for (const auto& field : fields) {
        PP_Var name{pepperProbe::fromUtf8(field.key, static_cast<uint32_t>(std::strlen(field.key)))};
        valid = pepperProbe::dictionarySet(message, name, field.value) == PP_TRUE && valid;
        pepperProbe::release(name);
    }
    pepperProbe::release(params);
    if (!valid) { pepperProbe::release(message); return boolean(env, false); }
    enumerationSubmitted = true;
    pluginMessaging->HandleMessage(1, message);
    pepperProbe::release(message);
    return boolean(env, true);
}

/**
 * 在专用子进程的JS主线程创建一个无账号PPAPI实例；只能调用一次。
 * @return 布尔创建结果；不发送登录、拨号、音频或其它插件命令。
 * @note SDK固定路径由父启动器核验摘要；失败后的卸载/退出由父进程观察。
 */
static napi_value start(napi_env env, napi_callback_info) {
    if (started || closing || sdk != nullptr) return boolean(env, false);
    mainThreadId = GetCurrentThreadId();
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    constexpr wchar_t pluginPath[]{L"C:\\Program Files\\Tencent\\QQNT\\versions\\9.9.35-52892\\resources\\app\\avsdk\\AVSDKPlugin.dll"};
    sdk = LoadLibraryExW(pluginPath, nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (sdk == nullptr) return boolean(env, false);
    const auto initialize{reinterpret_cast<PluginInitialize>(GetProcAddress(sdk, "PPP_InitializeModule"))};
    const auto query{reinterpret_cast<PluginGetInterface>(GetProcAddress(sdk, "PPP_GetInterface"))};
    if (initialize == nullptr || query == nullptr || initialize(1, browserInterface) != 0) return boolean(env, false);
    pluginInstance = static_cast<const PPP_Instance_1_1*>(query("PPP_Instance;1.1"));
    pluginMessaging = static_cast<const PPP_Messaging_1_0*>(query("PPP_Messaging;1.0"));
    if (pluginInstance == nullptr || pluginMessaging == nullptr) return boolean(env, false);
    pepperProbe::messageObserver = observeMessage;
    started = pluginInstance->DidCreate(1, 0, nullptr, nullptr) == PP_TRUE;
    return boolean(env, started);
}

/**
 * 执行已到期的主线程回调并取出有界消息元数据；不公开载荷、设备或账号。
 * @return callbacks/messages/unsupportedHostCalls等计数及最多128个cmd/type。
 * @note 仅所属JS主线程；每次最多16个回调，不Sleep，不调用任何SDK命令。
 */
static napi_value poll(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    std::vector<ScheduledCallback> ready;
    {
        std::lock_guard<std::mutex> lock{callbackMutex};
        for (auto iterator{callbacks.begin()}; iterator != callbacks.end() && ready.size() < 16;) {
            if (iterator->due <= std::chrono::steady_clock::now()) { ready.push_back(*iterator); iterator = callbacks.erase(iterator); }
            else ++iterator;
        }
    }
    for (const auto& item : ready) {
        try { item.callback.func(item.callback.user_data, item.result); }
        catch (...) { ++callbackFailures; closing = true; break; }
    }
    napi_value result{}, list{};
    std::deque<MessageMetadata> received;
    { std::lock_guard<std::mutex> lock{messageMutex}; received.swap(messages); }
    if (napi_create_object(env, &result) != napi_ok || napi_create_array_with_length(env, received.size(), &list) != napi_ok) return nullptr;
    for (uint32_t index{}; index < received.size(); ++index) {
        napi_value row{};
        if (napi_create_object(env, &row) != napi_ok
            || !numberProperty(env, row, "command", received[index].command)
            || !numberProperty(env, row, "type", received[index].type)
            || !numberProperty(env, row, "correlation", received[index].correlation)
            || napi_set_element(env, list, index, row) != napi_ok) return nullptr;
    }
    if (napi_set_named_property(env, result, "messages", list) != napi_ok
        || !numberProperty(env, result, "callbacks", ready.size())
        || !numberProperty(env, result, "droppedMessages", droppedMessages.load())
        || !numberProperty(env, result, "callbackFailures", callbackFailures)
        || !numberProperty(env, result, "unsupportedHostCalls", unsupportedResources.load())) return nullptr;
    return result;
}

/**
 * 明确请求专用宿主销毁实例；SDK可能直接结束当前子进程。
 * @return 仅在DidDestroy实际返回时返回true；父进程必须另行确认真实退出。
 * @note 仅所属JS主线程、幂等拒绝重复；不得在共享宿主调用。
 */
static napi_value stop(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread()) return boolean(env, false);
    closing = true;
    pepperProbe::messageObserver = nullptr;
    discardPrivateSignals();
    pluginInstance->DidDestroy(1);
    started = false;
    return boolean(env, true);
}
}

#include "liteav-audio-offline.hpp"
#include "liteav-pcm-stream.hpp"
#include "private-signaling.hpp"

NAPI_MODULE_INIT() {
    const struct { const char* name; napi_callback callback; } methods[]{
        {"startOffline", nodeAvsdk::start}, {"pollMetadata", nodeAvsdk::poll},
        {"envelopeMetadataOffline", nodeAvsdk::envelopeMetadata},
        {"inputFieldsOffline", nodeAvsdk::inputFields},
        {"liteavVersionOffline", nodeAvsdk::liteavVersion},
        {"liteavInterfaceMetadataOffline", nodeAvsdk::liteavInterfaceMetadata},
        {"liteavCodeMetadataOffline", nodeAvsdk::liteavCodeMetadata},
        {"liteavOldVersionQueryOffline", nodeAvsdk::liteavOldVersionQuery},
        {"liteavOldAudioMetadataOffline", nodeAvsdk::liteavOldAudioMetadata},
        {"verifyCustomAudioOffline", nodeAvsdk::verifyCustomAudio},
        {"preparePcm",nodeAvsdk::preparePcm},{"writePcm",nodeAvsdk::writePcm},{"readPcm",nodeAvsdk::readPcm},
        {"disarmPcm",nodeAvsdk::disarmPcm},{"pcmMetadata",nodeAvsdk::pcmMetadata},
        {"armPrivateSignals",nodeAvsdk::armPrivateSignals},{"drainPrivateSignals",nodeAvsdk::drainPrivateSignals},
        {"submitPrivateSignal",nodeAvsdk::submitPrivateSignal},
        {"roundTripOffline", nodeAvsdk::roundTrip}, {"codecCountsOffline", nodeAvsdk::codecCounts},
        {"enumerateMicrophonesOffline", nodeAvsdk::enumerateMicrophones}, {"stop", nodeAvsdk::stop}};
    for (const auto& method : methods) {
        napi_value function{};
        if (napi_create_function(env, method.name, NAPI_AUTO_LENGTH, method.callback, nullptr, &function) != napi_ok
            || napi_set_named_property(env, exports, method.name, function) != napi_ok) return nullptr;
    }
    return exports;
}
