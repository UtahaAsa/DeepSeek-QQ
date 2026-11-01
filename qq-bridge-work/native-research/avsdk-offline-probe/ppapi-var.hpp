#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <mutex>
#include <string>
#include <vector>
#include <atomic>
#include "ppapi/c/ppb_var.h"
#include "ppapi/c/ppb_var_array.h"
#include "ppapi/c/ppb_var_array_buffer.h"
#include "ppapi/c/ppb_var_dictionary.h"
#include "ppapi/c/ppb_messaging.h"

namespace pepperProbe {
/**
 * 独立宿主的PPAPI消息值引用实现；不导出字符串、音轨、信令或原生地址。
 * 最多2048个值、每容器256项、字符串/缓冲/键总计8MiB；拒绝循环引用。
 * 返回值按PPAPI持有一个引用；入口使用递归互斥锁，指针在引用有效期间保持稳定。
 */
struct StringValue {
    std::string bytes;
    uint32_t references{1};
    PP_VarType type{PP_VARTYPE_STRING};
    std::vector<PP_Var> array;
    std::map<std::string, PP_Var> dictionary;
    std::vector<uint8_t> buffer;
};
inline std::recursive_mutex stringMutex;
inline std::map<int64_t, StringValue> stringValues;
inline int64_t nextStringId{1};
inline size_t stringBytes{};
inline uint32_t invalidStringReferences{};

inline bool isReference(PP_Var value) { return value.type >= PP_VARTYPE_STRING; }
inline auto findValue(PP_Var value) {
    auto found{stringValues.find(value.value.as_id)};
    return found != stringValues.end() && found->second.type == value.type ? found : stringValues.end();
}
inline bool validValue(PP_Var value) {
    return value.type <= PP_VARTYPE_DOUBLE || findValue(value) != stringValues.end();
}
inline PP_Var createValue(PP_VarType type) {
    if (stringValues.size() >= 2048 || nextStringId >= INT64_MAX) return PP_MakeUndefined();
    PP_Var result{}; result.type = type; result.value.as_id = nextStringId++;
    StringValue item{}; item.type = type; stringValues.emplace(result.value.as_id, std::move(item));
    return result;
}

inline void addRef(PP_Var var) {
    if (!isReference(var)) return;
    std::lock_guard<std::recursive_mutex> lock{stringMutex};
    auto found{findValue(var)};
    if (found == stringValues.end() || found->second.references >= 1000000) { ++invalidStringReferences; return; }
    ++found->second.references;
}
inline void release(PP_Var var) {
    if (!isReference(var)) return;
    std::lock_guard<std::recursive_mutex> lock{stringMutex};
    auto found{findValue(var)};
    if (found == stringValues.end()) { ++invalidStringReferences; return; }
    if (--found->second.references == 0) {
        StringValue previous{std::move(found->second)};
        stringBytes -= previous.bytes.size() + previous.buffer.size();
        for (const auto& pair : previous.dictionary) stringBytes -= pair.first.size();
        stringValues.erase(found);
        for (PP_Var value : previous.array) release(value);
        for (const auto& pair : previous.dictionary) release(pair.second);
    }
}
inline PP_Var fromUtf8(const char* data, uint32_t size) {
    if ((data == nullptr && size != 0) || size > 256 * 1024) return PP_MakeUndefined();
    std::lock_guard<std::recursive_mutex> lock{stringMutex};
    if (stringBytes + size > 8 * 1024 * 1024) return PP_MakeUndefined();
    PP_Var result{createValue(PP_VARTYPE_STRING)};
    if (result.type != PP_VARTYPE_STRING) return result;
    stringValues.at(result.value.as_id).bytes.assign(data != nullptr ? data : "", size);
    stringBytes += size;
    return result;
}
inline const char* toUtf8(PP_Var var, uint32_t* size) {
    if (size == nullptr || var.type != PP_VARTYPE_STRING) return nullptr;
    std::lock_guard<std::recursive_mutex> lock{stringMutex};
    const auto found{findValue(var)};
    if (found == stringValues.end()) return nullptr;
    *size = static_cast<uint32_t>(found->second.bytes.size());
    return found->second.bytes.c_str();
}
inline PP_Resource toResource(PP_Var) { return 0; }
inline PP_Var fromResource(PP_Resource) { return PP_MakeUndefined(); }
inline const PPB_Var_1_2 varInterface{addRef, release, fromUtf8, toUtf8, toResource, fromResource};

inline bool contains(PP_Var value, int64_t target, unsigned depth, unsigned& budget) {
    if (!isReference(value)) return false;
    if (value.value.as_id == target || depth >= 32 || budget-- == 0) return true;
    auto found{findValue(value)}; if (found == stringValues.end()) return true;
    for (PP_Var child : found->second.array) if (contains(child, target, depth + 1, budget)) return true;
    for (const auto& pair : found->second.dictionary) if (contains(pair.second, target, depth + 1, budget)) return true;
    return false;
}
inline PP_Var arrayCreate() { std::lock_guard<std::recursive_mutex> lock{stringMutex}; return createValue(PP_VARTYPE_ARRAY); }
inline PP_Var arrayGet(PP_Var array, uint32_t index) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(array)};
    if (array.type != PP_VARTYPE_ARRAY || found == stringValues.end() || index >= found->second.array.size()) return PP_MakeUndefined();
    PP_Var result{found->second.array[index]}; addRef(result); return result;
}
inline PP_Bool arraySet(PP_Var array, uint32_t index, PP_Var value) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(array)}; unsigned budget{8192};
    if (array.type != PP_VARTYPE_ARRAY || found == stringValues.end() || index >= 256 || !validValue(value)
        || contains(value, array.value.as_id, 0, budget)) return PP_FALSE;
    auto& items{found->second.array}; if (items.size() <= index) items.resize(index + 1, PP_MakeUndefined());
    addRef(value); release(items[index]); items[index] = value; return PP_TRUE;
}
inline uint32_t arrayLength(PP_Var array) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; const auto found{findValue(array)};
    return array.type == PP_VARTYPE_ARRAY && found != stringValues.end() ? static_cast<uint32_t>(found->second.array.size()) : 0;
}
inline PP_Bool arraySetLength(PP_Var array, uint32_t length) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(array)};
    if (array.type != PP_VARTYPE_ARRAY || found == stringValues.end() || length > 256) return PP_FALSE;
    auto& items{found->second.array}; for (size_t index{length}; index < items.size(); ++index) release(items[index]);
    items.resize(length, PP_MakeUndefined()); return PP_TRUE;
}
inline const PPB_VarArray_1_0 arrayInterface{arrayCreate, arrayGet, arraySet, arrayLength, arraySetLength};

