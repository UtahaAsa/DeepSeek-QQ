#pragma once
#include <algorithm>
#include <array>
#include <cstddef>

namespace nodeAvsdk {
// 来源：腾讯官方 TRTCAudioFrame 定义。仅使用POD布局，不用编译器的C++虚表布局。
struct NativeAudioFrame {
    int32_t audioFormat{};
    char* data{};
    uint32_t length{};
    uint32_t sampleRate{};
    uint32_t channel{};
    uint64_t timestamp{};
    char* extraData{};
    uint32_t extraDataLength{};
};
static_assert(sizeof(NativeAudioFrame)==56 && offsetof(NativeAudioFrame,data)==8
    && offsetof(NativeAudioFrame,length)==16 && offsetof(NativeAudioFrame,sampleRate)==20
    && offsetof(NativeAudioFrame,channel)==24 && offsetof(NativeAudioFrame,timestamp)==32
    && offsetof(NativeAudioFrame,extraData)==40 && offsetof(NativeAudioFrame,extraDataLength)==48);
static bool customAudioVerificationStarted{};

struct FixedAudioMethods {
    void* instance{};
    uintptr_t methods[4]{};
};

// 音频探针和持续帧入口共用同一固定版本/位置检查；不采用最新头文件的虚表索引。
static bool resolveFixedAudio(FixedAudioMethods& bound) {
    const HMODULE module{GetModuleHandleW(L"liteav.dll")}; if(module==nullptr)return false;
    using GetInstance = void* (*)();
    const auto get{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if(get==nullptr)return false;
    void* instance{get()}; uintptr_t table{},backend{},backendTable{};
    if(!checkedWord(reinterpret_cast<uintptr_t>(instance),table)
        ||!checkedWord(reinterpret_cast<uintptr_t>(instance)+8,backend)||!checkedWord(backend,backendTable))return false;
    constexpr const struct {uint32_t slot;uintptr_t rva;uint32_t backendSlot;uintptr_t backendRva;} profile[]{
        {151,28566,82,5889318},{152,28584,83,5890132},{165,25136,95,5891980},{166,25154,96,5892806}};
    uintptr_t methods[4]{};
    for(uint32_t index{};index<4;++index){
        uintptr_t inner{};
        if(!checkedWord(table+profile[index].slot*sizeof(uintptr_t),methods[index],module)
            ||methods[index]-reinterpret_cast<uintptr_t>(module)!=profile[index].rva
            ||!checkedWord(backendTable+profile[index].backendSlot*sizeof(uintptr_t),inner,module)
            ||inner-reinterpret_cast<uintptr_t>(module)!=profile[index].backendRva)return false;
    }
    uintptr_t versionMethod{};
    if(!checkedWord(table+171*sizeof(uintptr_t),versionMethod,module)
        ||versionMethod-reinterpret_cast<uintptr_t>(module)!=32840)return false;
    using Version = const char* (*)(void*);
    const char* version{reinterpret_cast<Version>(versionMethod)(instance)};
    constexpr char expected[]{"12.1.0.15418"};
    MEMORY_BASIC_INFORMATION text{};
    if(version==nullptr||VirtualQuery(version,&text,sizeof(text))!=sizeof(text)||text.State!=MEM_COMMIT
        ||text.Protect&(PAGE_NOACCESS|PAGE_GUARD)
        ||reinterpret_cast<uintptr_t>(version)+sizeof(expected)>reinterpret_cast<uintptr_t>(text.BaseAddress)+text.RegionSize
        ||std::memcmp(version,expected,sizeof(expected)))return false;
    bound.instance=instance;
    std::copy(std::begin(methods),std::end(methods),std::begin(bound.methods));
    return true;
}

/**
 * 在无账号、未入房的所属子进程核对固定12.1 SDK的自定义PCM接口。
 * @return 固定48kHz/单声道/20ms静音帧的提交和内存边界结果；不代表真实收音或通话。
 * @note 不接受外部音频、账号、地址或方法编号；不打开麦克风/系统声音采集，不拨号。
 */
static napi_value verifyCustomAudio(napi_env env, napi_callback_info) {
    if (!started || closing || !validThread() || customAudioVerificationStarted) return boolean(env,false);
    FixedAudioMethods bound{};
    if(!resolveFixedAudio(bound))return boolean(env,false);
    const auto instance{bound.instance};
    const auto& methods{bound.methods};
    customAudioVerificationStarted=true;
    using Toggle = void (*)(void*,bool);
    using Audio = void (*)(void*,NativeAudioFrame*);
    reinterpret_cast<Toggle>(methods[0])(instance,true);
    reinterpret_cast<Toggle>(methods[2])(instance,true);
    constexpr uint32_t samples{960},guardSamples{32};
    constexpr int16_t sentinel{0x4d3a};
    std::array<int16_t,samples+2*guardSamples> input{},output{};
    input.fill(sentinel);output.fill(sentinel);
    std::fill(input.begin()+guardSamples,input.begin()+guardSamples+samples,0);
    std::fill(output.begin()+guardSamples,output.begin()+guardSamples+samples,0);
    NativeAudioFrame sent{};sent.audioFormat=1;sent.data=reinterpret_cast<char*>(input.data()+guardSamples);
    sent.length=samples*sizeof(int16_t);sent.sampleRate=48000;sent.channel=1;sent.timestamp=1;
    NativeAudioFrame received{sent};received.data=reinterpret_cast<char*>(output.data()+guardSamples);
    reinterpret_cast<Audio>(methods[1])(instance,&sent);
    reinterpret_cast<Audio>(methods[3])(instance,&received);
    bool guards{true};
    for(uint32_t index{};index<guardSamples;++index) {
        guards=guards&&input[index]==sentinel&&output[index]==sentinel
            &&input[guardSamples+samples+index]==sentinel&&output[guardSamples+samples+index]==sentinel;
    }
    const bool structure{sent.data==reinterpret_cast<char*>(input.data()+guardSamples)
        &&received.data==reinterpret_cast<char*>(output.data()+guardSamples)
        &&sent.length<=samples*sizeof(int16_t)&&received.length<=samples*sizeof(int16_t)
        &&sent.sampleRate==48000&&received.sampleRate==48000&&sent.channel==1&&received.channel==1};
    napi_value result{},guardValue{},structureValue{};
    if(napi_create_object(env,&result)!=napi_ok||napi_get_boolean(env,guards,&guardValue)!=napi_ok
        ||napi_get_boolean(env,structure,&structureValue)!=napi_ok
        ||napi_set_named_property(env,result,"guardBytesIntact",guardValue)!=napi_ok
        ||napi_set_named_property(env,result,"frameStructureIntact",structureValue)!=napi_ok
        ||!numberProperty(env,result,"sampleRate",48000)||!numberProperty(env,result,"channels",1)
        ||!numberProperty(env,result,"frameMilliseconds",20)||!numberProperty(env,result,"submittedSilenceBytes",samples*sizeof(int16_t))
        ||!numberProperty(env,result,"returnedFrameLength",received.length))return nullptr;
    return result;
}
}
