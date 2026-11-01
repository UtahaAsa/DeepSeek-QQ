#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0602
#endif
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <node_api.h>
#include <string.h>
#include <stdio.h>

namespace {
constexpr DWORD requestLimit{512}, responseLimit{4096}, ioTimeout{3000};
struct Broker {
    napi_env env{};
    Broker* next{};
    HANDLE pipe{INVALID_HANDLE_VALUE}, stop{}, thread{};
    CRITICAL_SECTION responseLock{};
    BYTE logonSid[SECURITY_MAX_SID_SIZE]{};
    char request[requestLimit + 1]{}, response[responseLimit + 1]{};
    DWORD requestSize{}, responseSize{};
    volatile LONG running{}, served{}, rejected{};
    bool aclVerified{}, restrictedTokenDenied{}, cleaning{}, closed{};
};
SRWLOCK listLock{};
Broker* brokers{};
napi_value fail(napi_env env) { napi_throw_error(env, "SECURE_PIPE_FAILED", "SECURE_PIPE_FAILED"); return nullptr; }
napi_value boolean(napi_env env, bool value) { napi_value result{}; napi_get_boolean(env, value, &result); return result; }
bool stringArg(napi_env env, napi_value value, char* output, size_t capacity, size_t* length = nullptr) {
    size_t size{};
    if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || !size || size >= capacity) return false;
    size_t copied{};
    if (napi_get_value_string_utf8(env, value, output, capacity, &copied) != napi_ok || copied != size || strlen(output) != size) return false;
    if (length) *length = size;
    return true;
}
bool pipePath(const char* input, wchar_t* output, size_t capacity) {
    constexpr char prefix[]{"\\\\.\\pipe\\qq-native-gateway-"};
    if (strlen(input) != strlen(prefix) + 36 || strncmp(input, prefix, strlen(prefix))) return false;
    for (size_t i{strlen(prefix)}; input[i]; ++i) if (!((input[i] >= 'a' && input[i] <= 'f') ||
        (input[i] >= '0' && input[i] <= '9') || input[i] == '-')) return false;
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, input, -1, output, static_cast<int>(capacity)) > 0;
}
bool logonSid(HANDLE token, BYTE* output) {
    DWORD size{}; GetTokenInformation(token, TokenGroups, nullptr, 0, &size);
    if (!size || size > 65536) return false;
    auto* groups{static_cast<TOKEN_GROUPS*>(HeapAlloc(GetProcessHeap(), 0, size))};
    if (!groups) return false;
    bool found{false};
    if (GetTokenInformation(token, TokenGroups, groups, size, &size)) {
        for (DWORD i{}; i < groups->GroupCount; ++i) {
            if ((groups->Groups[i].Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) {
                found = CopySid(SECURITY_MAX_SID_SIZE, output, groups->Groups[i].Sid) != FALSE; break;
            }
        }
    }
    HeapFree(GetProcessHeap(), 0, groups); return found;
}
bool currentLogon(BYTE* output) {
    HANDLE token{};
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
    const bool result{logonSid(token, output)}; CloseHandle(token); return result;
}
bool peerLogon(ULONG pid, BYTE* expected) {
    HANDLE process{OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid)}, token{};
    if (!process) return false;
    BYTE actual[SECURITY_MAX_SID_SIZE]{};
    const bool result{OpenProcessToken(process, TOKEN_QUERY, &token) && logonSid(token, actual) && EqualSid(expected, actual)};
    if (token) CloseHandle(token); CloseHandle(process); return result;
}
bool verifyAcl(HANDLE pipe, BYTE* expected) {
    PSECURITY_DESCRIPTOR descriptor{}; PACL acl{};
    if (GetSecurityInfo(pipe, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &acl, nullptr, &descriptor) != ERROR_SUCCESS) return false;
    SECURITY_DESCRIPTOR_CONTROL control{}; DWORD revision{}; void* opaque{};
    bool valid{GetSecurityDescriptorControl(descriptor, &control, &revision) && (control & SE_DACL_PROTECTED) &&
        acl && acl->AceCount == 1 && GetAce(acl, 0, &opaque)};
    if (valid) {
        auto* ace{static_cast<ACCESS_ALLOWED_ACE*>(opaque)};
        valid = ace->Header.AceType == ACCESS_ALLOWED_ACE_TYPE && ace->Header.AceFlags == 0 &&
            EqualSid(expected, &ace->SidStart) && ((ace->Mask & GENERIC_ALL) || (ace->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS);
    }
    LocalFree(descriptor); return valid;
}
bool restrictedAccessDenied(HANDLE pipe) {
    HANDLE original{}, restricted{}, impersonation{}; PSECURITY_DESCRIPTOR descriptor{};
    BYTE sid[SECURITY_MAX_SID_SIZE]{}; DWORD sidSize{sizeof(sid)};
    bool denied{false};
    if (GetSecurityInfo(pipe, SE_KERNEL_OBJECT, OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        nullptr, nullptr, nullptr, nullptr, &descriptor) == ERROR_SUCCESS &&
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE, &original) &&
        CreateWellKnownSid(WinBuiltinGuestsSid, nullptr, sid, &sidSize)) {
        SID_AND_ATTRIBUTES restriction{sid, 0};
        if (CreateRestrictedToken(original, DISABLE_MAX_PRIVILEGE, 0, nullptr, 0, nullptr, 1, &restriction, &restricted) &&
            DuplicateToken(restricted, SecurityIdentification, &impersonation)) {
            GENERIC_MAPPING mapping{FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_GENERIC_EXECUTE, FILE_ALL_ACCESS};
            DWORD desired{GENERIC_READ | GENERIC_WRITE}, granted{}, privilegeSize{1024}; BOOL allowed{FALSE};
            alignas(PRIVILEGE_SET) BYTE privileges[1024]{};
            MapGenericMask(&desired, &mapping);
            denied = AccessCheck(descriptor, impersonation, desired, &mapping,
                reinterpret_cast<PRIVILEGE_SET*>(privileges), &privilegeSize, &granted, &allowed) && !allowed;
        }
    }
    if (impersonation) CloseHandle(impersonation); if (restricted) CloseHandle(restricted);
    if (original) CloseHandle(original); if (descriptor) LocalFree(descriptor);
    return denied;
}
bool waitIo(HANDLE pipe, HANDLE stop, OVERLAPPED& operation, ULONGLONG deadline, DWORD& transferred) {
    const ULONGLONG now{GetTickCount64()};
    HANDLE handles[]{stop, operation.hEvent};
    const DWORD wait{now >= deadline ? WAIT_TIMEOUT : WaitForMultipleObjects(2, handles, FALSE, static_cast<DWORD>(deadline - now))};
    bool ok{wait == WAIT_OBJECT_0 + 1 && GetOverlappedResult(pipe, &operation, &transferred, FALSE)};
    if (!ok) {
        CancelIoEx(pipe, &operation);
        GetOverlappedResult(pipe, &operation, &transferred, TRUE); // 回收完成后才释放OVERLAPPED。
    }
    return ok;
}
bool transfer(HANDLE pipe, HANDLE stop, void* buffer, DWORD size, bool write, ULONGLONG deadline, DWORD& transferred) {
    OVERLAPPED operation{}; operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (!operation.hEvent) return false;
    const BOOL immediate{write ? WriteFile(pipe, buffer, size, &transferred, &operation) : ReadFile(pipe, buffer, size, &transferred, &operation)};
    const bool result{immediate || (GetLastError() == ERROR_IO_PENDING && waitIo(pipe, stop, operation, deadline, transferred))};
    CloseHandle(operation.hEvent); return result && transferred > 0;
}
bool readLine(HANDLE pipe, HANDLE stop, char* buffer, DWORD limit, DWORD& size, ULONGLONG deadline) {
    size = 0;
    while (size < limit && WaitForSingleObject(stop, 0) == WAIT_TIMEOUT) {
        DWORD count{};
        if (!transfer(pipe, stop, buffer + size, limit - size, false, deadline, count)) return false;
        size += count;
        for (DWORD i{}; i < size; ++i) if (buffer[i] == '\n') return i == size - 1;
    }
    return false;
}
DWORD WINAPI serve(void* opaque) {
    auto* broker{static_cast<Broker*>(opaque)};
    while (WaitForSingleObject(broker->stop, 0) == WAIT_TIMEOUT) {
        OVERLAPPED operation{}; operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!operation.hEvent) break;
        DWORD ignored{};
        const BOOL connected{ConnectNamedPipe(broker->pipe, &operation)};
        const DWORD error{connected ? ERROR_SUCCESS : GetLastError()};
        const bool accepted{connected || error == ERROR_PIPE_CONNECTED ||
            (error == ERROR_IO_PENDING && waitIo(broker->pipe, broker->stop, operation, GetTickCount64() + ioTimeout, ignored))};
        CloseHandle(operation.hEvent);
        if (!accepted) { DisconnectNamedPipe(broker->pipe); continue; }
        ULONG client{};
        char request[requestLimit + 1]{}, response[responseLimit + 1]{}; DWORD size{}, responseSize{};
        const ULONGLONG deadline{GetTickCount64() + ioTimeout};
        const bool authorized{GetNamedPipeClientProcessId(broker->pipe, &client) && peerLogon(client, broker->logonSid) &&
            readLine(broker->pipe, broker->stop, request, requestLimit, size, deadline) &&
            size == broker->requestSize && memcmp(request, broker->request, size) == 0};
        if (authorized) {
            EnterCriticalSection(&broker->responseLock);
            responseSize = broker->responseSize; memcpy(response, broker->response, responseSize);
            LeaveCriticalSection(&broker->responseLock);
        } else {
            constexpr char denied[]{"{\"ok\":false}\n"}; responseSize = sizeof(denied) - 1; memcpy(response, denied, responseSize);
            InterlockedIncrement(&broker->rejected);
        }
        DWORD sent{};
        const bool written{transfer(broker->pipe, broker->stop, response, responseSize, true, deadline, sent) && sent == responseSize};
        if (written) {
            if (authorized) InterlockedIncrement(&broker->served);
            // WriteFile完成只说明已写入管道缓冲区，立即断开会丢弃客户端尚未读取的数据。
            // 合法的一次性客户端读完即关闭；用既有可取消I/O等待对端结束，沿用本事务绝对时限。
            // 不使用可能无限阻塞的FlushFileBuffers，不接受第二个请求，也不扩大ACL或身份范围。
            char completion{}; DWORD completionBytes{};
            transfer(broker->pipe, broker->stop, &completion, sizeof(completion), false, deadline, completionBytes);
        }
        SecureZeroMemory(response, sizeof(response));
        DisconnectNamedPipe(broker->pipe);
    }
    InterlockedExchange(&broker->running, 0); return 0;
}
bool closeBroker(Broker* broker) {
    if (broker->closed) return true;
    if (broker->stop) SetEvent(broker->stop);
    if (broker->thread && WaitForSingleObject(broker->thread, ioTimeout + 1000) != WAIT_OBJECT_0) return false;
    if (broker->thread) CloseHandle(broker->thread);
    if (broker->pipe != INVALID_HANDLE_VALUE) CloseHandle(broker->pipe);
    if (broker->stop) CloseHandle(broker->stop);
    broker->closed = true;
    SecureZeroMemory(broker->response, sizeof(broker->response)); return true;
}
void cleanup(void* opaque) { auto* broker{static_cast<Broker*>(opaque)}; broker->cleaning = true; closeBroker(broker); }
void finalize(napi_env env, void* opaque, void*) {
    auto* broker{static_cast<Broker*>(opaque)};
    if (!broker->cleaning) napi_remove_env_cleanup_hook(env, cleanup, broker);
    if (!closeBroker(broker)) return; // 不释放仍被线程引用的内存；进程退出由OS回收。
    AcquireSRWLockExclusive(&listLock);
    Broker** cursor{&brokers}; while (*cursor && *cursor != broker) cursor = &(*cursor)->next;
    if (*cursor) *cursor = broker->next;
    ReleaseSRWLockExclusive(&listLock);
    DeleteCriticalSection(&broker->responseLock); HeapFree(GetProcessHeap(), 0, broker);
}
Broker* context(napi_env env, napi_value value) {
    void* pointer{}; if (napi_get_value_external(env, value, &pointer) != napi_ok) return nullptr;
    AcquireSRWLockShared(&listLock);
    Broker* found{}; for (auto* row{brokers}; row; row = row->next) if (row == pointer && row->env == env) { found = row; break; }
    ReleaseSRWLockShared(&listLock); return found;
}

