(() => {
'use strict';
const STORE='adjoy:cod:daily:v1';
const x=id=>document.getElementById(id);
const methods=['Cash','bKash','Nagad','Rocket','Bank Transfer','Other'];
const money=n=>'৳'+(n/100).toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2});
const pad=n=>String(n).padStart(2,'0');
const bdToday=()=>{const d=new Date(Date.now()+21600000);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())};
const uid=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
const parseMoney=s=>{if(!/^\d+(?:\.\d{1,2})?$/.test(String(s).trim()))return null;const v=Math.round(Number(s)*100);return Number.isSafeInteger(v)&&v>=0?v:null};
const centsToInput=v=>(v/100).toFixed(2);
function notice(s){x('codMessage').textContent=s;}
function defaultDay(){return {riders:Array.from({length:5},(_,i)=>({id:uid(),name:'Rider '+(i+1),cod:0,payments:[],remarks:'',sent:false})),agent:[]};}
let db={version:1,days:{}},day;
try{const d=JSON.parse(localStorage.getItem(STORE)||'null');if(d&&d.version===1&&d.days&&typeof d.days==='object')db=d;}catch(e){notice('Saved data could not be read; do not overwrite without restoring a backup.');}
x('codDate').value=bdToday();
const today=()=>x('codDate').value;
function current(){const k=today();if(!db.days[k])db.days[k]=defaultDay();return db.days[k];}
function persist(){localStorage.setItem(STORE,JSON.stringify(db));}
function sums(r){const paid=r.payments.reduce((n,p)=>n+p.amount,0);return {paid,diff:r.cod-paid};}
function el(tag,cls,content){const a=document.createElement(tag);if(cls)a.className=cls;if(content!==undefined)a.textContent=content;return a;}
function button(label,fn,cls=''){const b=el('button','cod-action '+cls,label);b.type='button';b.addEventListener('click',fn);return b;}
function field(label,value,handler,type='text'){const wrap=el('label');wrap.append(el('span','',label));const input=el('input');input.type=type;input.value=value;input.addEventListener('change',()=>handler(input.value,input));wrap.append(input);return wrap;}
function addPaymentForm(container,callback){const f=el('form','cod-entry-form');const method=el('select');for(const m of methods){const o=el('option','',m);o.value=m;method.append(o);}const amount=el('input');amount.type='number';amount.min='.01';amount.step='.01';amount.placeholder='0.00';amount.required=true;const ref=el('input');ref.maxLength=140;ref.placeholder='Reference / note';for(const [label,input] of [['Method',method],['Amount (BDT)',amount],['Reference',ref]]){const wrap=el('label');wrap.append(el('span','',label),input);f.append(wrap);}const b=el('button','btn btn-primary','+ Add Payment');b.type='submit';f.append(b);f.addEventListener('submit',e=>{e.preventDefault();const v=parseMoney(amount.value);if(v===null||v<=0)return alert('Enter a valid positive amount (maximum two decimals).');callback({id:uid(),method:method.value,amount:v,reference:ref.value.trim().slice(0,140)});f.reset();});container.append(f);}
function table(payments,onRemove){const scroll=el('div','cod-table-scroll'),tab=el('table','cod-table'),thead=el('thead'),head=el('tr');['Method','Amount','Reference','Action'].forEach(h=>head.append(el('th','',h)));thead.append(head);tab.append(thead);const body=el('tbody');if(!payments.length){const row=el('tr'),td=el('td','cod-empty','No payments recorded');td.colSpan=4;row.append(td);body.append(row);}payments.forEach(p=>{const row=el('tr');[p.method,money(p.amount),p.reference||'—'].forEach(t=>row.append(el('td','',t)));const action=el('td');action.append(button('Remove',()=>onRemove(p.id),'cod-danger'));row.append(action);body.append(row);});tab.append(body);scroll.append(tab);return scroll;}
function render(){
const d=current(),target=x('codRiders');target.replaceChildren();
for(const r of d.riders){
try { const ack=JSON.parse(localStorage.getItem('adjoy:cod-km-sent:v1')||'{}'); if(ack['cod-'+today()+'-'+r.id])r.sent=true; }catch(e){}
const card=el('article','cod-rider'),top=el('div','cod-rider-head'),title=el('h3','',r.name),actions=el('div','cod-rider-actions');const {paid,diff}=sums(r);
actions.append(button('Send Due to KM',()=>sendToKM(r.id)));actions.append(button('Remove Rider',()=>{if(r.payments.length||r.cod){if(!confirm('Delete '+r.name+' and all related daily entries?'))return;}d.riders=d.riders.filter(a=>a.id!==r.id);persist();render();},'cod-danger'));top.append(title,actions);card.append(top);
const fields=el('div','cod-rider-fields');
fields.append(field('Rider name',r.name,(v,inp)=>{if(!v.trim()){inp.value=r.name;return;}r.name=v.trim().slice(0,90);persist();render();}));
fields.append(field('Panel COD (BDT)',centsToInput(r.cod),(v,inp)=>{const n=parseMoney(v);if(n===null){alert('Invalid amount');inp.value=centsToInput(r.cod);return;}r.cod=n;persist();render();},'number'));
fields.append(field('Remarks',r.remarks,(v)=>{r.remarks=v.slice(0,300);persist();},'text'));card.append(fields);
const summary=el('div','cod-rider-summary');summary.append(el('span','', 'Collected: '+money(paid)),el('span',diff>0?'cod-positive':diff<0?'cod-negative':'',diff>0?'Due: '+money(diff):diff<0?'Overpaid: '+money(-diff):'Settled'));card.append(summary);
if(r.sent){card.append(el('small','cod-memo','COD due was previously sent to KM Tracker for this rider/date. Later edits are not synced automatically; reconcile any difference manually.'));}
card.append(table(r.payments,id=>{if(!confirm('Remove this payment?'))return;r.payments=r.payments.filter(p=>p.id!==id);persist();render();}));
addPaymentForm(card,p=>{r.payments.push(p);persist();render();});target.append(card);}
let total=0,collected=0,due=0,over=0;for(const r of d.riders){const s=sums(r);total+=r.cod;collected+=s.paid;due+=Math.max(0,s.diff);over+=Math.max(0,-s.diff);}
const agent=d.agent.reduce((n,p)=>n+p.amount,0);for(const [id,n] of [['codTotal',total],['codCollected',collected],['codDue',due],['codOver',over],['agentPaid',agent]])x(id).textContent=money(n);
const balance=collected-agent;x('agentBalance').textContent=(balance<0?'Overpaid ':'')+money(Math.abs(balance));x('agentBalance').style.color=balance<0?'#dc2626':'#172442';x('agentReconcile').textContent=balance>0?'Collect money held for agent: '+money(balance):balance<0?'Agent received '+money(-balance)+' more than recorded rider collections.':'All recorded collections have been settled with agent.';
const at=x('agentRows');at.replaceChildren();if(!d.agent.length){const tr=el('tr'),td=el('td','cod-empty','No agent payments recorded');td.colSpan=4;tr.append(td);at.append(tr);}for(const p of d.agent){const tr=el('tr');[p.method,money(p.amount),p.reference||'—'].forEach(v=>tr.append(el('td','',v)));const td=el('td');td.append(button('Remove',()=>{if(!confirm('Remove agent payment?'))return;d.agent=d.agent.filter(z=>z.id!==p.id);persist();render();},'cod-danger'));tr.append(td);at.append(tr);}
}
function sendToKM(id){const r=current().riders.find(z=>z.id===id);if(!r)return;
const sourceId='cod-'+today()+'-'+r.id;
try{
  const ack=JSON.parse(localStorage.getItem('adjoy:cod-km-sent:v1')||'{}');
  if(ack[sourceId])r.sent=true;
}catch(e){}
const amount=sums(r).diff;if(amount<=0)return alert('No outstanding COD due for this rider.');if(r.sent)return alert('Due was already sent for this rider/date. Adjust previously sent entry manually in KM Tracker.');const message='Record COD outstanding '+money(amount)+' for '+r.name+' on '+today()+' as a deduction from the rider KM balance? This is NOT a new KM earning and will not auto-adjust if you later collect more COD.';if(!confirm(message))return;
const payload={version:1,sourceId:'cod-'+today()+'-'+r.id,riderName:r.name,date:today(),amountCents:amount,createdAt:Date.now()};try{sessionStorage.setItem('adjoy:cod-km-handoff:v1',JSON.stringify(payload));}catch(e){return alert('Browser session storage unavailable.');}
const route='#page='+encodeURIComponent('pages/rider-km-tracker/rider-km-tracker.html');try{if(window.parent!==window&&window.parent.location.origin===window.location.origin)window.parent.location.hash=route;else location.href='../rider-km-tracker/rider-km-tracker.html';}catch(e){location.href='../rider-km-tracker/rider-km-tracker.html';}}
x('codDate').addEventListener('change',()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(today()))return;render();});
x('codAddRider').addEventListener('click',()=>{const n=prompt('Rider name:');if(!n||!n.trim())return;const d=current();if(d.riders.some(r=>r.name.toLowerCase()===n.trim().toLowerCase()))return alert('Rider already exists for this day.');d.riders.push({id:uid(),name:n.trim().slice(0,90),cod:0,payments:[],remarks:'',sent:false});persist();render();});
x('agentForm').addEventListener('submit',e=>{e.preventDefault();const v=parseMoney(x('agentAmount').value);if(v===null||v<=0)return alert('Invalid agent payment amount.');current().agent.push({id:uid(),method:x('agentMethod').value,amount:v,reference:x('agentReference').value.trim().slice(0,140)});persist();x('agentForm').reset();render();});
function download(name,content,type){const b=new Blob([content],{type}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
x('codExport').addEventListener('click',()=>{const lines=[['Date','Type','Rider','Panel COD','Payment method','Payment amount','Due','Overpaid','Remarks/Reference']];const d=current();for(const r of d.riders){const s=sums(r);lines.push([today(),'Rider summary',r.name,centsToInput(r.cod),'',centsToInput(s.paid),centsToInput(Math.max(0,s.diff)),centsToInput(Math.max(0,-s.diff)),r.remarks]);for(const p of r.payments)lines.push([today(),'Rider payment',r.name,'',p.method,centsToInput(p.amount),'','',p.reference]);}for(const p of d.agent)lines.push([today(),'Agent payment','','',p.method,centsToInput(p.amount),'','',p.reference]);const csv='\uFEFF'+lines.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');download('COD_Collection_'+today()+'.csv',csv,'text/csv;charset=utf-8');});
x('codBackup').addEventListener('click',()=>download('COD_Backup_'+bdToday()+'.json',JSON.stringify(db,null,2),'application/json'));
x('codRestore').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const d=JSON.parse(await file.text());if(d.version!==1||!d.days||typeof d.days!=='object')throw Error('Unsupported backup');for(const [date,v] of Object.entries(d.days)){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(v.riders)||!Array.isArray(v.agent))throw Error('Invalid backup structure');for(const r of v.riders){if(typeof r.name!=='string'||!Number.isSafeInteger(r.cod)||r.cod<0||!Array.isArray(r.payments))throw Error('Invalid rider');for(const p of r.payments)if(!Number.isSafeInteger(p.amount)||p.amount<0||!methods.includes(p.method))throw Error('Invalid payment');}for(const p of v.agent)if(!Number.isSafeInteger(p.amount)||p.amount<0||!methods.includes(p.method))throw Error('Invalid agent payment');}if(!confirm('Replace ALL locally saved COD days with this backup?'))return;db=d;persist();render();notice('Backup restored.');}catch(err){alert('Restore failed: '+err.message);}finally{e.target.value='';}});
render();
})();