import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bridge=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const work=path.dirname(bridge),mode=process.argv[2];
if(process.argv.length!==3||!['--check','--write'].includes(mode))throw Error('TYPED_BUILD_MODE_REQUIRED');
const modules=["native/singing-followup","bridge","native-gateway","local-voice","voice-manager","singing-manager","phone-model","phone-dialog","phone-manager","silk-codec","native-record-upload","phone-pcm","voice-resources","phone-session-archive","send-voice-lib","v2-wait","web-search","mcp-web-search-safe","search/parsers","search/transport","token-ledger","model-prices","usage/ledger-protocol","usage/ledger-index","usage/ledger-queries","usage/ledger-timeline","qq-avatar","self-avatar-send","qq-status-view","role-trash","idle-draft","native-idle-loop","voice-core","media-normalize","native-feature-routes","native-sticker-api","group-management-api","qzone-api","self-profile-api","image-provider-presets","image-provider","image-preferences","image-generation","image-generation-api","public-address","public-dns","safe-fetch","dsh-client","dsh/auth-primitives","dsh/protocol","dsh/turn-collector","onebot-client","forward","messaging/onebot-send","native/feature-delivery","lifecycle/legacy-gateway-recovery","snowluma-conn","legacy-onebot-compat","native/observation-coordinator","native/feature-context","native-feature-access","native-background-observation","native-turn-fence","roles/prompt-context","messaging/output-warnings","security/token-registry","logging/tool-audit","messaging/segments","messaging/group-members","messaging/reply-context","config/mode-inputs","lifecycle/mode-coordinator","lifecycle/gateway-health","storage/json-files","sessions/mapping-store","lifecycle/instance-lock","logging/capped-logger","config/load-config","preset-prompt","slang-learner","sticker-lib","media/image-tools","media/pipeline","media/context","messaging/onebot-http","libraries/sticker-store","libraries/sticker-actions","voice/library","voice/budget","voice/delivery","social/legacy-context","social/legacy-engine","libraries/slang-learning","native-sticker-tools","native-phone-tools","native-singing-tools","qq-model-view","image-generation-errors","sensitive","qq-avatar-limits","mcp-qq-native","mcp-qq-native-host","messaging/incoming","mcp-tools/status","mcp-tools/profile","mcp-tools/messaging","mcp-tools/images","mcp-tools/groups","mcp-tools/conversation","mcp-tools/memory","mcp-tools/stickers","mcp-tools/voice","mcp-tools/transport","native-chat","native-reply-queue","messaging/reply-sender","messaging/burst-sender","roles/role-store","role-card","md-to-plain","presets/preset-store","prompts/initial-prompt-store","models/model-catalog","sessions/usage-observer","messaging/send-queue","roles/role-policy","libraries/slang-routes","libraries/slang-agent-routes","libraries/sticker-routes","roles/role-routes","presets/preset-routes","sessions/admin-routes","social/conversation-memory","social/memory-routes","social/legacy-routes","social/settings-routes","config/settings-routes","prompts/initial-prompt-routes","usage/token-routes","console/routes/index","console/routes/native-settings","console/routes/wait","console/routes/sticker-tools","console/routes/text-send","console/routes/voice-send","console/routes/social-state","console/routes/inbox-wake","console/routes/history","console/routes/message-tools","console/routes/status-mode","console/routes/security-lifecycle","console/routes/poke","console/request-context","console/access-policy","console/operator-notice","console/feedback-store","console/feedback-routes","social/v2-store","social/v2-messages","context/wake-context","wake/configuration","wake/triggers","wake/dispatch","wake/scheduler","sessions/frame-handler","sessions/pending-requests","sessions/turn-events","sessions/event-stream","sessions/creation","sessions/retirement","messaging/prompt-dispatch",'prompts/initial-prompt-policy','messaging/burst-timing','social/legacy-policy','libraries/slang-agent-policy','messaging/prompt-queue','messaging/offline-queue','wake/owned-timers',"config/inputs","messaging/message-segmentation","messaging/gap-planner","messaging/outbound-policy","messaging/outbound-audit","models/session-models","sessions/turn-replay","context/read-receipts"];
function noLinks(file){
  let current=file;
  while(current!==work){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('TYPED_BUILD_LINK_REFUSED');
    const parent=path.dirname(current);if(parent===current)throw Error('TYPED_BUILD_PATH_REFUSED');current=parent;}
}
noLinks(path.join(work,'temp'));fs.mkdirSync(path.join(work,'temp'),{recursive:true});
const out=fs.mkdtempSync(path.join(work,'temp/typed-build-'));
const compiler=path.join(bridge,'node_modules/typescript/bin/tsc');
const compile=spawnSync(process.execPath,[compiler,'--project',path.join(bridge,'tsconfig.typed.json'),'--outDir',out],{
  cwd:bridge,windowsHide:true,encoding:'utf8',env:{...process.env,NODE_DISABLE_COMPILE_CACHE:'1'}});
if(compile.status!==0){process.stderr.write(compile.stdout??'');process.stderr.write(compile.stderr??'');process.exit(compile.status??1);}
const plans=modules.map(name=>{
  const target=path.join(bridge,'src',name+'.js'),source=path.join(bridge,'src',name+'.ts'),emitted=path.join(out,name+'.js');
  noLinks(target);noLinks(source);noLinks(emitted);
  const generated=fs.readFileSync(emitted,'utf8');
  const expected='// Generated from '+name+'.ts. Edit the TypeScript source and run build:typed.\n'+generated;
  return {target,name,expected,current:fs.existsSync(target)?fs.readFileSync(target,'utf8'):null};
});
const changed=plans.filter(plan=>plan.current!==plan.expected);
if(mode==='--check'&&changed.length){console.error(JSON.stringify({status:'stale',files:changed.map(plan=>'src/'+plan.name+'.js')}));process.exitCode=1;}
else {
  if(mode==='--write')for(const plan of changed){
    const next=plan.target+'.typed-next';if(fs.existsSync(next))throw Error('TYPED_BUILD_PENDING_FILE');
    fs.writeFileSync(next,plan.expected,{flag:'wx'});fs.renameSync(next,plan.target);
  }
  console.log(JSON.stringify({status:mode==='--check'?'verified':'built',modules:modules.length,updated:mode==='--write'?changed.length:0}));
}
