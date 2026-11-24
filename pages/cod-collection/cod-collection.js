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
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(new Date(v+'T00:00:00+06:00').getTime());
const DAY_MS=86400000, RETENTION_DAYS=30;
const expiryMs=date=>new Date(date+'T00:00:00+06:00').getTime()+RETENTION_DAYS*DAY_MS;
const isExpired=date=>!validDate(date)||expiryMs(date)<=Date.now();
const clone=v=>JSON.parse(JSON.stringify(v));
function notice(s){x('codMessage').textContent=s;}
function cloudStatus(s){x('codCloudStatus').textContent=s;}
function defaultDay(){return {riders:Array.from({length:5},(_,i)=>({id:uid(),name:'Rider '+(i+1),cod:0,payments:[],remarks:'',sent:false})),agent:[]};}
const firebaseConfig = {
  apiKey: "AIzaSyADm297kotJhrGe_TbM9dZCktoFDVBIIr4",
  authDomain: "adjoy-rider-tracker.firebaseapp.com",
  projectId: "adjoy-rider-tracker",
  storageBucket: "adjoy-rider-tracker.firebasestorage.app",
  messagingSenderId: "207253998908",
  appId: "1:207253998908:web:17f549b4a947b327f5e239",
  measurementId: "G-3CBEZGZVHM"
};
if(!firebase.apps.length)firebase.initializeApp(firebaseConfig);
const fbAuth=firebase.auth(), fbDb=firebase.firestore();
let db={version:1,days:{}},cloudRef=null,cloudVersions={},ready=false,saveFailure=false;
let workQueue=Promise.resolve(),pendingWrites=0,loadedUid=null,loadToken=0;
let localBackup={version:1,days:{}};
try {
  const d=JSON.parse(localStorage.getItem(STORE)||'null');
  if(d&&d.version===1&&d.days&&typeof d.days==='object')localBackup=d;
} catch(err) {notice('Old browser backup could not be parsed. Keep your backup file.');}
x('codDate').value=bdToday();
const today=()=>x('codDate').value;
function current(){
  const date=today();
  if(isExpired(date))return {riders:[],agent:[]};
  if(!db.days[date])db.days[date]=defaultDay();
  return db.days[date];
}
function ensureReady(){
  if(!ready||!fbAuth.currentUser||saveFailure||isExpired(today())){
    alert(saveFailure ? 'Cloud save failed. Export your backup before refreshing.' :
      isExpired(today()) ? 'This work date is older than 30 days and cannot be edited.' :
      'Firebase is still loading. Please reopen after the connection is ready.');
    return false;
  }
  return true;
}
function cacheLocal(){
  try{localStorage.setItem(STORE,JSON.stringify(db));}catch(err){console.warn('COD local backup unavailable',err);}
}
function syncUi(){
  document.body.classList.toggle('cod-locked',!ready||saveFailure||isExpired(today()));
  if(!ready)cloudStatus('Connecting to Firebase...');
  else if(saveFailure)cloudStatus('Cloud error — backup your data, then refresh');
  else if(isExpired(today()))cloudStatus('This date has expired (older than 30 days)');
  else if(pendingWrites)cloudStatus('Saving to Firebase ('+pendingWrites+')...');
  else cloudStatus('Firebase connected · All changes saved');
}
function validateDay(v){
  if(!v||!Array.isArray(v.riders)||!Array.isArray(v.agent)||v.riders.length>150)throw Error('Invalid COD day structure');
  const riders=new Set();
  for(const r of v.riders){
    if(!r||typeof r.id!=='string'||typeof r.name!=='string'||r.name.length>90||
      !Number.isSafeInteger(r.cod)||r.cod<0||!Array.isArray(r.payments)||r.payments.length>1000||
      riders.has(r.id))throw Error('Invalid COD rider');
    riders.add(r.id);
    for(const p of r.payments)validatePayment(p);
  }
  if(v.agent.length>2500)throw Error('Too many payments in one day');
  for(const p of v.agent)validatePayment(p);
}
function validatePayment(p){
  if(!p||typeof p.id!=='string'||!Number.isSafeInteger(p.amount)||
    p.amount<=0||!methods.includes(p.method)||typeof p.reference!=='string'||p.reference.length>140)
    throw Error('Invalid payment record');
}
function persist(){
  if(!ensureReady())return Promise.resolve(false);
  const date=today(),data=clone(db.days[date]);
  try{validateDay(data);}catch(err){alert(err.message);return Promise.resolve(false);}
  cacheLocal();
  pendingWrites++;syncUi();
  const ref=cloudRef.doc(date),user=loadedUid;
  const operation=async()=>{
    if(user!==loadedUid||!fbAuth.currentUser||fbAuth.currentUser.uid!==user)throw Error('Account changed while saving');
    const baseline=cloudVersions[date]||0;
    await fbDb.runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const revision=snap.exists?Number(snap.data().revision||0):0;
      if(revision!==baseline)throw Error('This date changed on another device. Export a backup and refresh the cloud data before editing.');
      tx.set(ref,{
        date,riders:data.riders,agent:data.agent,
        revision:revision+1,
        expiresAt:firebase.firestore.Timestamp.fromMillis(expiryMs(date)),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    cloudVersions[date]=baseline+1;
    return true;
  };
  const promise=workQueue.then(operation);
  workQueue=promise.catch(err=>{console.error('COD cloud save failed',err);saveFailure=true;notice('Cloud save failed: '+err.message+' Local backup kept. Export JSON before refreshing.');return false;})
    .finally(()=>{pendingWrites--;syncUi();});
  return promise.catch(()=>false);
}
async function cleanupExpired(collection,docs){
  const expired=docs.filter(s=>isExpired(s.id));
  for(let offset=0;offset<expired.length;offset+=400){
    const batch=fbDb.batch();
    for(const snap of expired.slice(offset,offset+400))batch.delete(snap.ref);
    await batch.commit();
  }
}
async function loadCloud(){
  if(!cloudRef)throw Error('Sign in to use COD Cloud.');
  const uidNow=loadedUid;
  ready=false;syncUi();
  await workQueue;
  const snap=await cloudRef.get();
  if(uidNow!==loadedUid)return;
  await cleanupExpired(cloudRef,snap.docs);
  const loaded={version:1,days:{}};
  const versions={};
  for(const doc of snap.docs){
    if(isExpired(doc.id))continue;
    const value=doc.data();
    if(!value||!Array.isArray(value.riders)||!Array.isArray(value.agent))continue;
    validateDay(value);
    loaded.days[doc.id]={riders:value.riders,agent:value.agent};
    versions[doc.id]=Number(value.revision||0);
  }
  // First-time migration of the old local-only COD ledger. Existing cloud
  // records always win, so a stale browser cache cannot overwrite another
  // device. A transaction with exists-check avoids duplicate imports.
  let migrated=0;
  for(const [date,value] of Object.entries(localBackup.days||{})){
    if(isExpired(date)||loaded.days[date])continue;
    try{validateDay(value);}catch(err){continue;}
    const ref=cloudRef.doc(date);
    const imported=await fbDb.runTransaction(async tx=>{
      const remote=await tx.get(ref);
      if(remote.exists)return false;
      tx.set(ref,{
        date,riders:value.riders,agent:value.agent,
        revision:1,
        expiresAt:firebase.firestore.Timestamp.fromMillis(expiryMs(date)),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      return true;
    });
    if(imported){loaded.days[date]=clone(value);versions[date]=1;migrated++;}
    else {
      const remote=await ref.get();
      if(remote.exists){
        const valueRemote=remote.data();
        loaded.days[date]={riders:valueRemote.riders,agent:valueRemote.agent};
        versions[date]=Number(valueRemote.revision||0);
      }
    }
  }
  db=loaded;cloudVersions=versions;localBackup={version:1,days:{}};
  try{localStorage.removeItem(STORE);}catch(err){}
  cacheLocal();
  ready=true;saveFailure=false;syncUi();render();
  notice(migrated ? migrated+' existing browser day(s) migrated to Firestore. Old cloud records were preserved.' :
    'Cloud records loaded. Data older than 30 days is excluded.');
}
fbAuth.onAuthStateChanged(async user=>{
  const token=++loadToken;
  ready=false;syncUi();
  if(!user){loadedUid=null;cloudRef=null;db={version:1,days:{}};cloudStatus('Please log in from the main panel');return;}
  loadedUid=user.uid;
  cloudRef=fbDb.collection('users').doc(user.uid).collection('codDailyRecords');
  try {
    await loadCloud();
    if(token!==loadToken)return;
  }catch(err){
    console.error('COD Cloud load failed',err);
    ready=false;cloudStatus('Cannot load Firebase: '+err.message);
    notice('Cloud access unavailable. Your existing browser data has not been deleted.');
  }
});
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
// Restore only dates not present in Firestore; never overwrite cloud records.
x('codRestore').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try {
    if(!ensureReady())return;
    const incoming=JSON.parse(await file.text());
    if(incoming.version!==1||!incoming.days||typeof incoming.days!=='object')throw Error('Unsupported backup');
    const dates=Object.entries(incoming.days).filter(([d])=>!isExpired(d));
    for(const [,value] of dates)validateDay(value);
    if(!confirm('Import missing days from this backup to Firebase? Existing cloud days will NOT be overwritten. Expired days are skipped.'))return;
    await workQueue;
    let added=0,skipped=0;
    for(const [date,value] of dates){
      const ref=cloudRef.doc(date);
      const ok=await fbDb.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        if(snap.exists)return false;
        tx.set(ref,{
          date,riders:value.riders,agent:value.agent,revision:1,
          expiresAt:firebase.firestore.Timestamp.fromMillis(expiryMs(date)),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        return true;
      });
      if(ok)added++;else skipped++;
    }
    await loadCloud();
    notice('Cloud restore: '+added+' day(s) imported, '+skipped+' already present. Expired days skipped.');
  } catch(err){alert('Restore failed: '+err.message);}
  finally{e.target.value='';}
});
x('codRefresh').addEventListener('click',async()=>{
  if(pendingWrites){alert('Finish saving the current changes before refreshing.');return;}
  if(!cloudRef)return alert('Firebase is not connected.');
  try{await loadCloud();}catch(err){ready=false;syncUi();alert('Cloud refresh failed: '+err.message);}
});

// The signed-in user state initiates the first cloud load.
})();