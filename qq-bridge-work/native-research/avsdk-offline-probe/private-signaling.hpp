#pragma once

namespace nodeAvsdk {
// 仅所属worker的内存通道；不接HTTP，不记录载荷。所有值锁使用PPAPI同一递归锁。
static std::atomic<bool> privateSignalsArmed{};
static std::atomic<bool> privateSignalsOverflow{};
static bool privateLoginSubmitted{};
static int32_t privateCorrelation{1400000};
static std::deque<PP_Var> privateSignals;

static void discardPrivateSignals() {
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    privateSignalsArmed=false;
    for(const PP_Var value:privateSignals)pepperProbe::release(value);
    privateSignals.clear();
}
static void observePrivateSignal(PP_Var value) {
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    // 调用者postMessage已持有值锁。队列持有一个独立引用，不借用SDK临时参数。
    if(!privateSignalsArmed)return;
    if(privateSignals.size()>=32){privateSignalsOverflow=true;discardPrivateSignals();return;}
    pepperProbe::addRef(value);privateSignals.push_back(value);
}

/**
 * 为所属worker启用私有SDK消息队列；不得映射为模型工具或HTTP路由。
 * @return true表示已启用；不表示SDK登录、原生监听或通话可用。
 * @note 仅主线程，单次启用；最多32个消息，溢出后拒绝继续，不能静默丢失信令。
 */
static napi_value armPrivateSignals(napi_env env,napi_callback_info) {
    if(!started||closing||!validThread()||privateSignalsArmed||privateSignalsOverflow)return boolean(env,false);
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    privateSignalsArmed=true;return boolean(env,true);
}

/**
 * 将有界SDK队列复制为JS值并释放原生引用；结果只允许在所属worker与父驱动IPC流转。
 * @return 数组；异常仅包含固定错误码，不含SDK错误文本、账号或opaque载荷。
 * @note 仅主线程；错误后撤销通道。SDK值不进入诊断输出、共享状态或模型上下文。
 */
static napi_value drainPrivateSignals(napi_env env,napi_callback_info) {
    std::lock_guard<std::recursive_mutex> lock{pepperProbe::stringMutex};
    if(!started||closing||!validThread()||!privateSignalsArmed||privateSignalsOverflow){
        napi_throw_error(env,"AVSDK_SIGNAL_UNAVAILABLE","AVSDK_SIGNAL_UNAVAILABLE");return nullptr;
    }
    napi_value result{};
    if(napi_create_array_with_length(env,privateSignals.size(),&result)!=napi_ok)return nullptr;
    for(uint32_t index{};!privateSignals.empty();++index){
        PP_Var value{privateSignals.front()};privateSignals.pop_front();
        napi_value copy{};CodecBudget budget{};
        const bool converted{toJs(env,value,copy,budget)};pepperProbe::release(value);
        if(!converted||napi_set_element(env,result,index,copy)!=napi_ok){
            discardPrivateSignals();napi_throw_error(env,"AVSDK_SIGNAL_VALUE_REFUSED","AVSDK_SIGNAL_VALUE_REFUSED");return nullptr;
        }
    }
    return result;
}

static bool privateInt(napi_env env,napi_value value) {
    double number{};return napi_get_value_double(env,value,&number)==napi_ok&&std::isfinite(number)
        &&number==std::trunc(number)&&number>=0&&number<=INT32_MAX;
}
static bool privateText(napi_env env,napi_value value,size_t maximum,bool empty=false) {
    std::string text;return stringFromJs(env,value,text,maximum)&&(empty||!text.empty())&&text.find('\0')==std::string::npos;
}
static bool privateAccept(napi_env env,napi_value params) {
    napi_value items[7]{};
    for(uint32_t index{};index<7;++index)if(napi_get_element(env,params,index,&items[index])!=napi_ok)return false;
    bool array{},dsp{};uint32_t count{};
    if(!privateInt(env,items[0])||!privateText(env,items[1],160)
        ||napi_is_array(env,items[2],&array)!=napi_ok||!array
        ||napi_get_array_length(env,items[2],&count)!=napi_ok||count!=1
        ||!privateInt(env,items[3])||!privateText(env,items[4],512,true)
        ||napi_get_value_bool(env,items[5],&dsp)!=napi_ok||!privateText(env,items[6],256*1024,true))return false;
    napi_value peer{};std::string inviter,participant;
    return napi_get_element(env,items[2],0,&peer)==napi_ok&&stringFromJs(env,items[1],inviter,160)
        &&stringFromJs(env,peer,participant,160)&&inviter==participant;
}

/**
 * 所属驱动的窄接口；固定命令号不由JS调用方提供。
 * @param operation login/kernel_action/accept/quit/reject；参数类型与固定Windows入口交叉核对。
 * @param params 有界协议数组；login仅一次，kernel_action不自动重试。
 * @return 内部分配的关联号，只表示HandleMessage已返回，不能代表业务完成。
 * @note 仅主线程且队列已启用；接听/拒绝/退出还须由worker绑定真实邀请及当前lease。
 * 本层不接受拨号、设备、地址或任意命令号，不把返回关联号当成通话完成。
 */
static napi_value submitPrivateSignal(napi_env env,napi_callback_info info) {
    size_t argc{2};napi_value args[2]{};std::string operation;bool array{};uint32_t count{};
    if(!started||closing||!validThread()||!privateSignalsArmed||privateSignalsOverflow||pluginMessaging==nullptr
        ||napi_get_cb_info(env,info,&argc,args,nullptr,nullptr)!=napi_ok||argc!=2
        ||!stringFromJs(env,args[0],operation,24)||napi_is_array(env,args[1],&array)!=napi_ok||!array
        ||napi_get_array_length(env,args[1],&count)!=napi_ok){
        napi_throw_error(env,"AVSDK_SIGNAL_REFUSED","AVSDK_SIGNAL_REFUSED");return nullptr;
    }
    int32_t command{};
    if(operation=="login"&&count==5&&!privateLoginSubmitted){
        for(uint32_t index{};index<count;++index){napi_value item{};
            if(napi_get_element(env,args[1],index,&item)!=napi_ok||!privateText(env,item,index==3?4096:160,index==4)){
                napi_throw_error(env,"AVSDK_SIGNAL_SHAPE_INVALID","AVSDK_SIGNAL_SHAPE_INVALID");return nullptr;
            }
        }
        command=1;
    }else if(operation=="kernel_action"&&count==2){
        napi_value type{},payload{};
        if(napi_get_element(env,args[1],0,&type)!=napi_ok||!privateInt(env,type)
            ||napi_get_element(env,args[1],1,&payload)!=napi_ok||!privateText(env,payload,256*1024)){
            napi_throw_error(env,"AVSDK_SIGNAL_SHAPE_INVALID","AVSDK_SIGNAL_SHAPE_INVALID");return nullptr;
        }
        command=55;
    }else if(operation=="accept"&&count==7&&privateAccept(env,args[1])){
        command=5;
    }else if(operation=="quit"&&count==2){
        napi_value scene{},reason{};
        if(napi_get_element(env,args[1],0,&scene)!=napi_ok||!privateInt(env,scene)
            ||napi_get_element(env,args[1],1,&reason)!=napi_ok||!privateInt(env,reason)){
            napi_throw_error(env,"AVSDK_SIGNAL_SHAPE_INVALID","AVSDK_SIGNAL_SHAPE_INVALID");return nullptr;
        }
        command=8;
    }else if(operation=="reject"&&count==3){
        napi_value scene{},peer{},reason{};
        if(napi_get_element(env,args[1],0,&scene)!=napi_ok||!privateInt(env,scene)
            ||napi_get_element(env,args[1],1,&peer)!=napi_ok||!privateText(env,peer,160)
            ||napi_get_element(env,args[1],2,&reason)!=napi_ok||!privateInt(env,reason)){
            napi_throw_error(env,"AVSDK_SIGNAL_SHAPE_INVALID","AVSDK_SIGNAL_SHAPE_INVALID");return nullptr;
        }
        command=9;
    }else{napi_throw_error(env,"AVSDK_SIGNAL_OPERATION_REFUSED","AVSDK_SIGNAL_OPERATION_REFUSED");return nullptr;}
    if(privateCorrelation>=INT32_MAX){napi_throw_error(env,"AVSDK_SIGNAL_LIMIT","AVSDK_SIGNAL_LIMIT");return nullptr;}
    const int32_t correlation{++privateCorrelation};
    PP_Var message{pepperProbe::dictionaryCreate()},params{PP_MakeUndefined()};CodecBudget budget{};
    bool valid{fromJs(env,args[1],params,budget)};
    const struct {const char* name;PP_Var value;} fields[]{
        {"cmd",PP_MakeInt32(command)},{"id",PP_MakeInt32(correlation)},{"param",params}};
    for(const auto& field:fields){
        PP_Var name{pepperProbe::fromUtf8(field.name,static_cast<uint32_t>(std::strlen(field.name)))};
        valid=pepperProbe::dictionarySet(message,name,field.value)==PP_TRUE&&valid;pepperProbe::release(name);
    }
    pepperProbe::release(params);
    if(!valid){pepperProbe::release(message);napi_throw_error(env,"AVSDK_SIGNAL_VALUE_REFUSED","AVSDK_SIGNAL_VALUE_REFUSED");return nullptr;}
    if(command==1)privateLoginSubmitted=true;
    pluginMessaging->HandleMessage(1,message);pepperProbe::release(message);
    napi_value result{};return napi_create_double(env,static_cast<double>(correlation),&result)==napi_ok?result:nullptr;
}
}
