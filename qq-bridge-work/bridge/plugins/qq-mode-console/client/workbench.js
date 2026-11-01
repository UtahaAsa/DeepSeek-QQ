// 构建时与纯偏好协议合并到DSH factory；本源文件不读取任何全局账号或凭据。
function createWorkbenchClient(require) {
const { createElement: h, useState, useEffect, useSyncExternalStore, useRef, useMemo } = require('react');
const { FishLogo } = require('@deepseek-ai/dsh-client-ui-primitives');
const tabs = [['overview', '概览'], ['connection', '连接授权'], ['chat', '角色'], ['management','资料管理'], ['capabilities', '能力设置'], ['phone','电话'], ['activity', '运行状态']];
const phaseName = value => ({ ready: '已就绪', stopped: '已停止', failed: '发生错误', starting: '正在启动', degraded: '正在重新确认',
  awaiting_user: '等待本人连接', unavailable: '暂时不可用', disabled: '未开启', not_started: '尚未启动',
  loading_asr: '正在加载识别模型', warming_asr: '正在预热识别', loading_tts: '正在加载声音',
  warming_tts: '正在预热声音', switching: '正在切换', rolling_back: '正在恢复上一配置' })[value] ?? '状态待确认';
const note = text => h('p', { className: 'qqw-note' }, text);
const button = (text, action, disabled = false, primary = false) => h('button', { type: 'button', disabled,
  className: primary ? 'qqw-primary' : '', onClick: action }, text);
function Field({ title, value, change, type = 'text', disabled = false, multiline = false, maxLength }) {
  return h('label', { className: 'qqw-field' }, h('span', null, title), h(multiline ? 'textarea' : 'input', {
    value: value ?? '', disabled, maxLength, 'aria-label': title, type: multiline ? undefined : type, autoComplete: 'off', spellCheck: false,
    onChange: event => change(event.target.value) }));
}
function ConfirmDialog({ value, close }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement; ref.current.showModal();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return h('dialog', { ref, className: 'qqw-dialog', 'aria-labelledby': 'qqw-confirm-title',
    onCancel: event => { event.preventDefault(); close(); } }, h('h2', { id: 'qqw-confirm-title' }, '确认操作'),
    h('p', null, value.text), h('div', { className: 'qqw-actions' }, h('button', { type: 'button', autoFocus: true, onClick: close }, '取消'),
      button('确认', () => { close(); void value.action(); })));
}

function Icon({ name, size = 20 }) {
  const paths = {
    overview: ['M3 10l9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z', 'M9 21v-8h6v8'],
    connection: ['M9 7H7a5 5 0 0 0 0 10h2', 'M15 7h2a5 5 0 0 1 0 10h-2', 'M8 12h8'],
    chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3H13a8 8 0 0 1 8 8.5Z', 'M7 10h9M7 14h6'],
    capabilities: ['M12 3v4M12 17v4M3 12h4M17 12h4', 'M8 8h8v8H8Z'],
    activity: ['M4 5h16v16H4Z', 'M8 3v4M16 3v4M8 11h8M8 15h5'],
    messages: ['M20 16a2 2 0 0 1-2 2H8l-5 3V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z', 'M7 9h9M7 13h6'],
    images: ['M4 4h16v16H4Z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 8h.01'],
    voice: ['M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Z', 'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'],
    phone: ['M7 3H4v4c0 7.2 5.8 13 13 13h3v-3l-5-2-2 2c-3-1.2-5-3.2-6-6l2-2-2-5Z'],
    friends: ['M15 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M3 21v-2a7 7 0 0 1 14 0v2M20 8v6M17 11h6'],
    groups: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z', 'M8 12l3 3 5-6'],
    profile: ['M4 4h16v16H4Z', 'M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 18a5 5 0 0 1 10 0'],
    idle: ['M20 15a8 8 0 0 1-11-11A9 9 0 1 0 20 15Z'],
    qzone: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z'],
    search: ['M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM15 15l6 6'],
    close: ['M6 6l12 12M6 18 18 6'],
    expand: ['M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4'],
    collapse: ['M9 5v4H5M19 9h-4V5M15 19v-4h4M5 15h4v4'],
    settings: ['M4 7h16M4 17h16M8 4v6M16 14v6'],
    arrow: ['M5 12h14M14 7l5 5-5 5'],
  };
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    ...(paths[name] ?? paths.settings).map((d, index) => h('path', { key: index, d })));
}
function OceanMotion() {
  return h('svg', { className: 'qqw-ocean-motion', viewBox: '0 0 1200 150', preserveAspectRatio: 'none', 'aria-hidden': true },
    h('path', { className: 'qqw-wave qqw-wave-back', d: 'M0 85Q150 30 300 85T600 85T900 85T1200 85V150H0Z' }),
    h('path', { className: 'qqw-wave qqw-wave-front', d: 'M0 110Q150 65 300 110T600 110T900 110T1200 110V150H0Z' }),
    ...[[140, 66, 5], [375, 92, 3], [740, 48, 5], [1020, 80, 4]].map(([cx, cy, r], key) =>
      h('circle', { key, className: 'qqw-bubble', cx, cy, r, style: { animationDelay: key * -1.5 + 's' } })));
}
function SettingsSheet({ title, children, close, locked, opener, artwork=false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current, previous = opener?.isConnected ? opener : document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return h('dialog', { ref, className: 'qqw-sheet', 'aria-labelledby': 'qqw-sheet-title',
    onCancel: event => { event.preventDefault(); if (!locked) close(); } },
    h('header', { className: 'qqw-sheet-heading' },
      h('div', null, h('p', { className: 'qqw-eyebrow' }, artwork?'星海画廊':'大肥鱼的能力小抽屉'), h('h2', { id: 'qqw-sheet-title' }, title)),
      h('button', { type: 'button', className: 'qqw-icon-button', 'aria-label': '关闭详情', disabled: locked, onClick: close }, h(Icon, { name: 'close' }))),
    h('div', { className: 'qqw-sheet-content' }, children),
    h('footer', { className: 'qqw-sheet-footer' },
      !artwork&&note('偏好修改会保留在编辑中；返回工作台后保存并应用。声音、角色和供应商使用各自的明确操作。'),
      button(artwork?'返回小窝':'完成编辑', close, locked)));
}

function SingingPanel({ rpc }) {
  const [songs, setSongs] = useState([]), [songId, setSongId] = useState(''), [job, setJob] = useState(null);
  const [message, setMessage] = useState('正在读取歌曲库…'), [loading, setLoading] = useState(false), [audio, setAudio] = useState(null);
  const current = useRef(true), audioRef = useRef(null);
  useEffect(() => {
    current.current = true;
    rpc('singing-state').then(value => { if (current.current) { setSongs(value.songs); setSongId(value.songs[0]?.id ?? '');
      setMessage(value.songs.length ? '选择歌曲后生成试听；聊天中可让大肥鱼唱这首歌。' : '歌曲库为空，请先在本机登记导唱。'); } })
      .catch(() => { if (current.current) setMessage('暂时读不到歌曲库，请检查服务状态。'); });
    return () => { current.current = false; if (audioRef.current) URL.revokeObjectURL(audioRef.current); };
  }, []);
  useEffect(() => {
    if (job?.status !== 'preparing') return;
    const timer = setInterval(() => {
      rpc('singing-status', { job: job.job }).then(value => { if (current.current) { setJob(value);
        setMessage(value.status === 'preparing' ? '正在加载模型或转换歌声，文字聊天可以继续。' : value.status === 'prepared' ? '歌声已生成，可以试听。' : '本次生成未完成，请检查服务状态。'); } })
        .catch(() => { if (current.current) { setMessage('暂时查不到生成进度，请检查服务状态。'); setJob(null); } });
    }, 4000);
    return () => clearInterval(timer);
  }, [job?.job, job?.status]);
  const prepare = async () => {
    setLoading(true); setMessage('正在准备歌声…');
    try { const result = await rpc('singing-prepare', { songId }); if (!current.current) return;
      setJob(result); setMessage(result.status === 'prepared' ? '歌声已生成，可以试听。' : '首次加载可能需要数分钟，进度会自动更新。'); }
    catch { if (current.current) setMessage('未能开始生成，请检查歌曲库和服务状态。'); }
    finally { if (current.current) setLoading(false); }
  };
  const listen = async () => {
    setLoading(true); setMessage('正在载入试听音频…');
    try {
      let offset = 0, size = 0, expected = null; const chunks = [];
      do {
        const part = await rpc('singing-audio', { job: job.job, offset });
        if (!current.current) return;
        if (part.offset !== offset || expected && part.sha256 !== expected || size && size !== part.size) throw Error();
        size = part.size; expected = part.sha256;
        const bytes = Uint8Array.from(atob(part.data), value => value.charCodeAt(0));
        if (!bytes.length || offset + bytes.length > size) throw Error(); chunks.push(bytes); offset += bytes.length;
      } while (offset < size);
      const bytes = new Uint8Array(size); offset = 0;
      for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== expected) throw Error();
      if (audioRef.current) URL.revokeObjectURL(audioRef.current);
      audioRef.current = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); setAudio(audioRef.current); setMessage('试听已载入；点击播放器播放。');
    } catch { if (current.current) setMessage('试听音频未完整载入，请重新检查状态。'); }
    finally { if (current.current) setLoading(false); }
  };
  return h('section', { className: 'qqw-sheet-section', 'aria-label': 'RVC唱歌' }, h('h3', null, 'RVC唱歌'),
    note('先使用试唱音色，音质继续优化。这里生成本地试听；QQ唱歌沿用语音发送许可。'),
    h('label', null, '歌曲', h('select', { value: songId, disabled: loading || job?.status === 'preparing', onChange: event => setSongId(event.target.value) },
      ...songs.map(song => h('option', { key: song.id, value: song.id }, song.title)))),
    h('div', { className: 'qqw-actions' }, button('生成歌声试听', prepare, loading || !songId || job?.status === 'preparing'),
      button('载入试听', listen, loading || job?.status !== 'prepared')),
    h('p', { className: 'qqw-note', role: 'status' }, message),
    audio && h('audio', { controls: true, src: audio, preload: 'metadata', 'aria-label': 'RVC歌声试听', style: { width: '100%' } }));
}

