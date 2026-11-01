#pragma once
#include <cmath>
#include <limits>
#include <node_api.h>

namespace nodeAvsdk {
/** 所属进程内的有界 Node/PP_Var 编码器；不提交任何 SDK 动作或记录载荷。 */
struct CodecBudget {
    uint32_t nodes{};
    size_t bytes{};
    std::vector<napi_value> ancestors;
    bool enter(size_t count = 0) { bytes += count; return ++nodes <= 1024 && bytes <= 1024 * 1024; }
};

static bool stringFromJs(napi_env env, napi_value input, std::string& result, size_t maximum) {
    size_t length{};
    if (napi_get_value_string_utf8(env, input, nullptr, 0, &length) != napi_ok || length > maximum) return false;
    std::vector<char> buffer(length + 1);
    size_t actual{};
    if (napi_get_value_string_utf8(env, input, buffer.data(), buffer.size(), &actual) != napi_ok || actual != length) return false;
    result.assign(buffer.data(), actual);
    return true;
}

static bool codecKey(const std::string& name) {
    if (name.empty() || name.size() > 64 || name == "__proto__" || name == "constructor" || name == "prototype") return false;
    for (const unsigned char letter : name)
        if (!((letter >= 'A' && letter <= 'Z') || (letter >= 'a' && letter <= 'z')
            || (letter >= '0' && letter <= '9') || letter == '_')) return false;
    return true;
}

/**
 * 将协议值转换为持有一个引用的 PP_Var；调用者始终负责释放 out。
 * @param budget 最多1024节点、1MiB、16层；拒绝循环、非有限数和非协议对象键。
 * @return false 时 out 仍须释放；不保留 JS 引用，不接受 BigInt/函数/符号。
 */
static bool fromJs(napi_env env, napi_value input, PP_Var& out, CodecBudget& budget, unsigned depth = 0) {
    if (depth > 16 || !budget.enter()) return false;
    napi_valuetype type{};
    if (napi_typeof(env, input, &type) != napi_ok) return false;
    if (type == napi_undefined) { out = PP_MakeUndefined(); return true; }
    if (type == napi_null) { out = PP_MakeNull(); return true; }
    if (type == napi_boolean) {
        bool value{};
        if (napi_get_value_bool(env, input, &value) != napi_ok) return false;
        out = PP_MakeBool(value ? PP_TRUE : PP_FALSE); return true;
    }
    if (type == napi_number) {
        double value{};
        if (napi_get_value_double(env, input, &value) != napi_ok || !std::isfinite(value)) return false;
        if (value >= INT32_MIN && value <= INT32_MAX && value == std::trunc(value) && !(value == 0 && std::signbit(value)))
            out = PP_MakeInt32(static_cast<int32_t>(value));
        else out = PP_MakeDouble(value);
        return true;
    }
    if (type == napi_string) {
        std::string value;
        if (!stringFromJs(env, input, value, 256 * 1024) || !budget.enter(value.size())) return false;
        out = pepperProbe::fromUtf8(value.data(), static_cast<uint32_t>(value.size()));
        return out.type == PP_VARTYPE_STRING;
    }
    if (type != napi_object) return false;
    for (napi_value ancestor : budget.ancestors) {
        bool same{};
        if (napi_strict_equals(env, input, ancestor, &same) != napi_ok || same) return false;
    }
    budget.ancestors.push_back(input);
    struct Pop { std::vector<napi_value>& values; ~Pop() { values.pop_back(); } } pop{budget.ancestors};
    bool isBuffer{};
    if (napi_is_buffer(env, input, &isBuffer) != napi_ok) return false;
    if (isBuffer) {
        void* bytes{}; size_t length{};
        if (napi_get_buffer_info(env, input, &bytes, &length) != napi_ok || !budget.enter(length)) return false;
        out = pepperProbe::bufferCreate(static_cast<uint32_t>(length));
        if (out.type != PP_VARTYPE_ARRAY_BUFFER) return false;
        if (length) std::memcpy(pepperProbe::bufferMap(out), bytes, length);
        return true;
    }
    bool isArray{};
    if (napi_is_array(env, input, &isArray) != napi_ok) return false;
    napi_value keys{}; uint32_t length{};
    if (isArray) {
        if (napi_get_array_length(env, input, &length) != napi_ok || length > 256) return false;
        out = pepperProbe::arrayCreate();
    } else {
        if (napi_get_all_property_names(env, input, napi_key_own_only, napi_key_enumerable,
            napi_key_numbers_to_strings, &keys) != napi_ok || napi_get_array_length(env, keys, &length) != napi_ok || length > 256) return false;
        out = pepperProbe::dictionaryCreate();
    }
    if (out.type != (isArray ? PP_VARTYPE_ARRAY : PP_VARTYPE_DICTIONARY)) return false;
    for (uint32_t index{}; index < length; ++index) {
        napi_value value{};
        std::string name;
        if (isArray) {
            if (napi_get_element(env, input, index, &value) != napi_ok) return false;
        } else {
            napi_value key{};
            if (napi_get_element(env, keys, index, &key) != napi_ok || !stringFromJs(env, key, name, 64)
                || !codecKey(name) || !budget.enter(name.size()) || napi_get_named_property(env, input, name.c_str(), &value) != napi_ok) return false;
        }
        PP_Var child{PP_MakeUndefined()};
        if (!fromJs(env, value, child, budget, depth + 1)) { pepperProbe::release(child); return false; }
        bool set{};
        if (isArray) set = pepperProbe::arraySet(out, index, child) == PP_TRUE;
        else {
            PP_Var key{pepperProbe::fromUtf8(name.data(), static_cast<uint32_t>(name.size()))};
            set = pepperProbe::dictionarySet(out, key, child) == PP_TRUE;
            pepperProbe::release(key);
        }
        pepperProbe::release(child);
        if (!set) return false;
    }
    return true;
}

/** 创建不共享原生内存的 JS 协议值；调用期间必须持有 PP_Var 值锁。 */
static bool toJs(napi_env env, PP_Var input, napi_value& result, CodecBudget& budget, unsigned depth = 0) {
    if (depth > 16 || !budget.enter()) return false;
    if (input.type == PP_VARTYPE_UNDEFINED) return napi_get_undefined(env, &result) == napi_ok;
    if (input.type == PP_VARTYPE_NULL) return napi_get_null(env, &result) == napi_ok;
    if (input.type == PP_VARTYPE_BOOL) return napi_get_boolean(env, input.value.as_bool == PP_TRUE, &result) == napi_ok;
    if (input.type == PP_VARTYPE_INT32) return napi_create_double(env, input.value.as_int, &result) == napi_ok;
    if (input.type == PP_VARTYPE_DOUBLE) return std::isfinite(input.value.as_double) && napi_create_double(env, input.value.as_double, &result) == napi_ok;
    const auto found{pepperProbe::findValue(input)};
    if (found == pepperProbe::stringValues.end()) return false;
    const auto& value{found->second};
    if (input.type == PP_VARTYPE_STRING)
        return budget.enter(value.bytes.size()) && napi_create_string_utf8(env, value.bytes.data(), value.bytes.size(), &result) == napi_ok;
    if (input.type == PP_VARTYPE_ARRAY_BUFFER)
        return budget.enter(value.buffer.size()) && napi_create_buffer_copy(env, value.buffer.size(), value.buffer.data(), nullptr, &result) == napi_ok;
    if (input.type == PP_VARTYPE_ARRAY) {
        if (value.array.size() > 256 || napi_create_array_with_length(env, value.array.size(), &result) != napi_ok) return false;
        for (uint32_t index{}; index < value.array.size(); ++index) {
            napi_value child{};
            if (!toJs(env, value.array[index], child, budget, depth+1) || napi_set_element(env, result, index, child) != napi_ok) return false;
        }
        return true;
    }
    if (input.type == PP_VARTYPE_DICTIONARY) {
        if (value.dictionary.size() > 256 || napi_create_object(env, &result) != napi_ok) return false;
        for (const auto& pair : value.dictionary) {
            napi_value child{};
            if (!codecKey(pair.first) || !budget.enter(pair.first.size()) || !toJs(env, pair.second, child, budget, depth+1)
                || napi_set_named_property(env, result, pair.first.c_str(), child) != napi_ok) return false;
        }
        return true;
    }
    return false;
}
}