inline PP_Var dictionaryCreate() { std::lock_guard<std::recursive_mutex> lock{stringMutex}; return createValue(PP_VARTYPE_DICTIONARY); }
inline PP_Var dictionaryGet(PP_Var dictionary, PP_Var key) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; const auto found{findValue(dictionary)}, name{findValue(key)};
    if (dictionary.type != PP_VARTYPE_DICTIONARY || key.type != PP_VARTYPE_STRING || found == stringValues.end() || name == stringValues.end()) return PP_MakeUndefined();
    auto value{found->second.dictionary.find(name->second.bytes)};
    if (value == found->second.dictionary.end()) return PP_MakeUndefined();
    addRef(value->second); return value->second;
}
inline PP_Bool dictionarySet(PP_Var dictionary, PP_Var key, PP_Var value) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(dictionary)}, name{findValue(key)}; unsigned budget{8192};
    if (dictionary.type != PP_VARTYPE_DICTIONARY || key.type != PP_VARTYPE_STRING || found == stringValues.end() || name == stringValues.end()
        || name->second.bytes.size() > 16384 || !validValue(value) || contains(value, dictionary.value.as_id, 0, budget)) return PP_FALSE;
    auto& items{found->second.dictionary}; const std::string field{name->second.bytes}; auto previous{items.find(field)};
    if (previous == items.end()) {
        if (items.size() >= 256 || stringBytes + field.size() > 8 * 1024 * 1024) return PP_FALSE;
        stringBytes += field.size(); addRef(value); items.emplace(field, value);
    } else { addRef(value); release(previous->second); previous->second = value; }
    return PP_TRUE;
}
inline void dictionaryDelete(PP_Var dictionary, PP_Var key) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(dictionary)}, name{findValue(key)};
    if (dictionary.type != PP_VARTYPE_DICTIONARY || key.type != PP_VARTYPE_STRING || found == stringValues.end() || name == stringValues.end()) return;
    auto value{found->second.dictionary.find(name->second.bytes)};
    if (value != found->second.dictionary.end()) { stringBytes -= value->first.size(); release(value->second); found->second.dictionary.erase(value); }
}
inline PP_Bool dictionaryHas(PP_Var dictionary, PP_Var key) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; auto found{findValue(dictionary)}, name{findValue(key)};
    return dictionary.type == PP_VARTYPE_DICTIONARY && key.type == PP_VARTYPE_STRING && found != stringValues.end() && name != stringValues.end()
        && found->second.dictionary.count(name->second.bytes) ? PP_TRUE : PP_FALSE;
}
inline PP_Var dictionaryKeys(PP_Var dictionary) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; const auto found{findValue(dictionary)};
    if (dictionary.type != PP_VARTYPE_DICTIONARY || found == stringValues.end()) return PP_MakeUndefined();
    PP_Var result{arrayCreate()}; uint32_t index{};
    for (const auto& pair : found->second.dictionary) {
        PP_Var key{fromUtf8(pair.first.data(), static_cast<uint32_t>(pair.first.size()))};
        if (key.type != PP_VARTYPE_STRING || !arraySet(result, index++, key)) { release(key); release(result); return PP_MakeUndefined(); }
        release(key);
    }
    return result;
}
inline const PPB_VarDictionary_1_0 dictionaryInterface{dictionaryCreate, dictionaryGet, dictionarySet, dictionaryDelete, dictionaryHas, dictionaryKeys};

