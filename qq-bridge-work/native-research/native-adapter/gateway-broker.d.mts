import type {NativeScope} from './scope-policy.mjs';
import type {SelfProfileField} from './native-self-profile.mjs';
/** 受限管道回执经 normalizeIdleSettings 后的冻结设置。 */
export interface GatewayIdleSettings {
 readonly enabled:boolean;readonly quietEnabled:boolean;readonly quietStart:string;readonly quietEnd:string;
 readonly idleMinutes:number;readonly cooldownMinutes:number;readonly dailyLimit:number;readonly globalDailyLimit:number;
}
/** 仅描述 readGatewayConnection 及其策略校验器真正归一化的字段。 */
export interface GatewayConnection {
 url:string;accessToken:string;allowSend:boolean;configurationRevision?:number;
 scope?:NativeScope;allow:{private:string[];groups:string[]};
 permissions:Record<'receiveImages'|'sendImages'|'receiveVoice'|'sendVoice'|'readSelfAvatar'|'generateImages'|'useStickers'|'collectStickers',boolean>;
 idleMessages:GatewayIdleSettings;
 groupAdmin:Readonly<Record<'atAll'|'mute'|'kick',boolean>>;
 friendRequests:Readonly<Record<'receiveRequests'|'autoAccept',boolean>>;
 qzone:Readonly<{enabled:boolean;audience:'self'|'friends'|'public';cooldownMinutes:number;dailyLimit:number}>;
 selfProfile:Readonly<Record<SelfProfileField,boolean>>;
}
/** 核验所属进程与受限管道后返回内存连接；失败抛出脱敏错误，不持久化凭据。 */
export function readGatewayConnection(state:unknown,options?:{allowFixture?:boolean}):Promise<GatewayConnection>;
