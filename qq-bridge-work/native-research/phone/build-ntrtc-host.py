"""只用项目固定编译器构建独立NTRTC候选；原宿主和系统配置不变。"""
from pathlib import Path
import json,hashlib,os,subprocess,sys
work=Path(__file__).resolve().parents[2]
base=work/'native-research/avsdk-offline-probe';adapter=work/'native-research/native-adapter';candidate=work/'native-research/phone/ntrtc-pcm-candidate'
close_candidate='--close-candidate' in sys.argv
if close_candidate:
    original=candidate;candidate=candidate.with_name('ntrtc-close-candidate');candidate.mkdir(exist_ok=True)
    (candidate/'ntrtc-pcm.hpp').write_bytes((original/'ntrtc-pcm.hpp').read_bytes())
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((base/'audio-node/node-host-manifest.json').read_text(encoding='utf-8'))
for name,want in manifest['sourceSha256'].items():assert digest(base/name)==want, 'BASE_SOURCE_CHANGED: '+name
if close_candidate:
    private=(base/'private-signaling.hpp').read_text(encoding='utf-8')
    before='operation=="reject"&&count==3'
    assert private.count(before)==1
    private=private.replace(before,'(operation=="reject"||operation=="close")&&count==3')
    before='        command=9;'
    assert private.count(before)==1
    private=private.replace(before,'''        if(operation=="close"){
            // 固定SDK命令10：只允许当前worker已登录的私聊scene 1，不能执行任意场景关闭。
            int32_t sceneValue{},reasonValue{};
            if(!privateLoginSubmitted||napi_get_value_int32(env,scene,&sceneValue)!=napi_ok||sceneValue!=1
                ||napi_get_value_int32(env,reason,&reasonValue)!=napi_ok||reasonValue!=0){
                napi_throw_error(env,"AVSDK_SIGNAL_SHAPE_INVALID","AVSDK_SIGNAL_SHAPE_INVALID");return nullptr;
            }
        }
        command=operation=="close"?10:9;''')
    private=private.replace('login/kernel_action/accept/quit/reject','login/kernel_action/accept/quit/reject/close')
    (candidate/'private-signaling.hpp').write_text(private,encoding='utf-8')
source=(base/'node-host.cpp').read_text(encoding='utf-8')
source=source.replace('#include "private-signaling.hpp"','#include "private-signaling.hpp"\n#include "ntrtc-pcm.hpp"')
anchor='{"startOffline", nodeAvsdk::start},'
assert source.count(anchor)==1
exports=['prepareNtrtcPcm','writeNtrtcPcm','disarmNtrtcPcm','clearNtrtcPcm','ntrtcPcmMetadata','verifyNtrtcPcmOffline','verifyNtrtcLeaseOffline']
source=source.replace(anchor,anchor+'\n        '+','.join('{"'+name+'",nodeAvsdk::'+name+'}' for name in exports)+',')
(candidate/'node-host.cpp').write_text(source,encoding='utf-8')
lock=json.loads((adapter/'toolchain.lock.json').read_text(encoding='utf-8'))
if not all(k in lock for k in ['zig','headers']):lock=json.loads((work/'development/toolchain.full.lock.json').read_text(encoding='utf-8'))
compiler=adapter/'toolchain'/lock['zig']['directory']/'zig.exe';headers=adapter/'toolchain'/lock['headers']['directory']/'include/node'
env=dict(os.environ)
for key,suffix in [('ZIG_LOCAL_CACHE_DIR','cache/local'),('ZIG_GLOBAL_CACHE_DIR','cache/global'),('TEMP','temp'),('TMP','temp')]:
 directory=candidate/suffix;directory.mkdir(parents=True,exist_ok=True);env[key]=str(directory)
result=subprocess.run([str(compiler),'c++','-std=c++17','-O2','-shared','-target','x86_64-windows-gnu','-I',str(headers),'-I',str(base/'vendor/chromium'),'-I',str(base),str(candidate/'node-host.cpp'),str(base/'audio-node/QQNT.lib'),str(base/'audio-node/node-api-extra.lib'),'-ldbghelp','-o',str(candidate/'avsdk-host.node')],cwd=candidate,env=env,capture_output=True,timeout=120,creationflags=subprocess.CREATE_NO_WINDOW)
(candidate/'build.log').write_bytes(result.stdout+result.stderr)
if result.returncode:print((result.stdout+result.stderr).decode('utf-8',errors='replace')[-5000:]);raise SystemExit(result.returncode)
source_names=['node-host.cpp','ntrtc-pcm.hpp']+(['private-signaling.hpp'] if close_candidate else [])
report={'kind':'isolated_ntrtc_pcm_candidate','hostSha256':digest(candidate/'avsdk-host.node'),'sources':{name:digest(candidate/name) for name in source_names},'baseSourceSha256':manifest['sourceSha256'],'nodeSha256':manifest['nodeSha256'],'productionWorkerChanged':False}
(candidate/'manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'built':True,'productionWorkerChanged':False,'systemInstall':False}))