inline PP_Var bufferCreate(uint32_t size) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex};
    if (size > 2 * 1024 * 1024 || stringBytes + size > 8 * 1024 * 1024) return PP_MakeUndefined();
    PP_Var result{createValue(PP_VARTYPE_ARRAY_BUFFER)};
    if (result.type == PP_VARTYPE_ARRAY_BUFFER) { stringValues.at(result.value.as_id).buffer.resize(size); stringBytes += size; }
    return result;
}
inline PP_Bool bufferLength(PP_Var buffer, uint32_t* length) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; const auto found{findValue(buffer)};
    if (buffer.type != PP_VARTYPE_ARRAY_BUFFER || found == stringValues.end() || length == nullptr) return PP_FALSE;
    *length = static_cast<uint32_t>(found->second.buffer.size()); return PP_TRUE;
}
inline void* bufferMap(PP_Var buffer) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; const auto found{findValue(buffer)};
    return buffer.type == PP_VARTYPE_ARRAY_BUFFER && found != stringValues.end() ? found->second.buffer.data() : nullptr;
}
inline void bufferUnmap(PP_Var) {}
inline const PPB_VarArrayBuffer_1_0 bufferInterface{bufferCreate, bufferLength, bufferMap, bufferUnmap};

inline uint32_t pluginMessageCount{};
// 可选的所属宿主回调；在值锁内同步调用，不转移PP_Var所有权。
inline std::atomic<void (*)(PP_Instance, PP_Var)> messageObserver{};
inline void postMessage(PP_Instance instance, PP_Var message) {
    std::lock_guard<std::recursive_mutex> lock{stringMutex}; ++pluginMessageCount;
    int32_t command{-1}; const auto found{findValue(message)};
    if (message.type == PP_VARTYPE_DICTIONARY && found != stringValues.end()) {
        const auto item{found->second.dictionary.find("cmd")};
        if (item != found->second.dictionary.end() && item->second.type == PP_VARTYPE_INT32) command = item->second.value.as_int;
    }
    if (const auto observer{messageObserver.load()}; observer != nullptr) observer(instance, message);
    if (pluginMessageCount <= 16) {
        std::printf("{\"stage\":\"plugin_message_metadata\",\"command\":%d,\"type\":%d}\n", command, static_cast<int>(message.type));
        std::fflush(stdout);
    }
}
inline int32_t registerHandler(PP_Instance, void*, const PPP_MessageHandler_0_2*, PP_Resource) { return -12; }
inline void unregisterHandler(PP_Instance) {}
inline const PPB_Messaging_1_2 messagingInterface{postMessage, registerHandler, unregisterHandler};

inline bool selfTestStrings() {
    const char source[]{'a', '\0', 'b', static_cast<char>(0xe9), static_cast<char>(0xb1), static_cast<char>(0xbc)};
    PP_Var value{fromUtf8(source, sizeof(source))};
    addRef(value); release(value);
    uint32_t size{};
    const char* bytes{toUtf8(value, &size)};
    const bool matched{bytes != nullptr && size == sizeof(source) && std::memcmp(bytes, source, size) == 0};
    release(value);
    PP_Var dictionary{dictionaryCreate()}, array{arrayCreate()}, key{fromUtf8("key", 3)}, bytesVar{bufferCreate(16)};
    const bool nested{dictionarySet(dictionary, key, array) && arraySet(array, 0, bytesVar) && !arraySet(array, 1, dictionary)};
    PP_Var keys{dictionaryKeys(dictionary)}; const bool keyList{arrayLength(keys) == 1};
    release(keys); release(bytesVar); release(array); release(key); release(dictionary);
    return matched && nested && keyList && stringValues.empty() && stringBytes == 0 && invalidStringReferences == 0
        && fromUtf8(nullptr, 1).type == PP_VARTYPE_UNDEFINED;
}
}
