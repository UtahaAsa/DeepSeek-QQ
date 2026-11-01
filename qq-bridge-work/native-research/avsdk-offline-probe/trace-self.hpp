#pragma once
#include <windows.h>
#include <dbghelp.h>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

namespace probeTrace {
struct Module { DWORD64 base; DWORD size; std::string label; };

inline std::string moduleLabel(HANDLE file) {
    wchar_t buffer[2048]{};
    const DWORD count{GetFinalPathNameByHandleW(file, buffer, 2048, FILE_NAME_NORMALIZED)};
    if (count == 0 || count >= 2048) return "other";
    const wchar_t* tail{wcsrchr(buffer, L'\\')};
    tail = tail != nullptr ? tail + 1 : buffer;
    const wchar_t* const names[]{L"AVSDKPlugin.dll", L"vcruntime140.dll", L"vcruntime140_1.dll", L"msvcp140.dll",
        L"ucrtbase.dll", L"ntdll.dll", L"KERNELBASE.dll", L"kernel32.dll", L"probe.exe", L"msvcrt.dll"};
    const char* const labels[]{"AVSDKPlugin.dll", "vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll",
        "ucrtbase.dll", "ntdll.dll", "KERNELBASE.dll", "kernel32.dll", "probe.exe", "msvcrt.dll"};
    for (size_t index{0}; index < sizeof(names) / sizeof(names[0]); ++index)
        if (_wcsicmp(tail, names[index]) == 0) return labels[index];
    return "other";
}

inline void loadModule(HANDLE process, HANDLE file, DWORD64 base, std::vector<Module>& modules) {
    if (file == nullptr || file == INVALID_HANDLE_VALUE) return;
    IMAGE_DOS_HEADER dos{}; IMAGE_NT_HEADERS64 header{}; DWORD read{};
    LARGE_INTEGER offset{};
    bool valid{SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) && ReadFile(file, &dos, sizeof(dos), &read, nullptr)
        && read == sizeof(dos) && dos.e_magic == IMAGE_DOS_SIGNATURE && dos.e_lfanew > 0 && dos.e_lfanew < 16 * 1024 * 1024};
    offset.QuadPart = dos.e_lfanew;
    valid = valid && SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) && ReadFile(file, &header, sizeof(header), &read, nullptr)
        && read == sizeof(header) && header.Signature == IMAGE_NT_SIGNATURE && header.OptionalHeader.Magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC;
    if (valid) {
        modules.push_back({base, header.OptionalHeader.SizeOfImage, moduleLabel(file)});
        // 仅使用本机映像的展开表；没有符号服务器、PDB下载或转储文件。
        SymLoadModuleExW(process, file, nullptr, nullptr, base, header.OptionalHeader.SizeOfImage, nullptr, 0);
    }
}

inline void printFrame(DWORD64 address, const std::vector<Module>& modules) {
    for (auto iterator{modules.rbegin()}; iterator != modules.rend(); ++iterator) {
        if (address >= iterator->base && address - iterator->base < iterator->size) {
            if (iterator->label == "other") std::printf("{\"stage\":\"exception_frame\",\"module\":\"other\"}\n");
            else std::printf("{\"stage\":\"exception_frame\",\"module\":\"%s\",\"offset\":%llu}\n",
                iterator->label.c_str(), static_cast<unsigned long long>(address - iterator->base));
            return;
        }
    }
    std::printf("{\"stage\":\"exception_frame\",\"module\":\"unknown\"}\n");
}

/**
 * 仅创建并观察当前探针自身的子进程，不接受外部PID/路径，不附加到QQ进程。
 * 返回真实子进程退出码；异常继续交给OS处理，不补丁、不修改寄存器、不屏蔽失败。
 */
