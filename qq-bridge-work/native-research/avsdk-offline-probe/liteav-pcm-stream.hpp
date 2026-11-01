#pragma once

namespace nodeAvsdk {
constexpr size_t pcmFrameBytes{1920};
static FixedAudioMethods pcmBinding{};
static bool pcmPrepared{};
static uint64_t pcmWritten{},pcmRead{};

static napi_value pcmRefused(napi_env env,const char* code) {
    napi_throw_error(env,code,code);return nullptr;
}
static bool activePcm() {
    if(!started||closing||!validThread()||!pcmPrepared)return false;
    const HMODULE module{GetModuleHandleW(L"liteav.dll")};
    if(module==nullptr)return false;
    using GetInstance=void* (*)();
    const auto get{reinterpret_cast<GetInstance>(GetProcAddress(module,
        "?getTRTCShareInstance@ITRTCCloud@liteav@@SAPEAV12@XZ"))};
    if(get==nullptr||get()!=pcmBinding.instance){pcmPrepared=false;return false;}
    return true;
}

/**
 * 在入房前准备固定格式自定义音频；只启用自定义输入/输出，不启动系统声音采集。
 * @return true只表示固定版本检查与两项模式调用已返回，不表示SDK登录或通话已接通。
 * @note 仅所属JS主线程；相同实例幂等；不接受账号、设备、文件路径或方法编号。
 */
static napi_value preparePcm(napi_env env,napi_callback_info) {
    if(!started||closing||!validThread())return pcmRefused(env,"AVSDK_PCM_UNAVAILABLE");
    FixedAudioMethods next{};
    if(!resolveFixedAudio(next))return pcmRefused(env,"AVSDK_PCM_ABI_CHANGED");
    if(pcmPrepared&&pcmBinding.instance==next.instance)return boolean(env,true);
    using Toggle=void (*)(void*,bool);
    reinterpret_cast<Toggle>(next.methods[0])(next.instance,true);
    reinterpret_cast<Toggle>(next.methods[2])(next.instance,true);
    pcmBinding=next;pcmPrepared=true;return boolean(env,true);
}

/**
 * 提交一帧48kHz/单声道/PCM16的20ms数据，严格限定为1920字节。
 * @return true表示API已返回，不表示远端送达。SDK原生帧转换会复制输入buffer。
 * @note 仅所属JS线程；timestamp留0沿用官方SDK自动时间戳；不保存音频或写入日志。
 */
static napi_value writePcm(napi_env env,napi_callback_info info) {
    if(!activePcm())return pcmRefused(env,"AVSDK_PCM_NOT_PREPARED");
    size_t count{1},length{};napi_value input{};bool isBuffer{};void* bytes{};
    if(napi_get_cb_info(env,info,&count,&input,nullptr,nullptr)!=napi_ok||count!=1
        ||napi_is_buffer(env,input,&isBuffer)!=napi_ok||!isBuffer
        ||napi_get_buffer_info(env,input,&bytes,&length)!=napi_ok||length!=pcmFrameBytes)
        return pcmRefused(env,"AVSDK_PCM_FRAME_INVALID");
    NativeAudioFrame frame{};frame.audioFormat=1;frame.data=static_cast<char*>(bytes);
    frame.length=pcmFrameBytes;frame.sampleRate=48000;frame.channel=1;
    using Audio=void (*)(void*,NativeAudioFrame*);
    reinterpret_cast<Audio>(pcmBinding.methods[1])(pcmBinding.instance,&frame);
    if(frame.data!=bytes||frame.length!=pcmFrameBytes||frame.sampleRate!=48000||frame.channel!=1){
        pcmPrepared=false;return pcmRefused(env,"AVSDK_PCM_STRUCTURE_CHANGED");
    }
    ++pcmWritten;return boolean(env,true);
}

/**
 * 读取一帧固定PCM，调用后复制到Node Buffer，未收到媒体时允许返回静音。
 * @return 1920字节Buffer；这不是“已收到远端音频”的证明。
 * @note 仅所属JS线程；扩大保护区并核对哨兵及帧结构，异常时撤销后续帧能力。
 */
static napi_value readPcm(napi_env env,napi_callback_info) {
    if(!activePcm())return pcmRefused(env,"AVSDK_PCM_NOT_PREPARED");
    constexpr size_t guard{32},payload{8192};constexpr unsigned char sentinel{0xa7};
    std::array<unsigned char,payload+2*guard> memory{};memory.fill(sentinel);
    std::fill(memory.begin()+guard,memory.begin()+guard+pcmFrameBytes,0);
    NativeAudioFrame frame{};frame.audioFormat=1;frame.data=reinterpret_cast<char*>(memory.data()+guard);
    frame.length=pcmFrameBytes;frame.sampleRate=48000;frame.channel=1;
    using Audio=void (*)(void*,NativeAudioFrame*);
    reinterpret_cast<Audio>(pcmBinding.methods[3])(pcmBinding.instance,&frame);
    const bool prefix=std::all_of(memory.begin(),memory.begin()+guard,[](auto value){return value==sentinel;});
    const bool suffix=std::all_of(memory.begin()+guard+pcmFrameBytes,memory.end(),[](auto value){return value==sentinel;});
    if(!prefix||!suffix||frame.data!=reinterpret_cast<char*>(memory.data()+guard)||frame.length!=pcmFrameBytes
        ||frame.sampleRate!=48000||frame.channel!=1){pcmPrepared=false;return pcmRefused(env,"AVSDK_PCM_BOUNDS");}
    napi_value result{};
    if(napi_create_buffer_copy(env,pcmFrameBytes,memory.data()+guard,nullptr,&result)!=napi_ok)return nullptr;
    ++pcmRead;return result;
}

/** 停止本地帧入口；保留自定义输入模式，避免恢复麦克风；不声称QQ通话已挂断。 */
static napi_value disarmPcm(napi_env env,napi_callback_info) {
    if(started&&!validThread())return boolean(env,false);
    pcmPrepared=false;pcmBinding={};return boolean(env,true);
}

/** 返回已调用的本地帧计数；不含音频、地址、设备或用户信息。 */
static napi_value pcmMetadata(napi_env env,napi_callback_info) {
    napi_value result{},prepared{};
    if(napi_create_object(env,&result)!=napi_ok||napi_get_boolean(env,pcmPrepared&&activePcm(),&prepared)!=napi_ok
        ||napi_set_named_property(env,result,"prepared",prepared)!=napi_ok
        ||!numberProperty(env,result,"writtenFrames",static_cast<double>(pcmWritten))
        ||!numberProperty(env,result,"readFrames",static_cast<double>(pcmRead)))return nullptr;
    return result;
}
}
