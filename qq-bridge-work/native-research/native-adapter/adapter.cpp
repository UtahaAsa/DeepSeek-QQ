#define WIN32_LEAN_AND_MEAN
#define BRIDGE_ADAPTER_BUILD
#include <windows.h>
#include "adapter.h"

namespace {
SRWLOCK stateLock{};
void* boundIsolate{nullptr};
unsigned int phase{0};
}

bool BridgeBeginSession(void* isolate) noexcept {
    AcquireSRWLockExclusive(&stateLock);
    const bool accepted{isolate != nullptr && phase == 0};
    if (accepted) {
        boundIsolate = isolate;
        phase = 1;
    }
    ReleaseSRWLockExclusive(&stateLock);
    return accepted;
}

bool BridgeRequestStop(void* isolate) noexcept {
    AcquireSRWLockExclusive(&stateLock);
    const bool accepted{isolate != nullptr && isolate == boundIsolate && (phase == 1 || phase == 2)};
    if (accepted) phase = 2;
    ReleaseSRWLockExclusive(&stateLock);
    return accepted;
}

bool BridgeFinishSession(void* isolate) noexcept {
    AcquireSRWLockExclusive(&stateLock);
    const bool accepted{isolate != nullptr && isolate == boundIsolate && phase == 2};
    if (accepted) {
        phase = 3;
        boundIsolate = nullptr;
    }
    ReleaseSRWLockExclusive(&stateLock);
    return accepted;
}

bool BridgeIsEnvironmentStopping(void* isolate) noexcept {
    AcquireSRWLockShared(&stateLock);
    const bool stopping{isolate == nullptr || isolate != boundIsolate || phase != 1};
    ReleaseSRWLockShared(&stateLock);
    return stopping;
}

unsigned int BridgeGetPhase() noexcept {
    AcquireSRWLockShared(&stateLock);
    const unsigned int result{phase};
    ReleaseSRWLockShared(&stateLock);
    return result;
}