inline int traceSelf() {
    wchar_t executable[2048]{};
    const DWORD count{GetModuleFileNameW(nullptr, executable, 2048)};
    if (count == 0 || count >= 2048) return 7;
    std::wstring command{L"\""}; command += executable; command += L"\" --initialize-contract";
    HANDLE inheritedOutput{};
    if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(STD_OUTPUT_HANDLE), GetCurrentProcess(), &inheritedOutput,
        0, TRUE, DUPLICATE_SAME_ACCESS)) return 8;
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE nullHandle{CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, 0, nullptr)};
    STARTUPINFOW startup{}; startup.cb = sizeof(startup); startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = nullHandle; startup.hStdOutput = inheritedOutput; startup.hStdError = nullHandle;
    PROCESS_INFORMATION process{};
    const BOOL created{CreateProcessW(executable, command.data(), nullptr, nullptr, TRUE,
        DEBUG_ONLY_THIS_PROCESS | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, nullptr, &startup, &process)};
    CloseHandle(inheritedOutput); if (nullHandle != INVALID_HANDLE_VALUE) CloseHandle(nullHandle);
    if (!created) return 9;
    SymSetOptions(SYMOPT_DEFERRED_LOADS | SYMOPT_NO_PROMPTS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_IGNORE_CVREC);
    const bool symbols{SymInitializeW(process.hProcess,
        L"D:\\DeepSeek-QQ-Lab\\qq-bridge-work\\native-research\\avsdk-offline-probe\\symbols", FALSE) != FALSE};
    std::vector<Module> modules;
    bool initialBreakpoint{true}, exited{false}; DWORD exitCode{10};
    const ULONGLONG deadline{GetTickCount64() + 20000};
    while (!exited && GetTickCount64() < deadline) {
        DEBUG_EVENT event{};
        if (!WaitForDebugEvent(&event, 200)) continue;
        DWORD disposition{DBG_CONTINUE};
        if (event.dwDebugEventCode == CREATE_PROCESS_DEBUG_EVENT) {
            loadModule(process.hProcess, event.u.CreateProcessInfo.hFile,
                reinterpret_cast<DWORD64>(event.u.CreateProcessInfo.lpBaseOfImage), modules);
            if (event.u.CreateProcessInfo.hFile != nullptr) CloseHandle(event.u.CreateProcessInfo.hFile);
            if (event.u.CreateProcessInfo.hThread != process.hThread) CloseHandle(event.u.CreateProcessInfo.hThread);
            if (event.u.CreateProcessInfo.hProcess != process.hProcess) CloseHandle(event.u.CreateProcessInfo.hProcess);
        } else if (event.dwDebugEventCode == LOAD_DLL_DEBUG_EVENT) {
            loadModule(process.hProcess, event.u.LoadDll.hFile, reinterpret_cast<DWORD64>(event.u.LoadDll.lpBaseOfDll), modules);
            if (event.u.LoadDll.hFile != nullptr) CloseHandle(event.u.LoadDll.hFile);
        } else if (event.dwDebugEventCode == CREATE_THREAD_DEBUG_EVENT) {
            CloseHandle(event.u.CreateThread.hThread);
        } else if (event.dwDebugEventCode == EXCEPTION_DEBUG_EVENT) {
            const auto& exception{event.u.Exception.ExceptionRecord};
            if (initialBreakpoint && exception.ExceptionCode == EXCEPTION_BREAKPOINT) initialBreakpoint = false;
            else {
                disposition = DBG_EXCEPTION_NOT_HANDLED;
                if (!event.u.Exception.dwFirstChance || exception.ExceptionCode == 0xc0000409) {
                    const auto reason{exception.ExceptionCode == 0xc0000409 && exception.NumberParameters > 0
                        ? exception.ExceptionInformation[0] : 0};
                    std::printf("{\"stage\":\"unload_exception\",\"code\":%lu,\"fastFailReason\":%llu}\n",
                        exception.ExceptionCode, static_cast<unsigned long long>(reason));
                    HANDLE thread{OpenThread(THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, FALSE, event.dwThreadId)};
                    CONTEXT context{}; context.ContextFlags = CONTEXT_FULL;
                    if (thread != nullptr && GetThreadContext(thread, &context)) {
                        STACKFRAME64 frame{}; frame.AddrPC = {context.Rip, 0, AddrModeFlat};
                        frame.AddrFrame = {context.Rbp, 0, AddrModeFlat}; frame.AddrStack = {context.Rsp, 0, AddrModeFlat};
                        printFrame(context.Rip, modules);
                        DWORD64 previous{context.Rip};
                        for (int index{0}; symbols && index < 15; ++index) {
                            if (!StackWalk64(IMAGE_FILE_MACHINE_AMD64, process.hProcess, thread, &frame, &context, nullptr,
                                SymFunctionTableAccess64, SymGetModuleBase64, nullptr) || frame.AddrPC.Offset == 0) break;
                            if (frame.AddrPC.Offset != previous) printFrame(frame.AddrPC.Offset, modules);
                            previous = frame.AddrPC.Offset;
                        }
                    }
                    if (thread != nullptr) CloseHandle(thread);
                    std::fflush(stdout);
                }
            }
        } else if (event.dwDebugEventCode == EXIT_PROCESS_DEBUG_EVENT) {
            exited = true; exitCode = event.u.ExitProcess.dwExitCode;
        }
        ContinueDebugEvent(event.dwProcessId, event.dwThreadId, disposition);
    }
    if (!exited) { TerminateProcess(process.hProcess, 11); WaitForSingleObject(process.hProcess, 3000); }
    std::printf("{\"stage\":\"owned_debuggee_exit\",\"confirmed\":%s,\"code\":%lu}\n", exited ? "true" : "false", exitCode);
    if (symbols) SymCleanup(process.hProcess);
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return static_cast<int>(exitCode);
}
}
