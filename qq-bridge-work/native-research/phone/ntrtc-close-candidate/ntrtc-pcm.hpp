#pragma once
#include <deque>
#include <mutex>
#include <atomic>
#include <cstring>

namespace nodeAvsdk {
namespace ntrtcPcm {
using Callback=int (*)(int,void*,int*,const int*,void*);
using Register=bool (*)(void*,int,Callback,void*,bool);
using Unregister=bool (*)(void*,int,Callback);
using Enable=bool (*)(void*,int,bool);
struct SessionLease {uintptr_t object{};uintptr_t control{};};
static_assert(sizeof(SessionLease)==16);
struct Context {
    std::mutex mutex;
    std::deque<int16_t> samples;
    std::atomic<bool> active{false};
    std::atomic<uint32_t> callbacks{0}, acceptedCallbacks{0}, consumedSamples{0}, rejectedCallbacks{0};
    int format[3]{};
    void* sender{};
    Register add{};
    Unregister remove{};
    Enable enable{};
    bool registered{};
    SessionLease lease{};
};
// SDK线程可能在停止边缘完成回调；上下文由进程持有，不在native DLL退出前销毁。
static Context* const context{new Context{}};
constexpr std::size_t maxSamples{96000};
static bool region(const void* value,std::size_t bytes,bool write=false) {
    MEMORY_BASIC_INFORMATION area{};
    if(!value||!bytes||VirtualQuery(value,&area,sizeof(area))!=sizeof(area)||area.State!=MEM_COMMIT
       ||(area.Protect&(PAGE_NOACCESS|PAGE_GUARD)))return false;
    const auto start{reinterpret_cast<uintptr_t>(value)},base{reinterpret_cast<uintptr_t>(area.BaseAddress)};
    if(start<base||start-base>area.RegionSize||bytes>area.RegionSize-(start-base))return false;
    if(write&&!(area.Protect&(PAGE_READWRITE|PAGE_WRITECOPY|PAGE_EXECUTE_READWRITE|PAGE_EXECUTE_WRITECOPY)))return false;
    return true;
}
static uintptr_t word(uintptr_t address) {
    uintptr_t value{};if(!region(reinterpret_cast<void*>(address),sizeof(value)))return 0;
    std::memcpy(&value,reinterpret_cast<void*>(address),sizeof(value));return value;
}
static bool method(uintptr_t object,unsigned slot,uintptr_t expected,uintptr_t& output) {
    const auto table{word(object)};output=table?word(table+slot*sizeof(uintptr_t)):0;
    return sdk&&output==reinterpret_cast<uintptr_t>(sdk)+expected;
}
static void releaseLease(SessionLease& lease) {
    if(lease.control&&sdk){
        // 固定SDK实际使用的shared_ptr析构辅助；按SDK自己的计数规则释放，不跨编译器构造STL对象。
        using Release=void (*)(SessionLease*);
        reinterpret_cast<Release>(reinterpret_cast<uintptr_t>(sdk)+0x31e5c0)(&lease);
    }
    lease={};
}
static uintptr_t heldSender() {
    uintptr_t checked{};const auto session{context->lease.object};
    if(!session||!method(session,31,4834608,checked)||!method(session,35,4792000,checked))return 0;
    const auto sender{word(session+0x3b0e0)};
    if(!sender||!method(sender,63,3379824,checked)||!method(sender,64,3386176,checked))return 0;
    return sender;
}
// 已核对SDK回调为(type,buffer,length*,format[3],context)，返回-1拒绝，不读入录音。
// 三个格式数值只接受48k/16bit的单声道或双声道；其它格式保留诊断并拒绝。
static unsigned channels(const int* format) {
    for(unsigned rate{};rate<3;++rate)if(format[rate]==48000){
        const int a{format[(rate+1)%3]},b{format[(rate+2)%3]};
        if((a==1&&(b==16||b==2))||(b==1&&(a==16||a==2)))return 1;
        if((a==2&&(b==16||b==2))||(b==2&&(a==16||a==2)))return 2;
    }
    return 0;
}
static int fill(int type,void* data,int* length,const int* format,void* opaque) {
    // SDK把登记的userData放在回调上下文首字段；其余字段可能含对端标识，不读取。
    void* supplied{};
    if(!region(opaque,sizeof(supplied)))return -1;
    std::memcpy(&supplied,opaque,sizeof(supplied));
    auto* state{static_cast<Context*>(supplied)};
    if(state!=context||!state->active.load(std::memory_order_acquire))return -1;
    ++state->callbacks;
    if(type!=1||!region(length,sizeof(int),true)||!region(format,3*sizeof(int))){++state->rejectedCallbacks;return -1;}
    int view[3]{};std::memcpy(view,format,sizeof(view));const unsigned channelCount{channels(view)};
    const int bytes{*length};
    if(!channelCount||bytes<=0||bytes>3840||bytes%(channelCount*2)||reinterpret_cast<uintptr_t>(data)%alignof(int16_t)||!region(data,static_cast<std::size_t>(bytes),true)){
        std::lock_guard<std::mutex> lock{state->mutex};std::memcpy(state->format,view,sizeof(view));++state->rejectedCallbacks;return -1;
    }
    std::lock_guard<std::mutex> lock{state->mutex};
    if(!state->active.load(std::memory_order_acquire))return -1;
    std::memcpy(state->format,view,sizeof(view));std::memset(data,0,static_cast<std::size_t>(bytes));
    auto* target{static_cast<int16_t*>(data)};const auto frames{static_cast<std::size_t>(bytes)/(channelCount*2)};
    for(std::size_t index{};index<frames&&!state->samples.empty();++index){
        const auto sample{state->samples.front()};state->samples.pop_front();
        for(unsigned channel{};channel<channelCount;++channel)target[index*channelCount+channel]=sample;
        ++state->consumedSamples;
    }
    ++state->acceptedCallbacks;return 0;
}
static uintptr_t resolveSender() {
    if(!started||closing||!validThread()||!sdk||context->lease.control)return 0;
    const auto base{reinterpret_cast<uintptr_t>(sdk)};
    const auto client{word(base+0x138a190)},audio{word(base+0x138ab30)};
    uintptr_t checked{};
    if(!client||!audio||!method(audio,19,3499536,checked))return 0;
    const auto core{word(client+0x158)};
    if(!core||!method(core,24,3323728,checked)||!region(reinterpret_cast<void*>(core+0x298),sizeof(int32_t)))return 0;
    int32_t kind{};std::memcpy(&kind,reinterpret_cast<void*>(core+0x298),sizeof(kind));if(kind!=1)return 0;
    const auto delegate{word(audio+8)};
    if(!delegate||!method(delegate,40,3674272,checked)||word(delegate+0x188)!=1)return 0;
    SessionLease lease{};
    // 已核对MSVC返回槽ABI；此getter在SDK自己的锁内取得本次会话强引用。
    using Acquire=SessionLease* (*)(void*,SessionLease*);
    const auto acquired{reinterpret_cast<Acquire>(base+0x387900)(reinterpret_cast<void*>(delegate),&lease)};
    if(acquired!=&lease||!lease.object||!lease.control||word(delegate+0x188)!=1){releaseLease(lease);return 0;}
    context->lease=lease;const auto sender{heldSender()};
    if(!sender){releaseLease(context->lease);return 0;}
    return sender;
}
static std::size_t clear() {
    std::lock_guard<std::mutex> lock{context->mutex};const auto size{context->samples.size()};
    for(auto& sample:context->samples)sample=0;context->samples.clear();return size*2;
}
}

/** 仅在当前所属通话中登记固定NTRTC混音回调；不调用打开电脑麦克风的接口。 */
static napi_value prepareNtrtcPcm(napi_env env,napi_callback_info) {
    auto* const context{ntrtcPcm::context};
    if(context->registered)return boolean(env,context->active.load());
    const auto sender{ntrtcPcm::resolveSender()};uintptr_t add{},remove{},enable{};
    if(!sender||!ntrtcPcm::method(sender,63,3379824,add)||!ntrtcPcm::method(sender,64,3386176,remove)||!ntrtcPcm::method(sender,57,3370976,enable)){ntrtcPcm::releaseLease(context->lease);return pcmRefused(env,"NTRTC_SESSION_UNCONFIRMED");}
    // SDK保存回调的私有链表必须为空，避免覆盖它或其他组件的现有混音回调。
    if(ntrtcPcm::word(sender+(1+0x1f)*16+8)!=0){ntrtcPcm::releaseLease(context->lease);return pcmRefused(env,"NTRTC_MIX_ALREADY_OWNED");}
    context->sender=reinterpret_cast<void*>(sender);context->add=reinterpret_cast<ntrtcPcm::Register>(add);context->remove=reinterpret_cast<ntrtcPcm::Unregister>(remove);
    context->enable=reinterpret_cast<ntrtcPcm::Enable>(enable);
    ntrtcPcm::clear();context->active.store(true,std::memory_order_release);
    // SDK可能先记住回调再返回下层失败；让统一停止路径撤销这次登记。
    context->registered=true;
    if(!context->add(context->sender,1,ntrtcPcm::fill,context,true)){context->active.store(false);return pcmRefused(env,"NTRTC_CALLBACK_UNCONFIRMED");}
    if(!context->enable(context->sender,1,true)){context->active.store(false);return pcmRefused(env,"NTRTC_CALLBACK_UNCONFIRMED");}
    return boolean(env,true);
}
/** 只接一帧48k单声道PCM16；入队不代表远端播放，固定容量超限时拒绝。 */
static napi_value writeNtrtcPcm(napi_env env,napi_callback_info info) {
    auto* const context{ntrtcPcm::context};std::size_t argc{1},size{};napi_value arg{};bool isBuffer{};void* data{};
    if(!validThread()||!context->registered||!context->active.load()||napi_get_cb_info(env,info,&argc,&arg,nullptr,nullptr)!=napi_ok||argc!=1
       ||napi_is_buffer(env,arg,&isBuffer)!=napi_ok||!isBuffer||napi_get_buffer_info(env,arg,&data,&size)!=napi_ok||size!=1920||reinterpret_cast<uintptr_t>(data)%alignof(int16_t))return pcmRefused(env,"NTRTC_PCM_FRAME_REFUSED");
    std::lock_guard<std::mutex> lock{context->mutex};const auto* samples{static_cast<const int16_t*>(data)};
    const bool silence{std::all_of(samples,samples+960,[](int16_t value){return value==0;})};
    if(silence&&context->samples.empty())return boolean(env,true);
    if(context->samples.size()+960>ntrtcPcm::maxSamples)return pcmRefused(env,"NTRTC_PCM_BACKPRESSURE");
    context->samples.insert(context->samples.end(),samples,samples+960);return boolean(env,true);
}
/** 撤销当前回调并清空未提交PCM；回调上下文保持有效到进程退出。 */
static napi_value disarmNtrtcPcm(napi_env env,napi_callback_info) {
    auto* const context{ntrtcPcm::context};if(!validThread())return boolean(env,false);context->active.store(false,std::memory_order_release);
    bool removed{true};
    if(context->registered){const auto sender{ntrtcPcm::heldSender()};
        if(sender==reinterpret_cast<uintptr_t>(context->sender)&&context->remove){
            const bool disabled{context->enable&&context->enable(context->sender,1,false)};
            removed=context->remove(context->sender,1,ntrtcPcm::fill)&&disabled;
        }else removed=false;
        if(removed)context->registered=false;
    }
    ntrtcPcm::clear();ntrtcPcm::releaseLease(context->lease);context->sender=nullptr;return boolean(env,removed);
}
/** 只清除本组件仍持有的PCM，不操作SDK已经消费的音频。 */
static napi_value clearNtrtcPcm(napi_env env,napi_callback_info){if(!validThread())return boolean(env,false);napi_value value{};napi_create_double(env,static_cast<double>(ntrtcPcm::clear()),&value);return value;}
/** 返回队列与回调计数，不返回音频、原生地址、账号或路径。 */
static napi_value ntrtcPcmMetadata(napi_env env,napi_callback_info) {
    auto* const context{ntrtcPcm::context};std::size_t bytes{};int format[3]{};
    {std::lock_guard<std::mutex> lock{context->mutex};bytes=context->samples.size()*2;std::memcpy(format,context->format,sizeof(format));}
    napi_value value{};napi_create_object(env,&value);
    napi_set_named_property(env,value,"registered",boolean(env,context->registered&&context->active.load()));
    numberProperty(env,value,"queuedBytes",bytes);numberProperty(env,value,"callbacks",context->callbacks.load());
    numberProperty(env,value,"acceptedCallbacks",context->acceptedCallbacks.load());numberProperty(env,value,"consumedSamples",context->consumedSamples.load());
    numberProperty(env,value,"rejectedCallbacks",context->rejectedCallbacks.load());
    for(unsigned i{};i<3;++i){const int v{format[i]};const char* names[]{"format0","format1","format2"};numberProperty(env,value,names[i],v>=0&&v<=192000?v:0);}
    return value;
}
/** 仅未启动SDK时用合成缓冲验证边界；不加载账号、设备或真实音频。 */
static napi_value verifyNtrtcPcmOffline(napi_env env,napi_callback_info) {
    auto* const context{ntrtcPcm::context};if(started||context->registered)return pcmRefused(env,"NTRTC_TEST_SCOPE_REFUSED");
    ntrtcPcm::clear();context->active.store(true);std::array<int16_t,1924> output{};output.fill(321);int length{1920},format[]{48000,1,16};void* callbackContext{context};
    {std::lock_guard<std::mutex> lock{context->mutex};for(unsigned i{};i<960;++i)context->samples.push_back(123);}
    const bool mono{ntrtcPcm::fill(1,output.data()+2,&length,format,&callbackContext)==0&&output[0]==321&&output[1]==321&&output[2]==123&&output[961]==123&&output[962]==321};
    format[1]=2;length=3840;output.fill(321);
    {std::lock_guard<std::mutex> lock{context->mutex};for(unsigned i{};i<960;++i)context->samples.push_back(234);}
    const bool stereo{ntrtcPcm::fill(1,output.data()+2,&length,format,&callbackContext)==0&&output[0]==321&&output[2]==234&&output[3]==234&&output[1921]==234&&output[1922]==321};
    format[0]=22050;output.fill(321);const bool unsupported{ntrtcPcm::fill(1,output.data()+2,&length,format,&callbackContext)==-1&&output[2]==321};
    context->active.store(false);const bool cancelled{ntrtcPcm::fill(1,output.data()+2,&length,format,&callbackContext)==-1};ntrtcPcm::clear();
    return boolean(env,mono&&stereo&&unsupported&&cancelled);
}
/** 无账号独立子进程中验证SDK释放辅助的ABI；仅操作自建控制块，不接触真实会话。 */
static napi_value verifyNtrtcLeaseOffline(napi_env env,napi_callback_info) {
    if(!started||closing||!validThread()||!sdk||privateLoginSubmitted||ntrtcPcm::context->registered)
        return pcmRefused(env,"NTRTC_TEST_SCOPE_REFUSED");
    struct Control {void (**table)(void*);int32_t strong{2};int32_t weak{1};unsigned destroyed{},deleted{};};
    static_assert(offsetof(Control,strong)==8&&offsetof(Control,weak)==12);
    void (*table[])(void*){
        [](void* value){++static_cast<Control*>(value)->destroyed;},
        [](void* value){++static_cast<Control*>(value)->deleted;}
    };
    Control block{table};ntrtcPcm::SessionLease first{1,reinterpret_cast<uintptr_t>(&block)},last{first};
    ntrtcPcm::releaseLease(first);
    const bool retained{block.strong==1&&block.weak==1&&!block.destroyed&&!block.deleted&&!first.control};
    ntrtcPcm::releaseLease(last);
    return boolean(env,retained&&block.strong==0&&block.weak==0&&block.destroyed==1&&block.deleted==1&&!last.control);
}
}