/** 创建受保护的本机登录会话管道；不加载QQ，失败不返回句柄或系统详情。 */
napi_value create(napi_env env, napi_callback_info info) {
    napi_value args[3]{}; size_t argc{3}; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    char path[128]{}; wchar_t widePath[128]{};
    if (argc != 3 || !stringArg(env, args[0], path, sizeof(path)) || !pipePath(path, widePath, 128)) return fail(env);
    auto* broker{static_cast<Broker*>(HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(Broker)))};
    if (!broker) return fail(env);
    broker->pipe = INVALID_HANDLE_VALUE; broker->env = env; InitializeCriticalSection(&broker->responseLock);
    size_t requestSize{}, responseSize{};
    LPWSTR sidText{}; PSECURITY_DESCRIPTOR descriptor{};
    bool ok{stringArg(env, args[1], broker->request, sizeof(broker->request), &requestSize) &&
        stringArg(env, args[2], broker->response, sizeof(broker->response), &responseSize) &&
        broker->request[requestSize - 1] == '\n' && broker->response[responseSize - 1] == '\n' &&
        currentLogon(broker->logonSid) && ConvertSidToStringSidW(broker->logonSid, &sidText)};
    if (ok) {
        wchar_t sddl[256]{};
        _snwprintf_s(sddl, 256, _TRUNCATE, L"D:P(A;;GA;;;%ls)", sidText);
        ok = ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, SDDL_REVISION_1, &descriptor, nullptr) != FALSE;
    }
    if (ok) {
        SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), descriptor, FALSE};
        broker->pipe = CreateNamedPipeW(widePath, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, responseLimit, requestLimit, ioTimeout, &attributes);
        ok = broker->pipe != INVALID_HANDLE_VALUE && (broker->aclVerified = verifyAcl(broker->pipe, broker->logonSid));
        if (ok) ok = broker->restrictedTokenDenied = restrictedAccessDenied(broker->pipe);
    }
    if (descriptor) LocalFree(descriptor); if (sidText) LocalFree(sidText);
    if (ok) {
        broker->requestSize = static_cast<DWORD>(requestSize); broker->responseSize = static_cast<DWORD>(responseSize);
        broker->stop = CreateEventW(nullptr, TRUE, FALSE, nullptr); ok = broker->stop != nullptr;
    }
    if (ok) {
        broker->running = 1; broker->thread = CreateThread(nullptr, 0, serve, broker, 0, nullptr); ok = broker->thread != nullptr;
    }
    if (!ok) { closeBroker(broker); DeleteCriticalSection(&broker->responseLock); HeapFree(GetProcessHeap(), 0, broker); return fail(env); }
    AcquireSRWLockExclusive(&listLock); broker->next = brokers; brokers = broker; ReleaseSRWLockExclusive(&listLock);
    napi_value result{};
    if (napi_add_env_cleanup_hook(env, cleanup, broker) != napi_ok) { broker->cleaning = true; finalize(env, broker, nullptr); return fail(env); }
    if (napi_create_external(env, broker, finalize, nullptr, &result) != napi_ok) { finalize(env, broker, nullptr); return fail(env); }
    return result;
}
napi_value update(napi_env env, napi_callback_info info) {
    napi_value args[2]{}; size_t argc{2}; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    Broker* broker{argc == 2 ? context(env, args[0]) : nullptr}; char response[responseLimit + 1]{}; size_t size{};
    if (!broker || broker->closed || !broker->running || !stringArg(env, args[1], response, sizeof(response), &size) || response[size - 1] != '\n') return fail(env);
    EnterCriticalSection(&broker->responseLock);
    SecureZeroMemory(broker->response, sizeof(broker->response)); memcpy(broker->response, response, size); broker->responseSize = static_cast<DWORD>(size);
    LeaveCriticalSection(&broker->responseLock); SecureZeroMemory(response, sizeof(response)); return boolean(env, true);
}
napi_value close(napi_env env, napi_callback_info info) {
    napi_value arg{}; size_t argc{1}; napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
    Broker* broker{argc == 1 ? context(env, arg) : nullptr}; return broker ? boolean(env, closeBroker(broker)) : fail(env);
}
napi_value snapshot(napi_env env, napi_callback_info info) {
    napi_value arg{}, result{}; size_t argc{1}; napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
    Broker* broker{argc == 1 ? context(env, arg) : nullptr}; if (!broker) return fail(env);
    if (!broker->closed) broker->aclVerified = verifyAcl(broker->pipe, broker->logonSid);
    napi_create_object(env, &result);
    const char* fields[]{"running", "aclVerified", "remoteRejectConfigured", "restrictedTokenDenied"};
    for (const auto* field : fields) {
        const bool value{strcmp(field, "running") == 0 ? broker->running != 0 : strcmp(field, "aclVerified") == 0 ? broker->aclVerified :
            strcmp(field, "restrictedTokenDenied") == 0 ? broker->restrictedTokenDenied : true};
        napi_set_named_property(env, result, field, boolean(env, value));
    }
    return result;
}

