import {setTimeout as delay} from 'node:timers/promises';
/** 等待所属通话的真实音频就绪事件；撤销或超时拒绝，不登记或重试原生回调。 */
export async function waitForAudioEngine({isReady,isCurrent,timeoutMs=3000,clock=Date.now,wait=delay}) {
  const until=clock()+timeoutMs;
  for(;;){
    if(!isCurrent())throw Error('PHONE_AUDIO_LEASE_EXPIRED');
    if(isReady())return;
    if(clock()>=until)throw Error('PHONE_AUDIO_ENGINE_TIMEOUT');
    await wait(Math.min(20,until-clock()));
  }
}