function PhoneSection({rpc,navigate,workspaceDirty}){
  const [state,setState]=useState(null),[draft,setDraft]=useState({enabled:false,autoAnswer:true}),[target,setTarget]=useState(''),
    [message,setMessage]=useState('正在读取电话状态…'),[pending,setPending]=useState([]),[edited,setEdited]=useState(false),[refreshing,setRefreshing]=useState(false);
  const mounted=useRef(false),dirty=useRef(false),flight=useRef(false),epoch=useRef(0),tasks=useRef(new Set());
  const recoveryRequest=useRef(null);
  const refreshWork=useRef(null);
  const call=state?.call,active=!!call&&!call.ended,busy=pending.length>0||state?.recovery?.busy;
  const recovering=state?.recovery?.busy===true;
  let title='正在读取状态',hint='稍等一下，正在确认当前电话服务。',tone='quiet';
  if(state){
    if(!state.settings.enabled){title='电话功能已关闭';hint='开启后，使用当前声音接听已授权私聊的来电。';}
    else if(recovering){title='正在恢复电话';hint='会保留原来的聊天、角色和声音，请等待状态更新。';tone='pending';}
    else if(state.stopUnknown||state.prepareUnknown||['connection_unconfirmed','stop_unconfirmed','prepare_unconfirmed'].includes(state.phase)){
      title='电话状态待确认';hint='先查看QQ连接，再点“恢复电话”；此时不会自动重拨。';tone='warning';
    }else if(active){
      title=({incoming:'有来电',accepting:'正在接听',connected:'通话中',dialing:'正在呼叫',ringing:'等待对方接听',
        ending:'正在结束通话',end_unconfirmed:'挂断状态待确认',start_unconfirmed:'呼叫状态待确认',accept_unconfirmed:'接听状态待确认'})[call.phase]??'正在确认通话';
      hint=call.phase==='connected'&&call.connected?({model:'正在想怎么回答你',tts:'正在准备声音',playing:'大肥鱼正在说话'}[state.dialog?.replyPhase]
        ??(state.dialog?.asrBusy?'正在听懂你说的话':'她在听你说话。')):'只有收到实际接通或结束状态，才会确认结果。';tone=call.phase==='connected'&&call.connected?'connected':'pending';
    }else if(state.incomingAvailable){title='电话已就绪';hint='可以接听已授权私聊的来电，当前没有通话。';tone='ready';}
    else{title='电话正在准备';hint='请先连接QQ，并等待语音和对话模型准备好。';tone='pending';}
  }
  const refresh=(force=false)=>{
    if(flight.current)return refreshWork.current;
    if(!force&&tasks.current.size)return;flight.current=true;const version=epoch.current;
    const work=(async()=>{
    try{const value=await rpc('phone-state');if(!mounted.current||version!==epoch.current)return;
      if(value?.ok===false||!value?.settings)throw Error();setState(value);
      if(recoveryRequest.current&&value.recovery?.id===recoveryRequest.current&&['ready','failed'].includes(value.recovery.phase)){
        setMessage(value.recovery.phase==='failed'?'恢复尚未完成，请先检查QQ和声音。':!value.settings.enabled?'恢复步骤已完成，电话功能仍处于关闭状态。':
          value.incomingAvailable?'电话已恢复，当前可以接听来电。':'恢复步骤已完成，正在等待电话就绪。');recoveryRequest.current=null;
      }
      if(!dirty.current)setDraft({enabled:value.settings.enabled===true,autoAnswer:value.settings.autoAnswer!==false});
      setMessage(previous=>previous==='正在读取电话状态…'?'状态会自动更新。':previous);
    }catch{if(mounted.current&&version===epoch.current)setMessage('电话管理暂时没连上，请先检查“连接与授权”，再重新读取。');}
    finally{flight.current=false;refreshWork.current=null;}
    })();refreshWork.current=work;return work;
  };
  const manualRefresh=async()=>{
    if(busy||refreshing)return;setRefreshing(true);setMessage('正在重新读取电话状态…');
    try{await refresh();if(mounted.current)setMessage(previous=>previous==='正在重新读取电话状态…'?'电话状态已更新。':previous);}
    finally{if(mounted.current)setRefreshing(false);}
  };
  useEffect(()=>{mounted.current=true;let timer;
    const poll=async()=>{await refresh();if(mounted.current)timer=setTimeout(poll,1200);};void poll();
    return()=>{mounted.current=false;epoch.current++;clearTimeout(timer);};},[rpc]);
  const run=async(name,payload,success)=>{
    if(tasks.current.has(name))return;tasks.current.add(name);epoch.current++;setPending([...tasks.current]);setMessage('正在处理，请稍等…');
    try{const result=await rpc(name,payload);if(!mounted.current)return;if(result?.ok===false)throw Error();
      if(name==='phone-recover'&&typeof result.recovery?.id==='string')recoveryRequest.current=result.recovery.id;
      if(name==='phone-configure'){dirty.current=false;setEdited(false);}setMessage(success);await refresh(true);
    }catch{if(mounted.current)setMessage('请求结果尚未确认。请看最新状态，不要连续重复呼叫；需要时点“恢复电话”。');}
    finally{tasks.current.delete(name);if(mounted.current)setPending([...tasks.current]);}
  };
  const edit=(name,value)=>{dirty.current=true;setEdited(true);setDraft(previous=>({...previous,[name]:value}));};
  const action=(operation)=>{
    const key=operation==='start'?'private:'+target.trim():call?.key;
    if(!/^private:[1-9]\d{0,19}$/.test(key??'')){setMessage('请填写已授权私聊联系人的QQ号码。');return;}
    void run('phone-action',{action:operation,key,...(operation==='start'?{}:{callId:call.callId}),
      ...(operation==='end'?{reason:'user_requested'}:{})},operation==='end'?'挂断请求已交出，正在确认结束状态。':operation==='accept'?'接听请求已交出，等待实际接通。':'呼叫请求已交出，等待对方接听。');
  };
  const seconds=Math.floor((call?.connectedMs??0)/1000),duration=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  return h('section',{className:'qqw-phone'},h('div',{className:'qqw-page-heading'},h('div',null,h('p',{className:'qqw-eyebrow'},'同一个声音，换一种陪伴'),h('h2',null,'QQ电话'),
    note('状态自动更新；需要时也可以手动刷新。')),button(refreshing?'正在读取…':'重新读取',()=>void manualRefresh(),busy||refreshing)),
    h('div',{className:'qqw-phone-layout'},h('article',{className:'qqw-card qqw-phone-stage','data-tone':tone},
      h('span',{className:'qqw-phone-orb','aria-hidden':true},h('img',{src:WORKSPACE_PHONE_ART,alt:''})),
      h('p',{className:'qqw-soft-badge'},state?.settings.enabled?'使用当前已选声音':'尚未开启'),
      h('h3',{role:'status','aria-live':'polite'},title),note(hint),
      h('div',{className:'qqw-phone-peer'},active&&h('strong',null,'QQ · '+(call.key?.slice(8)??'当前联系人')),
        active&&(call.connected||seconds>0)&&h('span',{'aria-label':'通话时长 '+duration},duration)),
      h('div',{className:'qqw-actions'},active&&call.phase==='incoming'&&button('接听',()=>action('accept'),busy,true),
        active&&h('button',{type:'button',className:'qqw-phone-end',disabled:pending.includes('phone-action')||['ending','end_unconfirmed'].includes(call.phase),onClick:()=>action('end')},h(Icon,{name:'phone',size:18}),'挂断')),
      h('div',{className:'qqw-phone-readiness'},...[
        ['QQ连接',state?.resources?.qq],['语音理解与声音',state?.resources?.asr&&state?.resources?.tts&&state?.resources?.receiveVoice&&state?.resources?.sendVoice],
        ['对话模型',state?.resources?.model&&state?.resources?.speaking],
      ].map(([name,ready])=>h('div',{key:name,'data-ready':!!ready},h('span',{'aria-hidden':true,className:'qqw-phone-dot'}),h('span',null,name),h('small',null,ready?'已准备':'待准备')))),
      h('div',{className:'qqw-actions'},button('检查QQ连接',()=>navigate('connection')),button('检查声音',()=>navigate('capabilities')))),
      h('div',{className:'qqw-phone-settings'},h('article',{className:'qqw-card'},h('h3',null,'电话设置'),
        h('label',{className:'qqw-toggle'},h('input',{type:'checkbox',checked:draft.enabled,disabled:busy||!state,onChange:event=>edit('enabled',event.target.checked)}),'启用QQ电话'),
        h('label',{className:'qqw-toggle'},h('input',{type:'checkbox',checked:draft.autoAnswer,disabled:busy||!state,onChange:event=>edit('autoAnswer',event.target.checked)}),'自动接听已授权私聊的来电'),
        note(active?'保存设置会结束当前通话。':'电话沿用当前已选声音，原来的角色和聊天会保留。'),
        note('重新登录后，先发一条私聊消息再拨电话。主动挂断后，等约20秒再重拨。'),
        button(active?'保存设置并结束通话':'保存电话设置',()=>void run('phone-configure',draft,'电话设置已保存，正在核对准备状态。'),busy||!edited,!active)),
      h('article',{className:'qqw-card'},h('h3',null,'主动呼叫'),
        state?.outgoingAvailable===true?h('div',null,
          h(Field,{title:'已授权联系人的QQ号码',value:target,change:setTarget,disabled:busy||active}),
          button('呼叫',()=>action('start'),busy||active||!target.trim(),true),
          note('只会向当前授权范围中的私聊联系人发起呼叫。')):
          h('div',null,h('span',{className:'qqw-soft-badge'},state?'当前版本暂不支持':'正在确认能力'),
            note(state?'当前支持接听来电、语音对话和挂断，主动拨号尚未开放。':'正在读取电话能力，请稍候。'),
            state&&note('请从手机QQ拨给大肥鱼；不需要填写号码或重复恢复电话。'))),
      h('article',{className:'qqw-card qqw-phone-recovery'},h('h3',null,'电话没反应？'),note('先看连接状态，再恢复电话。其他聊天和原模型会保留。'),
        button(active?'结束并恢复电话':'恢复电话',()=>void run('phone-recover',{},'恢复已开始，请等待状态更新。'),busy||!state),
        active&&note('这会结束当前通话。')))),
    h('p',{className:'qqw-phone-feedback',role:'status','aria-live':'polite'},message),
    workspaceDirty&&note('其他分区还有未保存的编辑，可以返回原分区继续保存。'));
}

