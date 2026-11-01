// 本人工作台资料页面；只调用固定RPC，不读取令牌或构造任意后端URL。
/** 浏览器当前工作台内的只读资料缓存；同请求合并，失效后迟到响应不得回填。不持久化。 */
function createManagementCache(rpc){
 const entries=new Map(),pending=new Map(),versions=new Map();
 const id=(section,key='')=>section+':'+key;
 return {peek:(section,key='')=>entries.get(id(section,key)),
  invalidate(section,key=''){const name=id(section,key);versions.set(name,(versions.get(name)||0)+1);entries.delete(name);pending.delete(name);},
  async read(section,key='',force=false){
   const name=id(section,key),cached=entries.get(name);
   if(!force&&cached&&Date.now()-cached.at<60000)return cached;
   if(pending.has(name))return pending.get(name);
   const version=versions.get(name)||0;
   const request=rpc('data-'+section,key?{key}:{}).then(value=>{if(value?.ok===false)throw Error('DATA_UNAVAILABLE');const entry={value,at:Date.now()};if((versions.get(name)||0)===version)entries.set(name,entry);return entry;}).finally(()=>{if(pending.get(name)===request)pending.delete(name);});
   pending.set(name,request);return request;
  }};
}
function createManagementSection({h,useState,useEffect,useRef,button,note,Field}){
 const sections=[['sessions','会话与联系人'],['states','会话状态'],['memory','会话记忆'],['prompt','初始提示词'],['slang','流行语'],['pending','待处理请求'],['usage','用量统计'],['usage-recent','最近用量'],['activity','消息活动'],['tool-log','工具记录'],['feedback','反馈记录']];
 const list=value=>Array.isArray(value)?value:[];
 const text=value=>value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);
 const peer=value=>text(value).replace(/^private:/,'私聊 · ').replace(/^group:/,'群聊 · ');
 const time=value=>Number(value)>0&&Number.isFinite(new Date(Number(value)).getTime())?new Date(Number(value)).toLocaleString('zh-CN',{hour12:false}):'—';
 const money=value=>Number.isFinite(Number(value))?Number(value).toFixed(4):'—';
 const table=(columns,rows)=>rows.length?h('div',{className:'qqw-table-scroll'},h('table',null,
  h('thead',null,h('tr',null,...columns.map(([key,label])=>h('th',{key,scope:'col'},label)))),
  h('tbody',null,...rows.map((row,i)=>h('tr',{key:i},...columns.map(([key])=>h('td',{key},key==='key'?peer(row[key]):text(row[key])))))))):
  h('div',{className:'qqw-empty'},h('strong',null,'这里还没有记录'),note('有对应活动后会显示在这里。'));
 return function ManagementSection({rpc,cache,navigate,onDirty=()=>{},onBusy=()=>{},initialSection='sessions'}){
  const [section,setSection]=useState(initialSection),[sessions,setSessions]=useState([]),[key,setKey]=useState(''),[data,setData]=useState(null);
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[query,setQuery]=useState('');
  const [draft,setDraft]=useState(''),[dirty,setDirty]=useState(false),[edit,setEdit]=useState(null),[confirm,setConfirm]=useState(null);
  const [slang,setSlang]=useState({content:'',meaning:'',usage:'',example:''});
  const epoch=useRef(0),alive=useRef(false);
  useEffect(()=>{onDirty(dirty||!!edit);return()=>onDirty(false);},[dirty,edit,onDirty]);
  useEffect(()=>{onBusy(saving);return()=>onBusy(false);},[saving,onBusy]);
  useEffect(()=>{alive.current=true;cache.read('sessions').then(({value:r})=>{if(alive.current){setSessions(list(r.sessions));setKey(list(r.sessions)[0]?.key??'');}}).catch(()=>{});return()=>{alive.current=false;epoch.current++;};},[cache]);
  useEffect(()=>{let stopped=false;const queue=['usage','states','usage-recent','pending','slang','activity','tool-log','feedback'];const warm=async()=>{while(queue.length&&!stopped){try{await cache.read(queue.shift());}catch{}}};void warm();void warm();return()=>{stopped=true;};},[cache]);
  const scopedKey=['memory','prompt'].includes(section)?key:'';
  const load=async(force=false)=>{
   if(['memory','prompt'].includes(section)&&!key){setData(null);setLoading(false);setMessage('请选择会话。');return;}
   const version=++epoch.current,cached=cache.peek(section,scopedKey);setData(cached?.value??null);setLoading(true);setMessage(cached?'已显示上次读取的资料，正在核对更新…':'正在读取…');
   if(cached&&section==='prompt')setDraft(cached.value.text??'');
   try{const entry=await cache.read(section,scopedKey,force),r=entry.value;if(!alive.current||version!==epoch.current)return;
    if(r?.ok===false)throw Error();setData(r);if(section==='sessions'){setSessions(list(r.sessions));if(!key)setKey(list(r.sessions)[0]?.key??'');}if(section==='prompt'){setDraft(r.text??'');setDirty(false);}
    setMessage('读取于 '+new Date(entry.at).toLocaleTimeString('zh-CN',{hour12:false})+' · 点击刷新可获取最新资料');return true;
   }catch{if(alive.current&&version===epoch.current){setMessage(cached?'更新失败，当前为上次读取的资料。请稍后重试。':'暂时读取失败，请检查连接后重试。');}return false;}
   finally{if(alive.current&&version===epoch.current)setLoading(false);}
  };
  useEffect(()=>{setEdit(null);setDirty(false);void load();return()=>{epoch.current++;};},[section,scopedKey,cache]);
  const change=action=>{if(dirty||edit)setConfirm({text:'当前编辑尚未保存，确定放弃并切换吗？',action:()=>{setDirty(false);setEdit(null);action();}});else action();};
  const mutate=async(op,payload)=>{
   if(saving)return;setSaving(true);const version=epoch.current;
   try{const r=await rpc('data-'+op,payload);cache.invalidate(section,scopedKey);if(!alive.current||version!==epoch.current)return;if(r?.ok===false)throw Error();setDirty(false);setEdit(null);if(op==='slang-add')setSlang({content:'',meaning:'',usage:'',example:''});const loaded=await load(true);if(alive.current)setMessage(loaded?'已保存。':'保存已确认，重新读取暂未成功，请稍后刷新。');}
   catch{cache.invalidate(section,scopedKey);if(alive.current&&version===epoch.current)setMessage('保存未确认，编辑内容已保留。请先重新核对状态。');}
   finally{if(alive.current)setSaving(false);}
  };
  let body;
  if(section==='sessions'){
   const rows=list(data?.sessions).filter(x=>text(x.key).includes(query)).map(x=>({...x,type:String(x.key).startsWith('group:')?'群聊':'私聊',owner:x.owner?'管理员':'普通会话'}));
   body=h('div',null,note('这里只列出已建立的会话。好友申请与群管理权限仍在“能力设置”中管理。'),
    h(Field,{title:'搜索会话',value:query,change:setQuery}),table([['key','会话'],['type','类型'],['owner','身份']],rows),
    h('div',{className:'qqw-actions'},button('管理好友与群权限',()=>navigate('capabilities')),button('管理聊天角色',()=>navigate('chat'))));
  }else if(section==='states')body=h('div',null,note('当前内存中的会话状态。读取不会唤醒模型或发送消息；未读数不等同于QQ客户端未读数。'),
   h(Field,{title:'搜索会话状态',value:query,change:setQuery}),table([['key','会话'],['unreadCount','待处理消息'],['recentCount','近期消息'],['lastWakeReason','最近唤醒原因'],['lastAiReplyAt','最近AI回复'],['noActionCount','连续未回复次数']],list(data?.conversations).filter(x=>text(x.key).includes(query)).map(x=>({...x,lastAiReplyAt:time(x.lastAiReplyAt)}))));
  else if(section==='memory'){
   const raw=data?.raw??{};body=h('div',null,...[['activeTopic','进行中的话题',list(raw.activeTopics)],['pendingThought','待续想法',list(raw.pendingThoughts)]].map(([category,label,rows])=>
    h('section',{className:'qqw-data-section',key:category},h('h3',null,label),...rows.map((item,i)=>h('article',{className:'qqw-data-row',key:i},h('p',null,item.text),
      note(item.pendingQuestion??item.motivation??''),button('编辑',()=>change(()=>setEdit({category,oldContent:item.text,text:item.text})),saving))),!rows.length&&note('暂无记录。'))),
    h('h3',null,'成员印象'),note('编辑已有成员的印象，以逗号或顿号分隔，最多20条；成员名与互动次数保持。'),
    ...Object.entries(raw.memberImpressions??{}).map(([member,v])=>h('article',{className:'qqw-data-row',key:member},h('strong',null,member),h('p',null,list(v?.traits).join('、')||'暂无印象'),note('互动次数：'+(v?.interactionCount??0)),
     button('编辑成员印象',()=>change(()=>setEdit({category:'memberImpression',target:member,text:list(v?.traits).join('、')})),saving))),
    !Object.keys(raw.memberImpressions??{}).length&&note('暂无成员印象。'),
    edit&&h('section',{className:'qqw-card'},h(Field,{title:edit.category==='memberImpression'?'成员印象：'+edit.target:'记忆内容',value:edit.text,change:text=>setEdit({...edit,text}),multiline:true,maxLength:edit.category==='memberImpression'?16000:200,disabled:saving}),
     note(edit.category==='memberImpression'?edit.text.split(/[,，、]/).filter(x=>x.trim()).length+' / 20 条印象':edit.text.length+' / 200 字符'),
     h('div',{className:'qqw-actions'},button('保存记忆',()=>mutate('memory-update',{key,category:edit.category,...(edit.category==='memberImpression'?{target:edit.target}:{oldContent:edit.oldContent}),newContent:edit.text}),saving||!edit.text.trim()||(edit.category==='memberImpression'?(edit.text.length>16000||edit.text.split(/[,，、]/).filter(x=>x.trim()).length>20):edit.text.length>200),true),button('取消编辑',()=>change(()=>setEdit(null)),saving))));
  }else if(section==='prompt')body=h('div',null,note('初始提示词只在该会话首次唤醒时注入。修改不会清空当前会话，也不会立即触发模型。'),
   h(Field,{title:'此会话的初始提示词',value:draft,change:v=>{setDraft(v);setDirty(true);},multiline:true,disabled:saving||data?.writable===false}),
   note(draft.length+' 字符'+(data?.maxChars?' / 上限 '+data.maxChars:'')),button('保存提示词',()=>mutate('prompt-save',{key,text:draft}),saving||!dirty||data?.writable===false||draft.length>(data?.maxChars??16000),true));
  else if(section==='slang')body=h('div',null,note('确认后可用于聊天，驳回后不会使用。读取列表不会触发模型研究。'),
   h(Field,{title:'搜索流行语',value:query,change:setQuery}),...list(data?.entries).filter(x=>text(x.content).includes(query)).slice(0,100).map(x=>h('article',{className:'qqw-data-row',key:x.id},h('strong',null,x.content),note(x.meaning),note(({confirmed:'已确认',candidate:'候选',rejected:'已驳回'})[x.status]??'待确认'),
    h('div',{className:'qqw-actions'},button('确认使用',()=>mutate('slang-confirm',{ids:[x.id]}),saving||x.status==='confirmed'),button('驳回',()=>mutate('slang-reject',{ids:[x.id]}),saving||x.status==='rejected')))),
   h('details',null,h('summary',null,'添加流行语'),...Object.entries({content:'词语',meaning:'含义',usage:'用法',example:'示例'}).map(([k,label])=>h(Field,{key:k,title:label,value:slang[k],change:v=>{setSlang({...slang,[k]:v});setDirty(true);},disabled:saving})),button('添加候选',()=>mutate('slang-add',slang),saving||!slang.content.trim()||!slang.meaning.trim(),true)));
  else if(section==='pending')body=h('div',null,note('审批和模型提问请在对应QQ会话回复，避免在两处重复处理。'),table([['key','会话'],['kind','类型'],['detail','详情']],list(data?.pending).map(x=>({...x,kind:x.kind==='approval'?'审批':'提问',detail:x.kind==='approval'?[x.toolName,x.reason].filter(Boolean).join('：'):list(x.questions).map(q=>q.question).join(' / ')}))));
  else if(section==='usage'){
   const t=data?.totals??{};body=h('div',null,h('div',{className:'qqw-status-grid qqw-metrics'},...[
    ['总Token',Number(t.totalTokens??0).toLocaleString('zh-CN')],['对话轮数',Number(t.turns??0).toLocaleString('zh-CN')],['估算费用',(data?.symbol??'¥')+money(t.cost??0)]].map(([label,value])=>h('article',{className:'qqw-status-card',key:label},h('span',null,label),h('strong',null,value)))),
    note('费用以当前本地价目与已记录用量估算，以供应商账单为准。'),table([['key','会话'],['turns','轮数'],['cost','估算费用']],list(data?.conversations).map(x=>({...x,cost:(data?.symbol??'¥')+money(x.cost)}))));
  }else if(section==='usage-recent')body=h('div',null,note('最近40条采样，按时间倒序。一次对话可能有多条采样，费用为本地估算。'),
   h(Field,{title:'搜索用量会话或模型',value:query,change:setQuery}),table([['time','时间'],['key','会话'],['model','模型'],['turn','轮次'],['step','步骤'],['retry','重试'],['tokens','Token'],['cost','估算费用']],list(data?.entries).filter(x=>[x.key,x.model].some(v=>text(v).includes(query))).map(x=>({...x,key:x.key??'未归属会话',time:time(x.time),cost:(data?.symbol??'¥')+money(x.cost)}))));
  else if(section==='activity'){
   const activity=typeof data?.activity==='string'?data.activity:list(data?.activity).map(text).join('\n');
   body=h('div',null,note('最近的消息活动，按现有日志的脱敏结果显示。'),activity?h('pre',{className:'qqw-diagnostics'},activity):note('暂无消息活动。'));
  }
  else body=table(section==='tool-log'?[['time','时间'],['key','会话'],['tool','工具'],['status','结果']]:[['time','时间'],['key','会话'],['text','反馈']],list(data?.entries).map(x=>({...x,status:x.type==='result'?(x.ok===false?'失败':'成功'):'调用',text:x.text??x.feedback??x.reason??''})));
  return h('section',{className:'qqw-management'},h('div',{className:'qqw-page-heading'},h('div',null,h('h2',null,'资料与运行管理'),note('在当前工作台管理已有资料，原会话和配置保持。')),
    button(loading?'正在更新…':'刷新资料',()=>change(()=>void load(true)),loading||saving)),
   h('label',{className:'qqw-field qqw-mobile-data-nav'},h('span',null,'资料分区'),h('select',{'aria-label':'资料分区',value:section,disabled:saving,onChange:e=>{const id=e.target.value;change(()=>{setQuery('');setSection(id);});}},...sections.map(([id,title])=>h('option',{key:id,value:id},title)))),
   h('div',{className:'qqw-management-layout'},h('nav',{className:'qqw-subnav','aria-label':'资料管理分区'},...[
    ['会话档案',['sessions','states','memory','prompt']],['互动资料',['slang','pending']],['运行观察',['usage','usage-recent','activity','tool-log','feedback']]
   ].map(([label,ids])=>h('div',{className:'qqw-data-nav-group',key:label},h('span',{className:'qqw-nav-group-title'},label),...sections.filter(([id])=>ids.includes(id)).map(([id,title])=>h('button',{key:id,type:'button','aria-current':section===id?'page':undefined,disabled:saving,onClick:()=>{if(section!==id)change(()=>{setQuery('');setSection(id);});}},h('span',{'aria-hidden':true,className:'qqw-nav-spark'},'✦'),title))))),
   h('div',{className:'qqw-management-content'},h('h3',{className:'qqw-data-title'},sections.find(([id])=>id===section)?.[1]),
   ['memory','prompt'].includes(section)&&h('label',{className:'qqw-field'},h('span',null,'选择会话'),h('select',{value:key,disabled:saving,onChange:e=>change(()=>setKey(e.target.value))},h('option',{value:''},'选择已有私聊或群聊'),...sessions.map(x=>h('option',{key:x.key,value:x.key},peer(x.key))))),
   h('p',{role:'status',className:'qqw-note qqw-data-status'},message),data?h('fieldset',{className:'qqw-data-body',disabled:loading||saving},body):loading?h('div',{className:'qqw-skeleton','aria-label':'正在读取资料'},h('span'),h('span'),h('span')):note(['memory','prompt'].includes(section)&&!key?'先选择一个已有会话。':'当前没有可显示的数据；可以刷新资料。'),
   confirm&&h('div',{className:'qqw-card',role:'alert'},h('p',null,confirm.text),button('保留编辑',()=>setConfirm(null)),button('放弃并切换',()=>{const action=confirm.action;setConfirm(null);action();})))));
 };
}