/** 有界读取；在发送请求前核对OS报告的服务端PID及登录会话，不提升权限。 */
napi_value read(napi_env env, napi_callback_info info) {
    napi_value args[3]{}; size_t argc{3}; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    char path[128]{}, request[requestLimit + 1]{}, response[responseLimit + 1]{}; wchar_t widePath[128]{};
    uint32_t expected{}; size_t requestSize{};
    if (argc != 3 || !stringArg(env, args[0], path, sizeof(path)) || !pipePath(path, widePath, 128) ||
        napi_get_value_uint32(env, args[1], &expected) != napi_ok || !expected ||
        !stringArg(env, args[2], request, sizeof(request), &requestSize) || request[requestSize - 1] != '\n') return fail(env);
    const ULONGLONG deadline{GetTickCount64() + ioTimeout};
    HANDLE pipe{INVALID_HANDLE_VALUE};
    do {
        pipe = CreateFileW(widePath, GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr);
        if (pipe != INVALID_HANDLE_VALUE || GetLastError() != ERROR_PIPE_BUSY) break;
        const ULONGLONG now{GetTickCount64()};
        if (now >= deadline || !WaitNamedPipeW(widePath, static_cast<DWORD>(deadline - now))) break;
    } while (GetTickCount64() < deadline);
    if (pipe == INVALID_HANDLE_VALUE) return fail(env);
    BYTE sid[SECURITY_MAX_SID_SIZE]{}; ULONG actual{};
    bool ok{GetNamedPipeServerProcessId(pipe, &actual) && actual == expected && currentLogon(sid) && peerLogon(actual, sid)};
    HANDLE stop{CreateEventW(nullptr, TRUE, FALSE, nullptr)}; DWORD sent{}, size{};
    ok = ok && stop && transfer(pipe, stop, request, static_cast<DWORD>(requestSize), true, deadline, sent) && sent == requestSize &&
        readLine(pipe, stop, response, responseLimit, size, deadline);
    CloseHandle(pipe); if (stop) CloseHandle(stop);
    napi_value result{};
    if (ok) ok = napi_create_string_utf8(env, response, size, &result) == napi_ok;
    SecureZeroMemory(response, sizeof(response)); return ok ? result : fail(env);
}
} // namespace

NAPI_MODULE_INIT() {
    napi_property_descriptor properties[]{
        {"create", nullptr, create, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"update", nullptr, update, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"close", nullptr, close, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"snapshot", nullptr, snapshot, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"read", nullptr, read, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    if (napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties) != napi_ok) return fail(env);
    return exports;
}