function InlineLogin({rpc,blocked,onConfirm}){
 const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(false),running=useRef(false),epoch=useRef(0);
 const read=async()=>{if(running.current)return;running.current=true;const version=epoch.current;try{const value=await rpc('login-state');if(alive.current&&version===epoch.current){setState(value);setError('');}}catch{if(alive.current&&version===epoch.current){setState(null);setError('连接服务暂不可读，可点击开始连接以恢复。');}}finally{running.current=false;}};
 useEffect(()=>{alive.current=true;let timer;const poll=async()=>{await read();if(alive.current)timer=setTimeout(poll,1500);};void poll();return()=>{alive.current=false;clearTimeout(timer);};},[rpc]);
 const act=async operation=>{if(busy)return;epoch.current++;setBusy(true);setState(null);setError('正在处理连接请求…');try{await rpc(operation);if(alive.current)await read();}catch{if(alive.current)setError('操作未确认，请等待状态更新后再检查；不会自动重复提交。');}finally{if(alive.current)setBusy(false);}};
 const names={idle:'尚未开始连接',initializing:'正在准备连接',connecting:'正在连接QQ',connected:'正在准备二维码',requesting_qr:'正在获取二维码',qr_ready:'请用手机QQ扫码',scanned:'已扫描，请在手机上确认',expired:'二维码已过期',session_initializing:'正在初始化账号会话',failed:'连接未完成',cancelled:'连接已结束',timed_out:'连接超时',stopping:'正在断开连接',succeeded:'登录已确认'};
 return h('div',{className:'qqw-inline-login'},h('p',{role:'status'},state?.ready?'QQ已连接':names[state?.phase]||(error||'正在检查连接')),
  state?.hasQr&&state.qrData&&['qr_ready','scanned'].includes(state.phase)&&h('div',{className:'qqw-qr'},h('img',{src:state.qrData,alt:'本人QQ登录二维码',width:240,height:240}),note('扫码及手机确认由本人完成；二维码不保存到文件。')),
  error&&state&&note(error),h('div',{className:'qqw-actions'},button('开始 / 恢复QQ连接',()=>act('login-connect'),busy||blocked||state?.ready||state?.started&&!['failed','cancelled','timed_out'].includes(state.phase),true),
   button('刷新二维码',()=>act('login-refresh'),busy||state?.phase!=='expired'||state?.qrRequests>=2),
   button('断开QQ连接',()=>onConfirm({text:'断开当前QQ连接？正在进行的回复和通话会中断；模型、声音、角色及会话保留。',action:()=>act('login-stop')}),busy||!state?.started)),
  blocked&&note('有未保存设置时，请先保存授权设置再连接。'));
}
const ManagementSection=createManagementSection({h,useState,useEffect,useRef,button,note,Field});
function Workspace({ form, rpc }) {
  const store = useMemo(() => ({ subscribe: listener => form.subscribe(listener), snapshot: () => form.getSnapshot() }), [form]);
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [tab, setTab] = useState('overview'), [draft, setDraft] = useState(defaultWorkspaceSettings());
  const [mode, setMode] = useState('chat'), [revision, setRevision] = useState(undefined);
  const [scopeText, setScopeText] = useState({}), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('正在读取已保存设置…'), [runtime, setRuntime] = useState(null);
  const [healthMisses, setHealthMisses] = useState(0);
  const [events,setEvents]=useState([]);
  const lastState=useRef('');
  useEffect(()=>{const value=runtime?['dsh','gateway','bridge'].map(k=>k+':'+runtime[k]?.status).join(' · '):'连接检查暂未完成';if(lastState.current!==value){lastState.current=value;setEvents(rows=>[{time:new Date().toLocaleTimeString('zh-CN'),value},...rows].slice(0,12));}},[runtime]);
  const [waitingForApply, setWaitingForApply] = useState(false);
  const [roles, setRoles] = useState(null), [role, setRole] = useState({ name: '', content: '', existing: false });
  const [library, setLibrary] = useState([]), [voice, setVoice] = useState(null), [voiceDraft, setVoiceDraft] = useState({});
  const [roleDirty, setRoleDirty] = useState(false), [previewMode, setPreviewMode] = useState('v2');
  const [images, setImages] = useState(null), [imageDraft, setImageDraft] = useState({}), [apiKey, setApiKey] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [openModules, setOpenModules] = useState({}), [activeSheet, setActiveSheet] = useState(null);
  const [moduleSearch, setModuleSearch] = useState('');
  const [managementDirty,setManagementDirty]=useState(false),[managementBusy,setManagementBusy]=useState(false);
  const [managementPage,setManagementPage]=useState('sessions');
  const [artOpen,setArtOpen]=useState(false);
  const managementCache=useMemo(()=>createManagementCache(rpc),[rpc]);
  const [sheetLoad, setSheetLoad] = useState({});
  const sheetOpener = useRef(null);
  const openDetails = kind => { sheetOpener.current = document.activeElement; setActiveSheet(kind); };
  const editable = snapshot.status === 'ready' && snapshot.writable && !busy;
  const rolePending = role.existing && role.name !== roles?.current;
  const receiveSaved = () => {
    if (!snapshot.value) return;
    try {
      const next = normalizeWorkspaceSettings(snapshot.value.workspace);
      setDraft(next); setMode(snapshot.value.mode); setRevision(snapshot.revision); setDirty(false);
      setScopeText(Object.fromEntries(['private', 'groups'].flatMap(key => ['ids', 'exclude'].map(field =>
        [key + '.' + field, next.scope[key][field].join('\n')]))));
    } catch { setFeedback('已保存设置的格式不兼容，请查看运行记录。'); }
  };
  useEffect(() => { if (!dirty) receiveSaved(); }, [snapshot.revision, snapshot.status]);
  useEffect(() => {
    let live = true, timer;
    const refresh = async () => {
      try { const value = await rpc('state'); if (live) { setRuntime(value); setHealthMisses(0); } }
      catch { if (live) { setRuntime(null); setHealthMisses(value => Math.min(3, value + 1)); } }
      if (live) timer = setTimeout(refresh, 3000);
    };
    void refresh(); return () => { live = false; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (snapshot.status === 'ready' && !dirty && !busy) setFeedback('设置已读取。保存后会核对当前连接的生效结果。');
    if (snapshot.status === 'unavailable') setFeedback('QQ插件设置暂时不可读，请稍后重试。');
  }, [snapshot.status]);
  useEffect(() => {
    if (waitingForApply && runtime?.application?.status === 'applied') {
      setFeedback('已保存，当前连接已生效。'); setWaitingForApply(false);
    }
    if (waitingForApply && runtime?.application?.status === 'failed') {
      setFeedback('模型与发送队列同步未完成，设置仍已保存，请查看运行记录。'); setWaitingForApply(false);
    }
  }, [waitingForApply, runtime?.application?.status]);
  const edit = update => { setDraft(previous => { const next = structuredClone(previous); update(next); return next; }); setDirty(true); };
  const run = async (action, success) => {
    if (busy) return;
    if (!activeSheet) sheetOpener.current = document.activeElement;
    setBusy(true); setFeedback('正在处理…');
    try { await action(); if (success) setFeedback(success); }
    catch (error) { setFeedback(({ ROLE_IN_USE: '该角色正在使用，请重新读取当前角色后确认是否取消选用。',
      ROLE_ALREADY_EXISTS: '已有同名角色，未覆盖。请先处理同名卡，再从回收站恢复。',
      ROLE_TRASH_FULL: '角色回收站已满，未删除角色卡。', ROLE_DELETE_FAILED: '角色删除未确认，请重新读取角色列表。',
      ROLE_RESTORE_FAILED: '恢复未完成，回收内容仍保留，请重新读取后重试。' })[error.message]
      ?? '操作未完成。已保留编辑内容，请检查连接状态或重新读取最新设置。'); }
    finally { setBusy(false); }
  };
  const selectRole = async name => {
    const result = await rpc('roles-select', { name });
    if (result.ok !== true || result.role !== name) throw new Error('ROLE_SELECTION_FAILED');
    const latest = await rpc('roles-list'); setRoles(latest);
    if (latest.current !== name) throw new Error('ROLE_SELECTION_UNCONFIRMED');
  };
  const deleteRole = () => {
    const name = role.name, active = roles?.current === name;
    setConfirm({ text: `将角色「${name}」移入回收站？${active ? '此角色正在使用，删除后会取消当前选用。' : ''}可从角色回收站恢复。`, action: () => run(async () => {
      const result = await rpc('roles-delete', { name, clearCurrent: active });
      if (result.ok !== true) throw new Error(result.error ?? 'ROLE_DELETE_FAILED');
      const latest = await rpc('roles-list'); setRoles(latest);
      if (latest.roles.includes(name)) throw new Error('ROLE_DELETE_UNCONFIRMED');
      setRole({ name: '', content: '', existing: false }); setRoleDirty(false); setActiveSheet(null);
    }, '角色已移入回收站，可以恢复。') });
  };
  const save = () => run(async () => {
    if (roleDirty) { setFeedback('角色卡有未保存的编辑，请先保存角色卡，再保存并选用。'); return; }
    if (!dirty && snapshot.value?.workspaceEnabled === true && rolePending) {
      await selectRole(role.name); setFeedback(`已选用角色：${role.name}。下一条消息生效。`); return;
    }
    const candidate = structuredClone(draft);
    for (const key of ['private', 'groups']) for (const field of ['ids', 'exclude']) {
      candidate.scope[key][field] = candidate.scope[key].mode === 'disabled' || field === 'ids' && candidate.scope[key].mode !== 'selected'
        ? [] : String(scopeText[key + '.' + field] ?? '').trim().split(/[\s,，、]+/u).filter(Boolean);
    }
    const value = normalizeWorkspaceSettings(candidate);
    const accepted = await form.mutate([{ op: 'set', path: ['workspaceEnabled'], value: true },
      { op: 'set', path: ['workspace'], value }, { op: 'set', path: ['mode'], value: mode }], revision);
    if (!accepted) { setFeedback('设置已被另一处修改。编辑内容仍保留，请重新读取后合并。'); return; }
    setDirty(false); setDraft(value);
    const saved = form.getSnapshot(); setRevision(saved.revision);
    try {
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
      const settingsDigest = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
      const result = await rpc('apply', { revision: saved.revision ?? revision, settingsDigest });
      setRuntime(result);
      if (rolePending) {
        try { await selectRole(role.name); }
        catch { setWaitingForApply(false); setFeedback('设置已保存；角色选用未确认，请重新读取角色列表后重试。'); return; }
      }
      setWaitingForApply(result.application?.status === 'applying_bridge' || result.application?.status === 'pending_connection');
      setFeedback(result.application?.status === 'applied' ? '已保存，当前连接已生效。'
        : result.application?.status === 'applying_bridge' ? '已保存，网关许可已更新，正在同步模型与发送队列。'
        : result.application?.status === 'failed' ? '已保存；当前连接应用失败，请检查运行记录后重试。' : '已保存，将在QQ连接准备时应用。');
    } catch { setFeedback('设置已保存；当前连接未确认生效，请在运行记录检查后重试应用。'); }
  });
  const loadRoles = () => run(async () => {
    setRoles(await rpc('roles-list')); const cards = await rpc('roles-library'); setLibrary(cards.entries ?? []);
  }, '角色列表已更新。');
  const loadVoice = () => {
    openDetails('voice');
    if (voice || busy) return;
    void run(async () => {
      setSheetLoad(previous => ({ ...previous, voice: 'loading' }));
      try { const value = await rpc('voice-state'); setVoice(value); setVoiceDraft(value.config ?? {}); }
      catch { setSheetLoad(previous => ({ ...previous, voice: 'failed' })); throw new Error('VOICE_CONFIGURATION_UNAVAILABLE'); }
    }, '语音配置已读取。');
  };
  const loadImages = () => {
    openDetails('images');
    if (images || busy) return;
    void run(async () => {
      setSheetLoad(previous => ({ ...previous, images: 'loading' }));
      try { const value = await rpc('images-state'); setImages(value.generation); setImageDraft(value.generation?.settings ?? {}); }
      catch { setSheetLoad(previous => ({ ...previous, images: 'failed' })); throw new Error('IMAGE_CONFIGURATION_UNAVAILABLE'); }
    }, '图片配置已读取。');
  };
  const changeTab = next => {
    if(managementBusy)return;
    if(tab==='management'&&next!==tab&&managementDirty){setConfirm({text:'资料管理中还有未保存的编辑，确定放弃并离开吗？',action:()=>{setManagementDirty(false);setTab(next);}});return;}
    setTab(next);
  };
  const toggle = (title, checked, change, disabled = false) => h('label', { className: 'qqw-check' },
    h('input', { type: 'checkbox', role: title === '启用此模块' ? 'switch' : undefined, checked,
      disabled: !editable || disabled, onChange: event => change(event.target.checked) }), h('span', null, title));
  const moduleCard = module => {
    const value = draft.modules[module.id], selected = Object.values(value.options).filter(Boolean).length;
    const textOn = draft.modules.messages.enabled && draft.modules.messages.options.send;
    const groupsOn = draft.scope.groups.mode !== 'disabled', warnings = [];
    if (value.enabled) {
      if (module.id === 'images' && (value.options.send || value.options.generate) && !textOn) warnings.push('发送图片和绘图等待文字回复许可。');
      if (module.id === 'images' && value.options.generate && !value.options.send) warnings.push('绘图还需要选择发送图片。');
      if (module.id === 'images' && value.options.collect && !value.options.receive) warnings.push('收藏聊天表情需要先允许接收图片。');
      if (module.id === 'images' && value.options.favorites && (!value.options.send || !textOn)) warnings.push('可读取QQ收藏；发表情还需要文字回复和发送图片许可。');
      if (module.id === 'voice' && value.options.send && !textOn) warnings.push('语音回复等待文字回复许可。');
      if (module.id === 'groups' && selected && !groupsOn) warnings.push('群管理等待群聊范围授权。');
      if (module.id === 'groups' && value.options.atAll && !textOn) warnings.push('全体成员提醒等待文字回复许可。');
      if (module.id === 'friends' && value.options.accept && !value.options.receive) warnings.push('自动通过等待接收新申请许可。');
      if (module.id === 'idle' && value.options.enabled && (!textOn || !groupsOn)) warnings.push('冷场互动等待文字回复和群聊范围授权。');
      if (module.id === 'profile' && value.options.avatar && !(draft.modules.images.enabled &&
          (draft.modules.images.options.receive || textOn && draft.modules.images.options.send))) warnings.push('修改头像等待图片模块的收图或发图许可。');
    }
    return h('details', { className: 'qqw-module', 'data-module':module.id, key: module.id, open: openModules[module.id] === true,
      onToggle: event => { const open = event.currentTarget.open;
        setOpenModules(previous => previous[module.id] === open ? previous : { ...previous, [module.id]: open }); } }, h('summary', null,
      h('span', { className: 'qqw-module-title' }, h('span', { className: 'qqw-module-icon' }, h(Icon, { name: module.id })),h('span',null,module.label,h('small',{className:'qqw-module-flavor'},({messages:'心语信笺',images:'幻彩画室',voice:'潮汐旋律',friends:'相遇邀请',groups:'守护结界',profile:'专属名片',idle:'午后絮语',qzone:'星光日记'})[module.id]))), h('span', { className: 'qqw-module-count', 'data-enabled': value.enabled }, `${value.enabled ? '启用' : '暂停'} · ${selected}/${Object.keys(value.options).length}项`),
      h('svg', { className: 'qqw-chevron', 'aria-hidden': true, width: 16, height: 16, viewBox: '0 0 16 16' },
        h('path', { d: 'M4 6l4 4 4-4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }))),
      h('div', { className: 'qqw-module-body' }, note(module.description), toggle('启用此模块', value.enabled, checked => edit(next => { next.modules[module.id].enabled = checked; })),
        h('div', { className: 'qqw-actions' }, ...[['select-all', '全选本模块'], ['clear-all', '清空选择']].map(([action, label]) =>
          button(label, () => { setDraft(previous => updateWorkspaceModule(previous, module.id, action)); setDirty(true); }, !editable))),
        h('div', { className: 'qqw-options' }, ...Object.entries(module.options).map(([key, label]) => toggle(label, value.options[key], checked =>
          edit(next => { next.modules[module.id].options[key] = checked; })))),
        !value.enabled && note('模块暂停时，子项偏好会保留。'), ...warnings.map(text => note(text)),
        module.id === 'voice' && h('div', { className: 'qqw-module-extra' }, note('原声语义分析仍在开发；转写理解与原声分析分别验收。'), button('模型、声音与预热', loadVoice, busy)),
        module.id === 'images' && h('div', { className: 'qqw-module-extra' }, button('图片生成供应商', loadImages, busy)),
        module.id === 'friends' && note('自动通过会处理本次收到的普通新申请，不会扩大聊天授权。主动从群成员添加好友仍在核实接口，暂不提供可用开关。'),
        module.id === 'idle' && button('静默、冷却与次数', () => openDetails('idle'), busy),
        module.id === 'qzone' && button('可见范围与预算', () => openDetails('qzone'), busy)));
  };

  const sheetTitles = { voice: '模型、声音与预热', images: '图片生成供应商', idle: '静默、冷却与次数', qzone: '可见范围与预算', role: '编辑角色卡' };
  const unavailableSheet = kind => h('div', { className: 'qqw-editor', 'aria-busy': busy },
    h('p', { className: 'qqw-note', role: sheetLoad[kind] === 'failed' ? 'alert' : 'status' },
      sheetLoad[kind] === 'failed' ? '暂时未读到配置。请在“连接与授权”中确认QQ连接已就绪，再重试读取。' : '正在读取配置…'),
    sheetLoad[kind] === 'failed' && button('重试读取', kind === 'voice' ? loadVoice : loadImages, busy));
  const sheetContent = activeSheet === 'voice' && !voice ? unavailableSheet('voice')
    : activeSheet === 'images' && !images ? unavailableSheet('images')
    : activeSheet === 'voice' ? (h('div', { className: 'qqw-editor' },
            note(phaseName(voice.voice?.phase) + (Number.isInteger(voice.voice?.warmupMs) ? ` · 本次预热 ${(voice.voice.warmupMs / 1000).toFixed(1)} 秒` : '')),
            ...[['selectedVoice', '声音清单路径'], ['asrModel', '识别模型目录']].map(([key, title]) => h(Field, { key, title, value: voiceDraft[key], disabled: busy,
              change: text => setVoiceDraft(previous => ({ ...previous, [key]: text })) })),
            h('details', null, h('summary', null, '高级资源路径'), ...[['python', 'Python程序'], ['engine', '语音引擎目录'], ['pretrained', '预训练资源目录'], ['ffmpeg', '音视频工具路径']].map(([key, title]) =>
              h(Field, { key, title, value: voiceDraft[key], disabled: busy, change: text => setVoiceDraft(previous => ({ ...previous, [key]: text })) }))),
            h('div', { className: 'qqw-actions' }, button('校验并应用声音', () => setConfirm({ text: '应用新的声音配置并预热？期间优先使用文字，预热失败会尝试恢复原配置。',
              action: () => run(async () => { await rpc('voice-validate', { config: voiceDraft }); await rpc('voice-apply', { config: voiceDraft, revision: voice.revision }); }, '语音切换已开始，请等状态变为就绪后试听。') }), busy),
              button('恢复上一配置', () => setConfirm({ text: '恢复上一份语音配置？', action: () => run(() => rpc('voice-restore', { revision: voice.revision }), '恢复已开始。') }), busy || !voice.canRestore)),
            h(SingingPanel, { rpc })))
    : activeSheet === 'images' ? (h('div', { className: 'qqw-editor' },
          note(images.configured ? '供应商已配置，保存不会发起试生成。' : '尚未配置供应商。'),
          h('label', { className: 'qqw-field' }, h('span', null, '生成服务'), h('select', { value: imageDraft.provider ?? 'openai', disabled: busy,
            onChange: event => { setApiKey(''); setImageDraft(event.target.value === 'hf-flux-schnell-public'
              ? { provider: 'hf-flux-schnell-public', endpoint: 'https://black-forest-labs-flux-1-schnell.hf.space/gradio_api/call/infer',
                model: 'FLUX.1-schnell', size: '1024x1024', quality: '', responseFormat: 'default' }
              : { provider: 'openai', endpoint: '', model: '', size: '', quality: '', responseFormat: 'default' }); } },
            h('option', { value: 'openai' }, 'Images 兼容 API'), h('option', { value: 'hf-flux-schnell-public' }, '免费 FLUX 试用'))),
          imageDraft.provider === 'hf-flux-schnell-public' && note('免费公共试用无需密钥，可能排队、限额或暂停。请勿提交敏感内容。'),
          ...[['endpoint', '生成API地址'], ['model', '图像模型ID'], ['size', '尺寸（可留空）'], ['quality', '质量（可留空）']].map(([key, title]) => h(Field, { key, title, value: imageDraft[key], disabled: busy,
            change: text => setImageDraft(previous => ({ ...previous, [key]: text })), ...(imageDraft.provider === 'hf-flux-schnell-public' ? { disabled: true } : {}) })),
          h(Field, { title: '本次API密钥', type: 'password', value: apiKey, disabled: busy || imageDraft.provider === 'hf-flux-schnell-public', change: setApiKey }),
          imageDraft.provider !== 'hf-flux-schnell-public' && note('密钥只在本次进程内存中使用。'),
          button('保存本次供应商配置', () => run(async () => { const result = await rpc('images-apply', { settings: imageDraft,
            ...(apiKey ? { apiKey } : {}), expectedRevision: images.revision }); setApiKey(''); setImages(result.generation); setImageDraft(result.generation?.settings ?? {}); }, '本次供应商配置已保存。'), busy)))
    : activeSheet === 'idle' ? (h('details', { open: true, className: 'qqw-sheet-section' }, h('summary', null, '静默、冷却与次数'),
          ...[['idleMinutes', '静默分钟'], ['cooldownMinutes', '冷却分钟'], ['dailyLimit', '单群每日次数'], ['globalDailyLimit', '全部群每日次数']].map(([key, title]) =>
            h(Field, { key, title, type: 'number', value: draft.idle[key], disabled: !editable, change: text => edit(next => { next.idle[key] = Number(text); }) })),
          toggle('启用安静时段', draft.idle.quietEnabled, value => edit(next => { next.idle.quietEnabled = value; })),
          ...[['quietStart', '安静开始'], ['quietEnd', '安静结束']].map(([key, title]) => h(Field, { key, title, type: 'time', value: draft.idle[key], disabled: !editable,
            change: text => edit(next => { next.idle[key] = text; }) }))))
    : activeSheet === 'qzone' ? (h('details', { open: true, className: 'qqw-sheet-section' }, h('summary', null, '可见范围与预算'),
          h('label', { className: 'qqw-field' }, h('span', null, '说说可见范围'), h('select', { value: draft.qzone.audience, disabled: !editable,
            onChange: event => edit(next => { next.qzone.audience = event.target.value; }) }, ...[['self', '仅自己'], ['friends', '好友'], ['public', '公开']].map(([value, label]) => h('option', { key: value, value }, label)))),
          ...[['cooldownMinutes', '冷却分钟'], ['dailyLimit', '每日次数']].map(([key, title]) => h(Field, { key, title, type: 'number', value: draft.qzone[key], disabled: !editable,
            change: text => edit(next => { next.qzone[key] = Number(text); }) }))))
    : activeSheet === 'role' ? (h('div', { className: 'qqw-editor' }, h(Field, { title: '角色名称', value: role.name, disabled: busy || role.existing, change: value => { setRole(previous => ({ ...previous, name: value })); setRoleDirty(true); } }),
h(Field, { title: '角色卡正文', value: role.content, multiline: true, disabled: busy, change: value => { setRole(previous => ({ ...previous, content: value })); setRoleDirty(true); } }),
h('details', null, h('summary', null, '按聊天模式预览'), h('label', { className: 'qqw-field' }, h('span', null, '预览模式'),
        h('select', { value: previewMode, onChange: event => setPreviewMode(event.target.value) }, ...[['v1', '普通聊天 / 一代仿真'], ['v2', '二代仿真']].map(([value, label]) => h('option', { key: value, value }, label)))),
        note(`原文 ${role.content.length} 字符 · 本模式 ${roleCard.roleCharStats(role.content)[previewMode] ?? 0} 字符 · 注入上限 ${roles.limits?.injectMaxChars ?? 8000} 字符`),
        h('textarea', { readOnly: true, 'aria-label': '实际模式注入预览', value: roleCard.renderRoleInjection(role.content, previewMode, roles.limits?.injectMaxChars ?? 8000) })),
h('div', { className: 'qqw-actions' }, button('保存角色卡', () => run(async () => {
        const result = await rpc(role.existing ? 'roles-update' : 'roles-create', { name: role.name, content: role.content });
        if (result.ok !== true) throw new Error('ROLE_SAVE_FAILED');
        setRole(previous => ({ ...previous, existing: true })); setRoleDirty(false); setRoles(await rpc('roles-list'));
      }, '角色卡已保存；选择后才会应用。'), busy || !roleDirty),
        button('选用此角色', () => setConfirm({ text: '将此角色应用到QQ聊天？当前模型与声音保持原配置。', action: () => run(() => selectRole(role.name), '角色已选用，下一条消息生效。') }), busy || !role.existing || roleDirty),
        button('删除角色卡', deleteRole, busy || !role.existing || roleDirty)))) : null;
  const diagnostic = runtime?.diagnostics?.diagnostics ?? runtime?.diagnostics;
  const failedStage = diagnostic?.gateway?.native?.startStage;
  const failureTitle = ({ group_admin: '群管理能力初始化未完成', friend_requests: '好友申请能力初始化未完成',
    self_profile: '自身资料能力初始化未完成', listener_registration: '消息监听初始化未完成' })[failedStage];
  const connectionFailed = !!failureTitle || diagnostic?.outcome === 'failed' || runtime?.gateway?.status === 'failed';
  const visibleModules = WORKSPACE_MODULES.filter(module => (module.label + module.description).includes(moduleSearch.trim()));
  const pageHeading = (title, description) => h('div', { className: 'qqw-section-heading' }, h('div', null, h('h2', null, title), description && note(description)));
  const connectionNotice = () => connectionFailed && h('div', { className: 'qqw-notice', role: 'status' },
    h('strong', null, failureTitle ?? '上一次QQ连接准备未完成'),
    note('现有偏好仍保留。先查看运行记录中的失败阶段，确认后再由本人重新准备连接。'));
  const recoveryNotice = () => {
    if (runtime?.bridge?.repliesBlocked) return h('div', { className: 'qqw-recovery', role: 'status' }, h('div', null,
      h('strong', null, 'QQ已连接，回复通道正在恢复'),
      note(runtime.bridge.policyRecoveryFailed ? '旧模型任务尚未确认停止，当前暂停处理新消息。持续无法恢复时，请使用“服务救援.cmd”重启服务。'
        : '正在重新核验QQ权限与旧模型任务，确认完成后恢复回复。')));
    if (runtime?.healthCheck) return h('div', { className: 'qqw-recovery', role: 'status' }, h('div', null,
      h('strong', null, '服务进程仍在，正在重新确认状态'),
      note('检查暂时未完成，服务没有因此被强制停止。稍后会自动重新检查；持续无法回复时，可使用“服务救援.cmd”。'),
      note('诊断编号：' + runtime.healthCheck.code)));
    const disconnected = runtime && runtime.gateway?.status !== 'ready';
    if (!disconnected && healthMisses < 2) return null;
    return h('div', { className: 'qqw-recovery', role: 'status' }, h('div', null,
      h('strong', null, healthMisses >= 2 ? '暂时联系不上服务' : '工作台还在，QQ需要重新连接'),
      note(healthMisses >= 2 ? '双击项目目录中的“服务救援.cmd”，它会检查服务并显示恢复按钮。' : '点击后准备本人连接页面；如果QQ要求扫码或验证，请按页面提示完成。'),
      note('原模型、声音、角色和会话会保留。')),
      disconnected && button('前往连接管理',()=>changeTab('connection'),busy,true));
  };

  let content;

  if (tab === 'overview') content = h('section', { className: 'qqw-overview' },
    h('div', { className: 'qqw-welcome' },
      h('div', null, h(OceanMotion), h('p', { className: 'qqw-eyebrow' }, '和大肥鱼一起，慢慢聊'),
        h('h2', null, '把喜欢的能力，装进这个小窝'),
        note('聊天、角色、声音和图片都在这里。先确认连接，再挑几项常用能力。'),
        button('管理连接与授权', () => changeTab('connection'), false, true)),
      h('button', { type:'button',className: 'qqw-hero-link', onClick:()=>setArtOpen(true), 'aria-label': '查看大肥鱼完整插画' },
        h('img', { className: 'qqw-hero-art', src: WORKSPACE_HERO_ART, alt: '月光星海旁，蓝发鲸尾女仆大肥鱼向你挥手。', width: 1536, height: 1024, fetchPriority: 'high' }),
        h('span', { className: 'qqw-hero-caption' }, '查看完整插画', h(Icon, { name: 'expand', size: 16 })))),
    connectionNotice(),
    recoveryNotice(),
    h('div', { className: 'qqw-status-grid' }, ...[
      ['connection', 'QQ连接', runtime ? phaseName(runtime.gateway?.status) : '正在确认', '由本人开始连接'],
      ['overview', 'DSH宿主', runtime ? phaseName(runtime.dsh?.status) : '正在确认', '模型回复仍需真实对话确认'],
      ['messages', '聊天桥接', runtime ? phaseName(runtime.bridge?.status) : '正在确认', '接收与发送按当前授权执行']
    ].map(([icon, title, value, hint]) => h('div', { key: title, className: 'qqw-status-card' },
      h('span', { className: 'qqw-status-icon' }, h(Icon, { name: icon })),
      h('div', null, h('span', { className: 'qqw-eyebrow' }, title), h('strong', null, value), note(hint))))),
    h('div', { className: 'qqw-card' }, pageHeading('今天的连接', '设置保存、运行中应用和真实效果，会分别确认。'),
      h('div', { className: 'qqw-health-line' }, h('span', { className: 'qqw-soft-badge' },
        runtime?.application?.status === 'applied' ? '当前连接已应用' : '等待确认应用结果'),
        note(runtime?.voice ? '语音预热：' + phaseName(runtime.voice.phase) +
          (Number.isInteger(runtime.voice.warmupMs) ? ' · 本次 ' + (runtime.voice.warmupMs / 1000).toFixed(1) + ' 秒' : '') : '语音服务尚未开始')),
      runtime?.suspended?.send && h('div', { className: 'qqw-notice' }, '已有发送结果未确认，发送仍暂停；请先核对实际收发结果。'),
      h('div', { className: 'qqw-shortcuts' }, ...[
        ['chat', '挑一张角色卡', '选择聊天模式和角色'],
        ['capabilities', '整理能力小窝', '开关、声音和绘图配置'],
        ['activity', '看看运行记录', '从失败阶段找到原因']
      ].map(([key, title, hint]) => h('button', { key, type: 'button', onClick: () => changeTab(key), className: 'qqw-shortcut' },
        h(Icon, { name: key }), h('span', null, h('strong', null, title), h('small', null, hint)), h(Icon, { name: 'arrow', size: 18 }))))));

  if (tab === 'connection') content = h('section', { className: 'qqw-connection' },
    pageHeading('连接与授权', '让大肥鱼知道，可以在哪里和你聊天。'),
    connectionNotice(),
    h('div', { className: 'qqw-card qqw-login-card' },
      h('div', { className: 'qqw-login-heading' }, h('span', { className: 'qqw-module-icon' }, h(Icon, { name: 'connection' })),
        h('div', null, h('h3', null, 'QQ连接'), note(runtime ? phaseName(runtime.gateway?.status) : '正在确认当前连接。'))),
      toggle('连接时优先复用有效登录态', draft.reuseLogin, value => edit(next => { next.reuseLogin = value; })),
      h(InlineLogin,{rpc,blocked:dirty||snapshot.value?.workspaceEnabled!==true,onConfirm:setConfirm}),
      snapshot.value?.workspaceEnabled !== true && note('请先保存初始授权与功能设置，再准备本人连接。'),
      note('只有QQ要求本人验证时才处理扫码；管理偏好会保留。')),
    pageHeading('允许哪些会话', '指定、全部或关闭，各自选择；排除名单始终优先。'),
    h('div', { className: 'qqw-scope-grid' }, ...[['private', '私聊'], ['groups', '群聊']].map(([key, title]) => h('fieldset', { key, className: 'qqw-scope' },
      h('legend', null, title), h('label', { className: 'qqw-field' }, h('span', null, title + '范围'), h('select', { value: draft.scope[key].mode, disabled: !editable,
        onChange: event => edit(next => { next.scope[key].mode = event.target.value; }) }, ...[['disabled', '关闭'], ['selected', '指定会话'], ['all', '全部在线会话']].map(([value, label]) => h('option', { key: value, value }, label)))),
      ...[['ids', '允许的号码'], ['exclude', '排除的号码']].filter(([field]) => draft.scope[key].mode !== 'disabled' && (field !== 'ids' || draft.scope[key].mode === 'selected'))
        .map(([field, label]) => h(Field, { key: field, title: label + '（每行一项）', multiline: true, value: scopeText[key + '.' + field], disabled: !editable,
          change: text => { setScopeText(previous => ({ ...previous, [key + '.' + field]: text })); setDirty(true); } }))))),
    note('全部模式仅处理本次在线到达的消息，不读取历史列表。'));
  if (tab === 'chat') content = h('section', { className: 'qqw-card qqw-chat' }, h('h2', null, '聊天模式'), h('label', { className: 'qqw-field' }, h('span', null, '当前模式'),
    h('select', { value: mode, 'aria-label': '当前模式', disabled: !editable, onChange: event => { setMode(event.target.value); setDirty(true); } },
      ...[['chat', '普通聊天'], ['reserved', '一代仿真'], ['reserved2', '二代仿真'], ['simulation', '仿真（兼容）'], ['closed-agent', '限定智能体']].map(([value, title]) => h('option', { key: value, value }, title)))),
    mode === 'closed-agent' && note('限定智能体的远程提问和审批在热改后保持关闭；需要这些交互时重新建立连接。普通聊天及QQ模块许可仍可热切换。'),
    h('h2', null, '角色卡'), button('读取角色列表', loadRoles, busy), roles && h('div', null,
      note(roles.current ? '当前角色：' + roles.current : '尚未选用角色卡'),
      rolePending && note('待选用角色：' + role.name + '。点击底部“保存并选用角色”生效。'),
      h('label', { className: 'qqw-field' }, h('span', null, '已有角色'), h('select', { value: role.existing ? role.name : '', 'aria-label': '已有角色', disabled: busy,
        onChange: event => { const name = event.target.value; if (!name) { setRole({ name: '', content: '', existing: false }); setRoleDirty(false); return; }
          return run(async () => { const value = await rpc('roles-content', { name }); if (value.ok === false) throw new Error('ROLE_READ_FAILED');
            setRole({ name: value.name, content: value.content, existing: true }); setRoleDirty(false); }, '已选择待应用角色；点击底部保存并选用，或打开编辑器。'); } },
        h('option', { value: '' }, '选择角色'), ...roles.roles.map(name => h('option', { key: name, value: name }, name)))),
      h('label', { className: 'qqw-field' }, h('span', null, '原始角色库'), h('select', { defaultValue: '', 'aria-label': '原始角色库', disabled: busy,
        onChange: event => run(async () => { const value = await rpc('roles-import', { name: event.target.value });
          let name = value.name.slice(0, 37) + '-副本', index = 1;
          while (roles.roles.includes(name)) { const suffix = '-副本' + ++index; name = value.name.slice(0, 40 - suffix.length) + suffix; }
          setRole({ name, content: value.content, existing: false }); setRoleDirty(true); setActiveSheet('role'); }, '已复制到编辑区，尚未保存或选用。') },
        h('option', { value: '' }, '复制到编辑区'), ...library.map(card => h('option', { key: card.name, value: card.name }, card.name)))),
      button('新建角色', () => { setRole({ name: '', content: '', existing: false }); setRoleDirty(true); openDetails('role'); }, busy),
      button('打开角色编辑器', () => openDetails('role'), busy || !role.name),
      button('删除角色卡', deleteRole, busy || !role.existing || roleDirty),
      (roles.deletedRoles?.length ?? 0) > 0 && h('details', null, h('summary', null, '角色回收站'),
        ...roles.deletedRoles.map(entry => h('div', { key: entry.restoreId, className: 'qqw-actions' }, h('span', null, entry.name),
          button('恢复「' + entry.name + '」', () => run(async () => {
            const result = await rpc('roles-restore', { restoreId: entry.restoreId });
            if (result.ok !== true) throw new Error(result.error ?? 'ROLE_RESTORE_FAILED');
            const latest = await rpc('roles-list'); setRoles(latest);
            if (!latest.roles.includes(entry.name)) throw new Error('ROLE_RESTORE_UNCONFIRMED');
          }, '角色卡已恢复；当前选用角色保持原设置。'), busy))))));

  if (tab === 'capabilities') content = h('section', null,
    pageHeading('按模块选择能力', '每一种本领都有自己的小开关。展开和收起只整理页面，不改变授权。'),
    h('div', { className: 'qqw-module-toolbar' },
      h('label', { className: 'qqw-search' }, h(Icon, { name: 'search', size: 19 }),
        h('input', { type: 'search', 'aria-label': '查找能力', placeholder: '找一找能力', value: moduleSearch, onChange: event => setModuleSearch(event.target.value) })),
      h('div', { className: 'qqw-actions' },
        h('button', { type: 'button', onClick: () => setOpenModules(Object.fromEntries(WORKSPACE_MODULES.map(module => [module.id, true]))) },
          h(Icon, { name: 'expand', size: 17 }), '全部展开'),
        h('button', { type: 'button', onClick: () => setOpenModules({}) },
          h(Icon, { name: 'collapse', size: 17 }), '全部收起'))),
    h('div', { className: 'qqw-module-grid' }, ...visibleModules.map(moduleCard)),
    visibleModules.length === 0 && h('div', { className: 'qqw-empty' }, h(FishLogo, { size: 62 }), h('h3', null, '这一项还没游过来'),
      note('试试模块名称，或者清空搜索看看全部能力。')));
  if(tab==='phone')content=h(PhoneSection,{rpc,navigate:changeTab,workspaceDirty:dirty});
  if(tab==='management')content=h(ManagementSection,{rpc,cache:managementCache,navigate:changeTab,onDirty:setManagementDirty,onBusy:setManagementBusy,initialSection:managementPage});
  if (tab === 'activity') content = h('section', { className: 'qqw-card qqw-activity' }, pageHeading('实时运行监控', '每3秒检查一次当前组件；超时显示未确认，不把旧状态当作在线。'), connectionNotice(),
    note(runtime?'最近检查：'+new Date(runtime.checkedAt??Date.now()).toLocaleTimeString('zh-CN')+' · 已运行 '+(runtime.uptimeSeconds==null?'—':Math.floor(runtime.uptimeSeconds/60)+' 分钟'):'检查暂未完成，正在重新连接…'),
    h('div',{className:'qqw-status-grid'},...['dsh','gateway','bridge'].map((key,i)=>h('article',{className:'qqw-status-card',key},h('div',null,h('span',null,['工作台','QQ网关','聊天桥接'][i]),h('strong',null,runtime?phaseName(runtime[key]?.status):'未确认'))))),
    h('div',{className:'qqw-traffic-grid'},...[['privateReceived','收到私聊'],['groupReceived','收到群消息'],['sentConfirmed','已确认发送'],['sendsUnknown','发送结果未知']].map(([key,label])=>h('article',{className:'qqw-status-card',key},h('div',null,h('span',null,label),h('strong',null,runtime?.traffic?.[key]??'—'))))),
    note('收发计数属于当前网关运行周期；连接不可读时显示“—”。'),
    h('div',{className:'qqw-actions'},button('立即检查',()=>run(async()=>{setRuntime(await rpc('state'));setHealthMisses(0);},'已重新检查组件状态。'),busy),button('管理QQ连接',()=>changeTab('connection')),button('电话诊断与恢复',()=>changeTab('phone'))),
    runtime&&h('div',{className:'qqw-notice'},'语音：'+phaseName(runtime.voice?.phase)+' · 设置：'+(({applied:'已应用',applying_bridge:'等待桥接确认',pending_connection:'等待QQ连接',failed:'应用失败'})[runtime.application?.status]??'等待确认')),
    Object.entries(runtime?.suspended??{}).some(([,v])=>v)&&note('部分操作因结果未知暂停；请先核对实际结果，不要重复发送。'),
    h('details',null,h('summary',null,'本页观察到的状态变化'),...events.map((row,i)=>note(row.time+' · '+row.value))),
    h('div',{className:'qqw-actions'},...[['activity','消息活动'],['tool-log','工具调用'],['usage','Token与费用']].map(([id,label])=>button(label,()=>{setManagementPage(id);changeTab('management');}))),
    recoveryNotice(),
    h('details',null,h('summary',null,'工作台本身无法打开时'),note('整套服务关闭后，页面不能启动自身。此时使用项目目录的“服务救援.cmd”；日常QQ连接和电话恢复可直接使用上方入口。')),
    note(runtime?.application?.error ? '设置应用未完成，请先核对连接后重试。' : '这里显示当前连接的诊断信息。'),
    button('重试应用已保存设置', () => run(async () => setRuntime(await rpc('apply', { revision: snapshot.revision })), '已重新核对应用结果。'), busy || !snapshot.value?.workspaceEnabled),
    h('details', null, h('summary', null, '展开阶段诊断'), h('pre', { className: 'qqw-diagnostics' }, JSON.stringify(runtime?.diagnostics ?? { status: 'unavailable' }, null, 2))));
  const sceneTitles={connection:['星海通行证','每一次相遇，都从这里开始。'],chat:['角色衣橱','把喜欢的性格，写进日常。'],management:['月光档案馆','小小的记忆，也值得珍藏。'],capabilities:['魔法工坊','为大肥鱼点亮新的本领。'],activity:['航行观测站','陪你照看每一段星海旅程。']};
  const sceneArt={connection:['connection-v3','大肥鱼与通行证守护徽章'],chat:['role-v3','大肥鱼的角色衣橱与镜子'],management:['library-v3','月牙上读书的大肥鱼'],capabilities:['workshop-v3','鲸鱼魔法瓶与羽毛笔'],activity:['observatory-v3','大肥鱼的星海观测站']};
  return h('div', { className: 'qqw','data-scene':tab }, h('div', { className: 'qqw-scroll' }, h('header', { className: 'qqw-header' }, h('div', { className: 'qqw-brand' }, h('span', { className: 'qqw-brand-mark qqw-character-avatar' }, h('img', { src: WORKSPACE_AVATAR_ART, alt: '大肥鱼' })),
    h('div', null, h('p', { className: 'qqw-eyebrow' }, 'DEEPSEEK · 和大肥鱼在一起'), h('h1', null, '大肥鱼的聊天小窝'), note('把日常，调成喜欢的频道。')))),
    h('nav', { className: 'qqw-nav', 'aria-label': 'QQ工作台分区' }, ...tabs.map(([key, title]) => h('button', { key, type: 'button',
      'aria-current': tab === key ? 'page' : undefined, disabled:managementBusy, onClick: () => changeTab(key) }, h(Icon, { name: key, size: 18 }), h('span', { className: 'qqw-nav-label' }, title)))),
    runtime?.fixture && note('隔离预览：合成状态，不连接QQ或模型。'),
    h('main', { className: 'qqw-main' },sceneTitles[tab]&&h('aside',{className:'qqw-story-banner','aria-label':sceneTitles[tab][0]},h('div',null,h('span',{className:'qqw-story-kicker'},'DEEP BLUE · 星海手记'),h('h2',null,sceneTitles[tab][0]),h('p',null,sceneTitles[tab][1])),h('img',{src:WORKSPACE_ART[sceneArt[tab][0]],alt:sceneArt[tab][1],width:150,height:150})),content)),
    !['phone','management'].includes(tab)&&h('footer', { className: 'qqw-footer' }, h('p', { role: 'status', 'aria-live': 'polite' }, feedback),
      dirty && snapshot.revision !== revision && note('已保存版本发生变化，当前编辑内容尚未覆盖它。'),
      h('div', { className: 'qqw-actions' }, button('重新读取设置', () => setConfirm({ text: '重新读取会替换尚未保存的偏好编辑，并重新读取当前角色。', action: () => { receiveSaved(); void loadRoles(); } }), !editable),
        button(rolePending ? '保存并选用角色' : dirty || snapshot.value?.workspaceEnabled !== true ? '保存并应用设置' : '设置已保存', save,
          !editable || !dirty && !rolePending && snapshot.value?.workspaceEnabled === true, true))),
    artOpen&&h(SettingsSheet,{title:'月光与大肥鱼',artwork:true,close:()=>setArtOpen(false),locked:false},h('img',{src:WORKSPACE_HERO_ART,alt:'大肥鱼星海主题完整插画',style:{width:'100%',height:'auto',borderRadius:16}})),
    activeSheet && h(SettingsSheet, { title: sheetTitles[activeSheet], close: () => setActiveSheet(null), locked: busy, opener: sheetOpener.current }, sheetContent),
    confirm && h(ConfirmDialog, { value: confirm, close: () => setConfirm(null) }));
}
const inject = ['slots', 'configForms', 'layout'];
function apply(ctx) {
  const form = ctx.configForms.get('qq-mode');
  const rpc = async (operation, payload = {}) => {
    const response = await fetch('/api/qq-workspace', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-QQ-Local-Action': '1' }, body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(12000) });
    const result = await response.json(); if (!response.ok || result.ok !== true) throw new Error('WORKSPACE_OPERATION_FAILED'); return result.value;
  };
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = WORKSPACE_CSS; style.dataset.qqWorkspace = '1'; document.head.append(style);
    return () => style.remove();
  });
  ctx.effect(() => ctx.configForms.whileServed(['qq-mode'], () => ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({ name: 'main', key: 'qq-workspace', inject: () => ({ form, rpc }) }, Workspace);
    let active = true;
    queueMicrotask(() => { if (active && location.hash === '#qq-workspace') ctx.layout.selectPanel('qq-workspace'); });
    return () => { active = false; dispose(); };
  })));
  ctx.effect(() => ctx.configForms.whileServed(['qq-mode'], () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'qq-workspace', order: 15, label: () => 'QQ工作台' }, ({ size }) => h(FishLogo, { size })))));
}
return { inject, apply };
}
