const own=(value,key)=>{try{return Object.getOwnPropertyDescriptor(value??{},key)?.value;}catch{return undefined;}};
const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
/**
 * 记录有界SDK事件形状，不保存载荷、账号、文本、音频、地址或关联号。
 * @param {object} options clock仅供隔离测试；limit限定最多保留的事件编号数。
 * @returns {object} observe和snapshot；不调用SDK，不改变电话生命周期。
 */
export function createSignalShapeObserver({clock=Date.now,limit=64}={}){
 if(typeof clock!=='function'||!Number.isInteger(limit)||limit<1||limit>64)throw Error('SIGNAL_SHAPE_CONFIG_INVALID');
 const rows=new Map();let ignored=0;
 return Object.freeze({
  observe(message){
   const command=own(message,'cmd');if(!Number.isSafeInteger(command)||command<0||command>65535){ignored=Math.min(ignored+1,1000000000);return;}
   let row=rows.get(command);if(!row&&rows.size>=limit){ignored=Math.min(ignored+1,1000000000);return;}
   const time=clock(),value=own(message,'value'),array=Array.isArray(value),arity=array?Math.min(own(value,'length')??0,64):null;
   const types=array?Array.from({length:Math.min(arity,12)},(_,i)=>kind(own(value,String(i)))):[kind(value)];
   if(!row){row={command,count:0,firstAt:time,lastAt:time,lastArity:arity,lastTypes:types};rows.set(command,row);}
   row.count=Math.min(row.count+1,1000000000);row.lastAt=time;row.lastArity=arity;row.lastTypes=types;
  },
  snapshot:()=>({events:[...rows.values()].map(row=>({...row,lastTypes:[...row.lastTypes]})),ignored}),
 });
}
