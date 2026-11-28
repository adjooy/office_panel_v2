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
const validDate=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const time=new Date(v+'T00:00:00+06:00');return !Number.isNaN(time.getTime())&&new Date(time.getTime()+21600000).toISOString().slice(0,10)===v;};
const DAY_MS=86400000, RETENTION_DAYS=30;
const expiryMs=date=>new Date(date+'T00:00:00+06:00').getTime()+RETENTION_DAYS*DAY_MS;
const isExpired=date=>!validDate(date)||expiryMs(date)<=Date.now();
const clone=v=>JSON.parse(JSON.stringify(v));
function notice(s){x('codMessage').textContent=s;}
function cloudStatus(s){x('codCloudStatus').textContent=s;}
const starterNames=['Rider 1','Rider 2','Rider 3','Rider 4','Rider 5'];
let riderRoster=[],rosterRevision=0,rosterDirty=false;
const rosterDocId='riderRoster';
function starterRoster(){return starterNames.map(name=>({id:uid(),name}));}
function normalizedName(name){return String(name||'').trim().toLocaleLowerCase();}
function validRoster(value){
  return Array.isArray(value)&&value.length<=150&&value.every(r=>
    r&&typeof r.id==='string'&&r.id.length>0&&typeof r.name==='string'&&
    r.name.trim().length>0&&r.name.length<=90);
}
function dayRider(info){return {id:info.id,name:info.name,cod:0,payments:[],remarks:'',sent:false};}
function defaultDay(){return {riders:riderRoster.map(dayRider),agent:[],transfers:[],codAdditions:[],expenses:[]};}
const EXPENSE_TYPES={fuel:'Fuel (authorized)',office:'Hub / Office (authorized)',other:'Other Authorized Expense',personal:'Personal Use',repayment:'Personal Cash Returned'};
const APPROVED_EXPENSES=new Set(['fuel','office','other']);
function expenseEntries(day){return Array.isArray(day.expenses)?day.expenses:[];}
function expenseTotals(day){
  const t={authorized:0,personal:0,returned:0};
  for(const e of expenseEntries(day)){
    if(APPROVED_EXPENSES.has(e.type))t.authorized+=e.amount;
    else if(e.type==='personal')t.personal+=e.amount;
    else if(e.type==='repayment')t.returned+=e.amount;
  }
  t.outstanding=t.personal-t.returned;
  return t;
}
function dayAdditions(day){return Array.isArray(day.codAdditions)?day.codAdditions:[];}
function normalizeDayRiders(day){
  if(!day||!Array.isArray(day.riders))return;
  // Never rename or erase a rider carrying historical money or transfers.
  for(const person of riderRoster){
    const sameId=day.riders.find(r=>r.id===person.id);
    if(sameId){sameId.name=person.name;continue;}
    if(day.riders.some(r=>normalizedName(r.name)===normalizedName(person.name)))continue;
    const old=day.riders.find(r=>/^Rider [1-5]$/.test(r.name)&&
      !r.cod&&!r.payments.length&&!dayAdditions(day).some(a=>a.riderId===r.id)&&
      !transfersOf(day).some(t=>t.fromId===r.id||t.toId===r.id));
    if(old&& !riderRoster.some(z=>normalizedName(z.name)===normalizedName(old.name))){
      old.name=person.name; // only untouched legacy placeholder
    }else day.riders.push(dayRider(person));
  }
}
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
  if(isExpired(date))return {riders:[],agent:[],transfers:[],codAdditions:[],expenses:[]};
  if(!db.days[date])db.days[date]=defaultDay();
  normalizeDayRiders(db.days[date]);
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
  if(new Set(v.riders.map(r=>r.id)).size!==v.riders.length)throw Error('Duplicate rider IDs');
  const riders=new Set();
  for(const r of v.riders){
    if(!r||typeof r.id!=='string'||typeof r.name!=='string'||r.name.length>90||
      !Number.isSafeInteger(r.cod)||r.cod<0||!Array.isArray(r.payments)||r.payments.length>1000||
      riders.has(r.id))throw Error('Invalid COD rider');
    riders.add(r.id);
    for(const p of r.payments)validatePayment(p);
  }
  if(v.codAdditions!==undefined){
    if(!Array.isArray(v.codAdditions)||v.codAdditions.length>1500)throw Error('Invalid Panel COD cash entries');
    const ids=new Set();
    for(const a of v.codAdditions){
      if(!a||typeof a.id!=='string'||ids.has(a.id)||!riders.has(a.riderId)||
         (a.type!==undefined && !['Cash','Online'].includes(a.type))||
         !Number.isSafeInteger(a.amount)||a.amount<=0||typeof a.reference!=='string'||a.reference.length>140)
        throw Error('Invalid Panel COD cash addition');
      ids.add(a.id);
    }
  }
  if(v.agent.length>2500)throw Error('Too many payments in one day');
  for(const p of v.agent)validatePayment(p);
  if(v.expenses!==undefined){
    if(!Array.isArray(v.expenses)||v.expenses.length>2500)throw Error('Invalid cash expense ledger');
    const ids=new Set();
    for(const e of v.expenses){
      if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id)||
        !Object.prototype.hasOwnProperty.call(EXPENSE_TYPES,e.type)||
        !Number.isSafeInteger(e.amount)||e.amount<=0||
        typeof e.reference!=='string'||e.reference.length>140||
        typeof e.note!=='string'||!e.note.trim()||e.note.length>500||
        typeof e.approved!=='boolean'||(APPROVED_EXPENSES.has(e.type)!==e.approved)||
        (e.createdAt!==undefined&&(typeof e.createdAt!=='string'||e.createdAt.length>40)))
        throw Error('Invalid expense or personal cash return');
      ids.add(e.id);
    }
    if(expenseTotals(v).outstanding<0)
      throw Error('Cash returned exceeds Personal Use recorded for the selected date.');
  }
  if(v.transfers!==undefined){
    if(!Array.isArray(v.transfers)||v.transfers.length>3000)throw Error('Invalid COD transfers');
    const ids=new Set();
    for(const t of v.transfers){
      if(!t||typeof t.id!=='string'||ids.has(t.id)||
        !riders.has(t.fromId)||!riders.has(t.toId)||t.fromId===t.toId||
        !Number.isSafeInteger(t.amount)||t.amount<=0||
        typeof t.reference!=='string'||!t.reference.trim()||t.reference.length>120)throw Error('Invalid COD transfer');
      ids.add(t.id);
    }
  }
}

const NOTE_VALUES=[1000,500,200,100,50,20,10,5,2];
function noteTotal(notes){
  if(!notes||typeof notes!=='object'||Array.isArray(notes))return null;
  let total=0;
  for(const [key,value] of Object.entries(notes)){
    if(!NOTE_VALUES.includes(Number(key))||!Number.isSafeInteger(value)||value<0||value>100000)return null;
    total+=Number(key)*value*100;
  }
  return Number.isSafeInteger(total)?total:null;
}
function readNotes(inputs){
  const result={};
  for(const input of inputs){
    if(!/^\d*$/.test(input.value))return null;
    const count=input.value===''?0:Number(input.value);
    if(!Number.isSafeInteger(count)||count<0||count>100000)return null;
    if(count)result[input.dataset.noteValue]=count;
  }
  return result;
}
function noteDescription(notes){
  return NOTE_VALUES.filter(value=>notes?.[value]).map(value=>'৳'+value+' × '+notes[value]).join(' · ');
}

function validatePayment(p){
  if(!p||typeof p.id!=='string'||!Number.isSafeInteger(p.amount)||
    p.amount<=0||!methods.includes(p.method)||typeof p.reference!=='string'||p.reference.length>140)
    throw Error('Invalid payment record');
  if(p.notes!==undefined && (p.method!=='Cash'||noteTotal(p.notes)!==p.amount))
    throw Error('Cash note breakdown does not match payment amount');
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
      const rosterRef=cloudRef.doc(rosterDocId);
      const rosterSnap=rosterDirty?await tx.get(rosterRef):null;
      if(rosterDirty && Number(rosterSnap.exists?rosterSnap.data().revision||0:0)!==rosterRevision)
        throw Error('Rider list changed on another device. Refresh Cloud first.');
      const revision=snap.exists?Number(snap.data().revision||0):0;
      if(revision!==baseline)throw Error('This date changed on another device. Export a backup and refresh the cloud data before editing.');
      tx.set(ref,{
        date,riders:data.riders,agent:data.agent,transfers:data.transfers||[],codAdditions:data.codAdditions||[],expenses:data.expenses||[],
        revision:revision+1,
        expiresAt:firebase.firestore.Timestamp.fromMillis(expiryMs(date)),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      if(rosterDirty)tx.set(rosterRef,{
        riders:riderRoster,revision:rosterRevision+1,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    cloudVersions[date]=baseline+1;
    if(rosterDirty){rosterRevision++;rosterDirty=false;}
    return true;
  };
  const promise=workQueue.then(operation);
  workQueue=promise.catch(err=>{console.error('COD cloud save failed',err);saveFailure=true;notice('Cloud save failed: '+err.message+' Local backup kept. Export JSON before refreshing.');return false;})
    .finally(()=>{pendingWrites--;syncUi();});
  return promise.catch(()=>false);
}
async function cleanupExpired(collection,docs){
  const expired=docs.filter(s=>s.id!==rosterDocId&&isExpired(s.id));
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
  try { await cleanupExpired(cloudRef,snap.docs); }
  catch(err) { console.warn('Expired COD cleanup skipped; Firestore TTL can delete later:',err); }
  const loaded={version:1,days:{}};
  const versions={};
  const savedRoster=snap.docs.find(doc=>doc.id===rosterDocId);
  if(savedRoster){
    const data=savedRoster.data();
    if(!validRoster(data.riders))throw Error('Invalid shared rider list. Contact support before editing.');
    riderRoster=clone(data.riders);rosterRevision=Number(data.revision||0);
  }
  for(const doc of snap.docs){
    if(isExpired(doc.id))continue;
    const value=doc.data();
    if(!value||!Array.isArray(value.riders)||!Array.isArray(value.agent))continue;
    validateDay(value);
    loaded.days[doc.id]={riders:value.riders,agent:value.agent,transfers:value.transfers||[],codAdditions:value.codAdditions||[],expenses:value.expenses||[]};
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
        date,riders:value.riders,agent:value.agent,transfers:value.transfers||[],codAdditions:value.codAdditions||[],expenses:value.expenses||[],
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
        loaded.days[date]={riders:valueRemote.riders,agent:valueRemote.agent,transfers:valueRemote.transfers||[],codAdditions:valueRemote.codAdditions||[],expenses:valueRemote.expenses||[]};
        versions[date]=Number(valueRemote.revision||0);
      }
    }
  }
  if(!savedRoster){
    const recent=Object.entries(loaded.days).sort((a,b)=>b[0].localeCompare(a[0]));
    const source=recent[0]?.[1]?.riders||[];
    const candidates=source.length?source.map(r=>({id:r.id,name:r.name})):starterRoster();
    // Keep manually named riders from earlier days too.
    for(const [,day] of recent.slice(1)){
      for(const r of day.riders){
        if(!/^Rider [1-5]$/.test(r.name)&&
          !candidates.some(z=>normalizedName(z.name)===normalizedName(r.name)))
          candidates.push({id:r.id,name:r.name});
      }
    }
    riderRoster=candidates;
    if(!validRoster(riderRoster))throw Error('Cannot create shared rider list');
    const doc=cloudRef.doc(rosterDocId);
    const didCreate=await fbDb.runTransaction(async tx=>{
      const remote=await tx.get(doc);
      if(remote.exists)return false;
      tx.set(doc,{riders:riderRoster,revision:1,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      return true;
    });
    if(didCreate)rosterRevision=1;
    else {
      const latest=(await doc.get()).data();
      if(!validRoster(latest?.riders))throw Error('Shared rider list is invalid');
      riderRoster=clone(latest.riders);rosterRevision=Number(latest.revision||0);
    }
  }
  rosterDirty=false;
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
  if(!user){loadedUid=null;cloudRef=null;riderRoster=[];rosterRevision=0;rosterDirty=false;db={version:1,days:{}};cloudStatus('Please log in from the main panel');return;}
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
/* COD transfers are offsets, never new COD: incoming - outgoing = zero globally. */
function transfersOf(day){return Array.isArray(day.transfers)?day.transfers:[];}
function originalCOD(day,riderId){
  const rider=day.riders.find(r=>r.id===riderId);
  if(!rider)return 0;
  return rider.cod+dayAdditions(day).filter(a=>a.riderId===riderId).reduce((n,a)=>n+a.amount,0);
}
function transferAmounts(day,riderId,excludingId=null){
  let incoming=0,outgoing=0;
  for(const t of transfersOf(day)){
    if(t.id===excludingId)continue;
    if(t.toId===riderId)incoming+=t.amount;
    if(t.fromId===riderId)outgoing+=t.amount;
  }
  return {incoming,outgoing,net:incoming-outgoing};
}
function effectiveCOD(day,riderId,excludingId=null){
  return originalCOD(day,riderId)+transferAmounts(day,riderId,excludingId).net;
}
function transferStatus(day){
  const base=day.riders.reduce((n,r)=>n+originalCOD(day,r.id),0);
  const effective=day.riders.reduce((n,r)=>n+effectiveCOD(day,r.id),0);
  return {base,effective};
}
function safeTransfer(day,t,excludingId=null){
  const validIds=new Set(day.riders.map(r=>r.id));
  if(!validIds.has(t.fromId)||!validIds.has(t.toId)||t.fromId===t.toId)
    return 'Choose two different riders.';
  if(!Number.isSafeInteger(t.amount)||t.amount<=0)return 'Enter a valid transfer amount.';
  if(!t.reference||!t.reference.trim())return 'Parcel CID / unique reference is required.';
  if(effectiveCOD(day,t.fromId,excludingId)<t.amount)
    return 'Transfer exceeds available COD of the source rider.';
  return null;
}
function sums(r){const paid=r.payments.reduce((n,p)=>n+p.amount,0);return {paid,diff:r.cod-paid};}
function el(tag,cls,content){const a=document.createElement(tag);if(cls)a.className=cls;if(content!==undefined)a.textContent=content;return a;}
function button(label,fn,cls=''){const b=el('button','cod-action '+cls,label);b.type='button';b.addEventListener('click',fn);return b;}
function field(label,value,handler,type='text'){const wrap=el('label');wrap.append(el('span','',label));const input=el('input');input.type=type;input.value=value;input.addEventListener('change',()=>handler(input.value,input));wrap.append(input);return wrap;}
function addPaymentForm(container,callback){const f=el('form','cod-entry-form');const method=el('select');for(const m of methods){const o=el('option','',m);o.value=m;method.append(o);}const amount=el('input');amount.type='number';amount.min='.01';amount.step='.01';amount.placeholder='0.00';amount.required=true;const ref=el('input');ref.maxLength=140;ref.placeholder='Reference / note';for(const [label,input] of [['Amount (BDT)',amount],['Type',method],['Reference',ref]]){const wrap=el('label');wrap.append(el('span','',label),input);f.append(wrap);}const b=el('button','btn btn-primary','+ Add Payment');b.type='submit';f.append(b);f.addEventListener('submit',e=>{e.preventDefault();const v=parseMoney(amount.value);if(v===null||v<=0)return alert('Enter a valid positive amount (maximum two decimals).');callback({id:uid(),method:method.value,amount:v,reference:ref.value.trim().slice(0,140)});f.reset();});container.append(f);}

const codHistoryOpen={cod:false,transaction:false};
function makeHistory(title,count,key,content){
  const section=el('details','cod-history-details');
  section.open=codHistoryOpen[key];
  const summary=el('summary','',title+' ('+count+')');
  section.append(summary,content);
  section.addEventListener('toggle',()=>{
    // Discard async toggle events from sections replaced during render().
    if(section.isConnected)codHistoryOpen[key]=section.open;
  });
  return section;
}
function renderCODCashAdditions(formContainer,historyContainer,d,r){
  const outer=el('section','cod-cash-add-section');
  const heading=el('div','cod-cash-quick-heading');
  heading.append(el('h4','cod-subtitle','Add Cash to COD'),
    el('span','cod-cash-help','Assigned COD only · Payments go in Add Transaction'));
  outer.append(heading);
  const form=el('form','cod-entry-form cod-cash-add-form');
  const amt=el('input');amt.type='number';amt.min='.01';amt.step='.01';amt.placeholder='0.00';amt.required=true;
  const category=el('select');
  for(const value of ['Cash','Online']){
    const option=el('option','',value);option.value=value;category.append(option);
  }
  const ref=el('input');ref.maxLength=140;ref.placeholder='Parcel CID / reason';ref.required=true;
  const mk=(label,input)=>{const wrap=el('label');wrap.append(el('span','',label),input);return wrap;};
  const submit=el('button','btn btn-primary','+ Add Cash to COD');submit.type='submit';
  form.append(mk('Amount (BDT)',amt),mk('Type',category),mk('CID / Reference',ref),submit);
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!ensureReady())return;
    const amount=parseMoney(amt.value),reference=ref.value.trim().slice(0,140);
    if(amount===null||amount<=0)return alert('Enter a valid positive cash COD amount.');
    if(!reference)return alert('Enter CID or unique reference.');
    d.codAdditions=dayAdditions(d).concat({id:uid(),riderId:r.id,amount,type:category.value,reference});
    persist();render();notice('Added '+money(amount)+' to '+r.name+' Panel COD. Total COD and Due updated.');
  });
  outer.append(form);
  formContainer.append(outer);
  const entries=dayAdditions(d).filter(a=>a.riderId===r.id);
  const historyItems=el('div','cod-cash-history');
  if(!entries.length && !r.cod)historyItems.append(el('p','cod-empty','No COD entered for this rider.'));
  else{
    const list=historyItems;
    if(r.cod>0){
      const legacy=el('div','cod-cash-item');
      const info=el('div','cod-cash-entry-info');
      info.append(el('strong','',money(r.cod)),el('small','','Earlier saved Panel COD'));
      legacy.append(info);list.append(legacy);
    }
    for(const entry of entries.slice().reverse()){
      const line=el('div','cod-cash-item');
      const info=el('div','cod-cash-entry-info');
      info.append(el('strong','',money(entry.amount)),el('small','',(entry.type||'Cash')+' · '+entry.reference));
      const actions=el('div','cod-cash-entry-actions');
      actions.append(button('Edit',()=>{
        if(!ensureReady())return;
        const newAmount=prompt('Edit Panel COD cash amount (BDT)',centsToInput(entry.amount));
        if(newAmount===null)return;
        const amount=parseMoney(newAmount);
        if(amount===null||amount<=0)return alert('Invalid positive amount.');
        const newType=prompt('Type: Cash or Online',entry.type||'Cash');
        if(newType===null)return;
        const type=newType.trim().toLowerCase()==='cash'?'Cash':newType.trim().toLowerCase()==='online'?'Online':null;
        if(!type)return alert('Type must be Cash or Online.');
        const reference=prompt('Edit CID / Reference',entry.reference);
        if(reference===null)return;
        const cleaned=reference.trim().slice(0,140);
        if(!cleaned)return alert('CID / reference required.');
        const oldAmount=entry.amount,oldRef=entry.reference,oldType=entry.type;
        entry.amount=amount;entry.reference=cleaned;entry.type=type;
        if(d.riders.some(person=>effectiveCOD(d,person.id)<0)){
          entry.amount=oldAmount;entry.reference=oldRef;entry.type=oldType;
          return alert('Cannot reduce cash COD: linked transfers exceed remaining assigned COD.');
        }
        persist();render();notice('Panel COD cash entry updated.');
      }));
      actions.append(button('Remove',()=>{
        if(!ensureReady()||!confirm('Remove '+money(entry.amount)+' added cash COD?'))return;
        const next=dayAdditions(d).filter(a=>a.id!==entry.id);
        const previous=d.codAdditions;d.codAdditions=next;
        if(d.riders.some(person=>effectiveCOD(d,person.id)<0)){
          d.codAdditions=previous;
          return alert('Cannot remove: this COD was already transferred to another rider.');
        }
        persist();render();notice('Panel COD cash entry removed.');
      },'cod-danger'));
      line.append(info,actions);list.append(line);
    }
  }
  historyContainer.append(makeHistory('COD Entry History',entries.length+(r.cod>0?1:0),'cod',historyItems));
}
function table(payments,onRemove,onEdit){const scroll=el('div','cod-table-scroll'),tab=el('table','cod-table'),thead=el('thead'),head=el('tr');['Method','Amount','Reference','Action'].forEach(h=>head.append(el('th','',h)));thead.append(head);tab.append(thead);const body=el('tbody');if(!payments.length){const row=el('tr'),td=el('td','cod-empty','No payments recorded');td.colSpan=4;row.append(td);body.append(row);}payments.forEach(p=>{const row=el('tr');[p.method,money(p.amount),p.reference||'—'].forEach(t=>row.append(el('td','',t)));const action=el('td');action.append(button('Edit',()=>onEdit(p.id)));action.append(button('Remove',()=>onRemove(p.id),'cod-danger'));row.append(action);body.append(row);});tab.append(body);scroll.append(tab);return scroll;}

/* Transaction edit — updates existing payment records (never adds duplicates). */
let editingPayment=null;
const editDialog=x('codEditDialog');
function openEditPayment(kind,riderId,paymentId){
  if(!ensureReady())return;
  const d=current();
  const arr=kind==='agent'?d.agent:d.riders.find(r=>r.id===riderId)?.payments;
  const entry=arr?.find(p=>p.id===paymentId);
  if(!entry)return alert('Entry is no longer available. Refresh Firebase.');
  editingPayment={kind,riderId,paymentId,date:today()};
  const method=x('codEditMethod');method.replaceChildren();
  for(const value of methods){const option=el('option','',value);option.value=value;method.append(option);}
  method.value=entry.method;
  x('codEditAmount').value=centsToInput(entry.amount);
  x('codEditReference').value=entry.reference||'';
  const noteEditor=x('codEditNoteCounter');
  noteEditor.hidden=kind!=='agent'||entry.method!=='Cash';
  noteEditor.open=kind==='agent'&&entry.method==='Cash'&&!!entry.notes;
  const noteFields=x('codEditNoteFields');noteFields.replaceChildren();
  if(kind==='agent'&&entry.method==='Cash'){
    for(const value of NOTE_VALUES){
      const label=el('label','', '৳'+value+' notes');
      const input=el('input');input.type='number';input.min='0';input.step='1';input.inputMode='numeric';
      input.dataset.noteValue=String(value);input.value=String(entry.notes?.[value]||'');
      label.append(input);noteFields.append(label);
    }
  }
  updateEditNoteTotal();
  x('codEditHeading').textContent=kind==='agent'?'Edit Agent Payment':'Edit Rider Payment';
  if(typeof editDialog.showModal==='function')editDialog.showModal();
  else editDialog.setAttribute('open','');
}
function closeEditPayment(){
  editingPayment=null;
  if(typeof editDialog.close==='function')editDialog.close();
  else editDialog.removeAttribute('open');
}
function updateEditNoteTotal(){
  const inputs=[...x('codEditNoteFields').querySelectorAll('[data-note-value]')];
  const notes=readNotes(inputs);
  const total=notes===null?null:noteTotal(notes);
  x('codEditNoteTotal').textContent=total===null?'Invalid note count':'Notes total: '+money(total);
}
x('codEditNoteFields').addEventListener('input',updateEditNoteTotal);
x('codEditMethod').addEventListener('change',()=>{
  x('codEditNoteCounter').hidden=!editingPayment||editingPayment.kind!=='agent'||x('codEditMethod').value!=='Cash';
});
x('codEditCancel').addEventListener('click',closeEditPayment);
editDialog.addEventListener('cancel',()=>{editingPayment=null;});
x('codEditForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!editingPayment||!ensureReady())return;
  if(editingPayment.date!==today())return alert('Date changed. Close and reopen the payment editor.');
  const d=current();
  const arr=editingPayment.kind==='agent'?d.agent:d.riders.find(r=>r.id===editingPayment.riderId)?.payments;
  const entry=arr?.find(p=>p.id===editingPayment.paymentId);
  if(!entry)return alert('Entry not found. Refresh the page.');
  const amount=parseMoney(x('codEditAmount').value);
  if(amount===null||amount<=0)return alert('Enter a valid positive amount.');
  const method=x('codEditMethod').value;
  if(!methods.includes(method))return alert('Select a valid payment method.');
  const reference=x('codEditReference').value.trim().slice(0,140);
  const noteEditor=x('codEditNoteCounter');
  let updatedNotes=undefined;
  if(editingPayment.kind==='agent'&&method==='Cash'&&noteEditor.open){
    const notes=readNotes([...x('codEditNoteFields').querySelectorAll('[data-note-value]')]);
    if(notes===null)return alert('Enter whole-number note counts.');
    const value=noteTotal(notes);
    if(value===null)return alert('Invalid note counts.');
    if(value>0&&value!==amount)return alert('Cash notes total must equal payment amount.');
    if(value>0)updatedNotes=notes;
  }
  entry.amount=amount;entry.method=method;entry.reference=reference;
  if(updatedNotes)entry.notes=updatedNotes;
  else delete entry.notes;
  persist();closeEditPayment();render();
});

let editingTransferId=null;
let editingTransferDate=null;
function resetTransferEditor(){
  editingTransferId=null;
  editingTransferDate=null;
  x('codTransferForm').reset();
  x('codTransferSubmit').textContent='Transfer COD';
  x('codTransferCancel').hidden=true;
}
x('codTransferCancel').addEventListener('click',()=>{resetTransferEditor();renderTransferUI(current());});
function selectOptions(select,items){
  const old=select.value;
  select.replaceChildren();
  for(const rider of items){
    const option=el('option','',rider.name);
    option.value=rider.id;select.append(option);
  }
  if(items.some(r=>r.id===old))select.value=old;
}
function renderTransferUI(d){
  const from=x('codTransferFrom'), to=x('codTransferTo');
  const riderId=selectedRiderId;
  const rider=d.riders.find(r=>r.id===riderId);
  // Sender is ALWAYS the selected rider. Only recipients can be chosen.
  selectOptions(from,d.riders);
  from.value=riderId||'';
  const previousRecipient=to.value;
  selectOptions(to,d.riders.filter(r=>r.id!==riderId));
  if(d.riders.some(r=>r.id===previousRecipient&&r.id!==riderId))to.value=previousRecipient;
  if(editingTransferId && (editingTransferDate!==today() ||
      !transfersOf(d).some(t=>t.id===editingTransferId&&t.fromId===riderId))) {
    resetTransferEditor();
  }
  if(editingTransferId){
    const t=transfersOf(d).find(t=>t.id===editingTransferId);
    if(t){to.value=t.toId;from.value=t.fromId;}
  }
  x('codTransferSubmit').disabled=!rider||d.riders.length<2;
  to.disabled=!rider||d.riders.length<2;
  const panel=x('codTransferHistory');
  panel.replaceChildren();
  if(!rider)return;
  // Show transactions relevant to this rider only; editing stays with sender.
  const related=transfersOf(d).filter(t=>t.fromId===riderId||t.toId===riderId);
  x('codTransferHistoryCount').textContent='('+related.length+')';
  if(!related.length)panel.append(el('p','cod-empty','No COD transfers for this rider yet.'));
  const names=new Map(d.riders.map(r=>[r.id,r.name]));
  for(const t of related.slice().reverse()){
    const outgoing=t.fromId===riderId;
    const card=el('div','cod-transfer-item');
    const detail=el('div','cod-transfer-detail');
    detail.append(
      el('strong','', (outgoing?'Sent ':'Received ')+money(t.amount)+' · '+
        (outgoing?'To '+(names.get(t.toId)||'Unknown'):'From '+(names.get(t.fromId)||'Unknown'))),
      el('small','',t.reference)
    );
    const actions=el('div','cod-transfer-item-actions');
    if(outgoing){
      actions.append(button('Edit',()=>{
        if(!ensureReady())return;
        editingTransferId=t.id;editingTransferDate=today();
        from.value=riderId;to.value=t.toId;
        x('codTransferAmount').value=centsToInput(t.amount);
        x('codTransferRef').value=t.reference;
        x('codTransferSubmit').textContent='Update Transfer';
        x('codTransferCancel').hidden=false;
        x('codTransferForm').scrollIntoView({behavior:'smooth',block:'center'});
      }));
      actions.append(button('Remove',()=>{
        if(!ensureReady())return;
        if(!confirm('Remove transfer '+money(t.amount)+' ('+t.reference+')?'))return;
        const candidate=clone(d);
        candidate.transfers=transfersOf(d).filter(z=>z.id!==t.id);
        if(candidate.riders.some(r=>effectiveCOD(candidate,r.id)<0))
          return alert('Cannot remove: a rider has already transferred some of this COD onward. Edit later transfers first.');
        d.transfers=candidate.transfers;
        resetTransferEditor();persist();render();
      },'cod-danger'));
    } else {
      actions.append(el('small','cod-transfer-incoming','To edit, select the sender'));
    }
    card.append(detail,actions);panel.append(card);
  }
}
x('codTransferForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!ensureReady())return;
  const d=current(),amount=parseMoney(x('codTransferAmount').value);
  const fromId=selectedRiderId,toId=x('codTransferTo').value;
  const reference=x('codTransferRef').value.trim().slice(0,120);
  const id=editingTransferId||uid();
  if(editingTransferId && editingTransferDate!==today())
    return alert('Transfer work date changed. Reopen this transfer before editing.');
  if(editingTransferId && !transfersOf(d).some(t=>t.id===editingTransferId))
    return alert('Transfer not found. Refresh the cloud data.');
  const transfer={id,fromId,toId,amount,reference};
  const error=safeTransfer(d,transfer,editingTransferId);
  if(error)return alert(error);
  const candidate=clone(d);
  candidate.transfers=editingTransferId
    ?transfersOf(d).map(t=>t.id===editingTransferId?transfer:t)
    :[...transfersOf(d),transfer];
  if(candidate.riders.some(r=>effectiveCOD(candidate,r.id)<0))
    return alert('This transfer would give a rider negative COD. Correct other linked transfers first.');
  const before=transferStatus(d),after=transferStatus(candidate);
  if(before.base!==after.base||before.effective!==after.effective)
    return alert('Transfer total mismatch. No changes saved.');
  const name=id=>d.riders.find(r=>r.id===id)?.name||'Unknown';
  if(!confirm((editingTransferId?'Update':'Transfer')+' '+money(amount)+' COD from '+name(fromId)+' to '+name(toId)+'?\n\nTotal COD remains '+money(before.effective)+'.'))
    return;
  d.transfers=candidate.transfers;
  persist();resetTransferEditor();render();
  notice('COD transfer saved. Total Panel COD unchanged: '+money(before.effective));
});

const transferPanelNode=x('codTransferPanel');

/* Daily COD cash allocations are a separate sub-ledger, never Rider COD. */
let editingExpenseId=null,editingExpenseDate=null;
function updateExpenseTypeUI(){
  const type=x('codExpenseType').value,approved=APPROVED_EXPENSES.has(type);
  x('codExpenseApprovalLine').hidden=!approved;
  if(!approved)x('codExpenseApproval').checked=false;
  x('codExpenseTypeHelp').textContent=
    approved?'This must be an authorized office expense. Keep the receipt or voucher.':
    type==='personal'?'Personal Use is not an office expense. It remains owed until returned.':
    'Return cash to the COD cash balance against Personal Use on this selected date.';
}
function resetExpenseEditor(){
  editingExpenseId=null;editingExpenseDate=null;
  x('codExpenseForm').reset();
  x('codExpenseType').value='fuel';
  x('codExpenseSave').textContent='Save Expense';
  x('codExpenseCancel').hidden=true;
  updateExpenseTypeUI();
}
function expenseAccounting(day,cashCollected,onlineCollected,totalCOD){
  const totals=expenseTotals(day);
  const cashAgent=day.agent.filter(p=>p.method==='Cash').reduce((n,p)=>n+p.amount,0);
  const onlineAgent=day.agent.filter(p=>p.method!=='Cash').reduce((n,p)=>n+p.amount,0);
  const paidToAgent=cashAgent+onlineAgent;
  return {
    ...totals,cashCollected,onlineCollected,cashAgent,onlineAgent,totalCOD,paidToAgent,
    cashRemaining:cashCollected-cashAgent-totals.authorized-totals.personal+totals.returned,
    onlineRemaining:onlineCollected-onlineAgent,
    grossAgentGap:totalCOD-paidToAgent,
    uncoveredAfterApproved:totalCOD-paidToAgent-totals.authorized
  };
}
function renderExpenses(day,cashCollected,onlineCollected,totalCOD){
  if(editingExpenseId&&(editingExpenseDate!==today()||!expenseEntries(day).some(e=>e.id===editingExpenseId))){
    resetExpenseEditor();
  }
  const a=expenseAccounting(day,cashCollected,onlineCollected,totalCOD);
  for(const [key,value] of [
    ['expenseCashCollected',a.cashCollected],['expenseAgentCash',a.cashAgent],
    ['expenseApproved',a.authorized],['expensePersonalUsed',a.personal],
    ['expensePersonalReturned',a.returned],['expensePersonalOutstanding',a.outstanding],
    ['expenseCashBalance',a.cashRemaining],['expenseOnlineBalance',a.onlineRemaining]
  ]){
    const node=x(key);node.textContent=money(value);
    node.classList.toggle('is-negative',value<0||(key==='expensePersonalOutstanding'&&value>0));
  }
  x('codExpenseCashFormula').textContent=
    'Cash '+money(a.cashCollected)+' − Agent cash '+money(a.cashAgent)+
    ' − authorized expenses '+money(a.authorized)+' − personal use '+money(a.personal)+
    ' + cash returned '+money(a.returned)+' = '+money(a.cashRemaining)+' cash remaining.';
  x('codExpenseSettleFormula').textContent=
    'Total COD '+money(a.totalCOD)+' − total paid to Agent '+money(a.paidToAgent)+
    ' = '+money(a.grossAgentGap)+' original Agent-vs-COD gap. After authorized expenses: '+
    money(a.uncoveredAfterApproved)+' not yet covered by Agent payments / approved expenses. '+
    'Personal Use does NOT count toward settlement. Rider dues may also explain the gap.';
  const items=expenseEntries(day);
  x('codExpenseHistoryCount').textContent='('+items.length+')';
  const rows=x('codExpenseRows');rows.replaceChildren();
  if(!items.length){
    const tr=el('tr'),td=el('td','cod-empty','No cash expenses or personal returns recorded for this date.');
    td.colSpan=4;tr.append(td);rows.append(tr);
  }
  for(const entry of items.slice().reverse()){
    const row=el('tr');
    row.append(el('td','',EXPENSE_TYPES[entry.type]));
    row.append(el('td','',money(entry.amount)));
    const desc=el('td');
    desc.append(el('strong','',entry.reference||'No receipt reference'),el('small','cod-expense-row-note',entry.note));
    row.append(desc);
    const actions=el('td');
    actions.append(button('Edit',()=>{
      if(!ensureReady())return;
      editingExpenseId=entry.id;editingExpenseDate=today();
      x('codExpenseType').value=entry.type;
      x('codExpenseAmount').value=centsToInput(entry.amount);
      x('codExpenseRef').value=entry.reference;
      x('codExpenseNote').value=entry.note;
      updateExpenseTypeUI();
      x('codExpenseApproval').checked=entry.approved;
      x('codExpenseSave').textContent='Update Entry';
      x('codExpenseCancel').hidden=false;
      selectCODTab('expense');
      x('codExpenseForm').scrollIntoView({behavior:'smooth',block:'center'});
    }));
    actions.append(button('Remove',()=>{
      if(!ensureReady())return;
      if(!confirm('Remove '+EXPENSE_TYPES[entry.type]+' '+money(entry.amount)+'?'))return;
      const candidate=clone(current());
      candidate.expenses=expenseEntries(candidate).filter(e=>e.id!==entry.id);
      try{validateDay(candidate);}catch(err){alert(err.message);return;}
      db.days[today()]=candidate;
      if(editingExpenseId===entry.id)resetExpenseEditor();
      persist();render();
    },'cod-danger'));
    row.append(actions);rows.append(row);
  }
}
x('codExpenseType').addEventListener('change',updateExpenseTypeUI);
x('codExpenseCancel').addEventListener('click',resetExpenseEditor);
x('codExpenseForm').addEventListener('submit',event=>{
  event.preventDefault();if(!ensureReady())return;
  const type=x('codExpenseType').value;
  if(!Object.prototype.hasOwnProperty.call(EXPENSE_TYPES,type))return alert('Invalid expense category.');
  const amount=parseMoney(x('codExpenseAmount').value);
  if(amount===null||amount<=0)return alert('Enter a valid amount, maximum two decimal places.');
  const reference=x('codExpenseRef').value.trim().slice(0,140);
  const note=x('codExpenseNote').value.trim().slice(0,500);
  if(!note)return alert('Enter a reason or note.');
  const approved=APPROVED_EXPENSES.has(type);
  if(approved&&!x('codExpenseApproval').checked)
    return alert('Confirm this office expense is authorized, or choose Personal Use.');
  if(editingExpenseId&&editingExpenseDate!==today())
    return alert('Work date changed. Reopen the expense for editing.');
  const day=current(),old=editingExpenseId?expenseEntries(day).find(e=>e.id===editingExpenseId):null;
  if(editingExpenseId&&!old)return alert('This entry no longer exists. Refresh the date.');
  const item={
    id:old?.id||uid(),type,amount,reference,note,approved,
    createdAt:old?.createdAt||new Date().toISOString()
  };
  const candidate=clone(day);
  candidate.expenses=old?expenseEntries(candidate).map(e=>e.id===old.id?item:e):
    [...expenseEntries(candidate),item];
  try{validateDay(candidate);}catch(err){alert(err.message);return;}
  db.days[today()]=candidate;
  resetExpenseEditor();persist();render();
  notice((old?'Updated ':'Saved ')+EXPENSE_TYPES[type]+' '+money(amount)+
    '. Original COD and Rider collections were not changed.');
});
updateExpenseTypeUI();

let selectedRiderId = null;
let selectedRiderDate = null;
let transactionFeedback=null;

// The overview Online Payment total is based on rider payments (anything
// except Cash), not Agent payments. Detail rows use that exact same ledger.
function onlineRiderTransactions(day){
  return day.riders.flatMap(rider=>rider.payments
    .filter(payment=>payment.method!=='Cash')
    .map(payment=>({
      riderId:rider.id,riderName:rider.name,method:payment.method,
      amount:payment.amount,reference:payment.reference||''
    })));
}
function renderOnlineTransactionDetails(day){
  const rows=x('codOnlineDetailsRows');
  rows.replaceChildren();
  const entries=onlineRiderTransactions(day);
  const sum=entries.reduce((total,entry)=>total+entry.amount,0);
  x('codOnlineDetailsDate').textContent=today();
  x('codOnlineDetailsCount').textContent=entries.length+
    (entries.length===1?' transaction':' transactions');
  x('codOnlineDetailsTotal').textContent=money(sum);
  if(!entries.length){
    const row=el('tr'),cell=el('td','cod-empty','No online payments recorded for the selected work date.');
    cell.colSpan=4;row.append(cell);rows.append(row);
  }
  for(const payment of entries){
    const row=el('tr');
    row.append(
      el('td','',payment.riderName),
      el('td','',payment.method),
      el('td','',money(payment.amount)),
      el('td','cod-online-reference',payment.reference||'—')
    );
    rows.append(row);
  }
}
const onlineDetailsToggle=x('codOnlineDetailsToggle');
const onlineDetailsPanel=x('codOnlineDetails');
onlineDetailsToggle.addEventListener('click',()=>{
  const opening=onlineDetailsPanel.hidden;
  onlineDetailsPanel.hidden=!opening;
  onlineDetailsToggle.setAttribute('aria-expanded',String(opening));
  if(opening){
    renderOnlineTransactionDetails(current());
    onlineDetailsPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
});
x('codOnlineDetailsClose').addEventListener('click',()=>{
  onlineDetailsPanel.hidden=true;
  onlineDetailsToggle.setAttribute('aria-expanded','false');
  onlineDetailsToggle.focus();
});

function render(){
  const d=current(), target=x('codRiders');
  const date=today();
  if(selectedRiderDate!==date){selectedRiderId=null;selectedRiderDate=date;}
  const dropdown=x('codRiderSelect');
  if(!d.riders.some(r=>r.id===selectedRiderId)){
    selectedRiderId=d.riders[0]?.id||null;
  }
  dropdown.replaceChildren();
  if(!d.riders.length){
    const opt=el('option','', 'No riders — tap Add Rider');
    opt.value='';dropdown.append(opt);
  }
  for(const r of d.riders){
    const opt=el('option','',r.name);
    opt.value=r.id;dropdown.append(opt);
  }
  dropdown.value=selectedRiderId||'';
  dropdown.disabled=!d.riders.length;
  x('codRiderCount').textContent=d.riders.length+' rider'+(d.riders.length===1?'':'s');

  let total=0,collected=0,cash=0,online=0,due=0,over=0;
  for(const r of d.riders){
    const s=sums(r);
    total+=effectiveCOD(d,r.id); collected+=s.paid;
    const riderDiff=effectiveCOD(d,r.id)-s.paid;
    due+=Math.max(0,riderDiff);over+=Math.max(0,-riderDiff);
    for(const p of r.payments){
      if(p.method==='Cash')cash+=p.amount;
      else online+=p.amount;
    }
  }
  // Show original manually-entered Hive COD and adjusted responsibility separately.
  // Transfers never modify the original COD; they only move collection duties.
  // Figures reflect the selected work date, not live Hive data.
  const overview=x('codRiderOverview');
  overview.replaceChildren();
  if(!d.riders.length)overview.append(el('p','cod-empty','No riders for this date.'));
  // Reorder only the overview display: selected rider appears first without
  // changing stored rider order, payment history, Firebase records or totals.
  const ridersInOverview=selectedRiderId
    ? [...d.riders.filter(r=>r.id===selectedRiderId),
       ...d.riders.filter(r=>r.id!==selectedRiderId)]
    : d.riders;
  for(const rider of ridersInOverview){
    const original=originalCOD(d,rider.id);
    const adjusted=effectiveCOD(d,rider.id);
    const movement=transferAmounts(d,rider.id);
    const paid=sums(rider).paid;
    const onlinePaid=rider.payments.reduce((n,p)=>n+(p.method==='Cash'?0:p.amount),0);
    const difference=adjusted-paid;
    const status=difference>0?'Pending':difference<0?'Overpaid':'Paid';
    const statusAmount=Math.abs(difference);
    const card=el('div','cod-rider-overview-card');
    const isSelected=rider.id===selectedRiderId;
    card.classList.toggle('is-selected',isSelected);
    card.setAttribute('aria-pressed',String(isSelected));
    card.tabIndex=0;
    card.setAttribute('role','button');
    card.setAttribute('aria-label','Open '+rider.name+' collection details');
    const top=el('div','cod-rider-overview-top');
    const riderName=el('strong','cod-rider-overview-name',rider.name);
    if(isSelected)riderName.append(el('span','cod-rider-selected-label','SELECTED'));
    top.append(riderName,
      el('span','cod-rider-overview-status '+(difference>0?'is-pending':difference<0?'is-overpaid':'is-paid'),status));
    const metrics=el('div','cod-rider-overview-values');
    for(const [label,value,cls] of [
      ['Original COD',original,'cod-overview-original'],
      ['After Transfer',adjusted,''],
      ['Collected',paid,''],
      [difference>0?'Pending':difference<0?'Overpaid':'Remaining',statusAmount,difference>0?'is-pending':difference<0?'is-overpaid':'is-paid']
    ]){
      const group=el('div','cod-rider-overview-value '+cls);
      group.append(el('small','',label),el('b','',money(value)));
      if(label==='Collected'){
        group.append(el('span','cod-rider-online-paid','Online Paid: '+money(onlinePaid)));
      }
      metrics.append(group);
    }
    card.append(top,metrics);
    if(movement.incoming||movement.outgoing){
      const parts=[];
      if(movement.outgoing)parts.push('Sent to other riders: '+money(movement.outgoing));
      if(movement.incoming)parts.push('Received from other riders: '+money(movement.incoming));
      card.append(el('small','cod-transfer-effect',parts.join(' · ')));
    }
    const choose=()=>{
      if(editingTransferId)resetTransferEditor();
      selectedRiderId=rider.id;render();
      x('codRiderSelect').scrollIntoView({behavior:'smooth',block:'start'});
    };
    card.addEventListener('click',choose);
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}
    });
    overview.append(card);
  }
  const agent=d.agent.reduce((n,p)=>n+p.amount,0);
  for(const [id,n] of [
    ['codTotal',total],['codCash',cash],['codOnline',online],
    ['codCollected',collected],['codDue',due],['codOver',over],
    ['agentExpectedCOD',total],['agentPaid',agent],['agentCollectedTotal',collected]
  ])x(id).textContent=money(n);
  // Keep the open detail panel synchronized with the selected date and edits.
  renderOnlineTransactionDetails(d);
  // The main agent comparison is against the PANEL COD, not collected cash.
  // Keep the cash-reconciliation gap visible as a separate figure.
  const agentVsCOD=agent-total,agentVsCollected=agent-collected;
  const agentLabel=agentVsCOD>0?'Above COD ':agentVsCOD<0?'Below COD ':'Matched ';
  const agentDifference=x('agentBalance');
  agentDifference.textContent=agentLabel+money(Math.abs(agentVsCOD));
  agentDifference.classList.toggle('cod-agent-positive',agentVsCOD>0);
  agentDifference.classList.toggle('cod-agent-negative',agentVsCOD<0);
  x('agentVsCollected').textContent=(agentVsCollected>0?'Paid above collections ':agentVsCollected<0?'Collections held ':'Matched ')+money(Math.abs(agentVsCollected));
  x('agentCodExplanation').textContent=agentVsCOD>0
    ? 'Paid to Agent '+money(agent)+' − Total Panel COD '+money(total)+' = '+money(agentVsCOD)+' paid above COD.'
    :agentVsCOD<0
      ? 'Total Panel COD '+money(total)+' − Paid to Agent '+money(agent)+' = '+money(-agentVsCOD)+' still below COD.'
      :'Paid to Agent equals Total Panel COD.';
  x('codReconcileNote').textContent=due>0
    ? money(due)+' is still outstanding across '+d.riders.filter(r=>effectiveCOD(d,r.id)-sums(r).paid>0).length+' rider(s).'
    : 'All rider COD amounts are settled or overpaid.';
  renderExpenses(d,cash,online,total);
  x('agentReconcile').textContent='Agent vs Panel COD: '+(agentVsCOD>0?money(agentVsCOD)+' above COD':agentVsCOD<0?money(-agentVsCOD)+' below COD':'Matched')+
    '. Agent vs actual collections: '+(agentVsCollected>0?money(agentVsCollected)+' paid above collections':agentVsCollected<0?money(-agentVsCollected)+' still held':'Matched')+
    '. Note: rider pending and overpaid entries explain why collected cash differs from Panel COD.';

  target.replaceChildren();
  const cashQuickEntry=x('codCashQuickEntry');
  cashQuickEntry.replaceChildren();
  const r=d.riders.find(q=>q.id===selectedRiderId);
  cashQuickEntry.hidden=!r;
  if(!r){
    target.append(el('p','cod-empty','Add your first rider to start collecting COD.'));
    x('codRiderStatus').textContent='No rider selected';
  }else{
    // The KM handoff acknowledges a successful save via localStorage.
    // Synchronize that flag with Firestore only when it actually changes.
    try {
      const ack=JSON.parse(localStorage.getItem('adjoy:cod-km-sent:v1')||'{}');
      if(!r.sent&&ack['cod-'+date+'-'+r.id]){r.sent=true;persist();}
    }catch(err){}

    const {paid}=sums(r);
    const riderCashPaid=r.payments.reduce((n,p)=>n+(p.method==='Cash'?p.amount:0),0);
    const riderOnlinePaid=paid-riderCashPaid;
    const riderOriginal=originalCOD(d,r.id),riderMovement=transferAmounts(d,r.id);
    const riderCOD=effectiveCOD(d,r.id),diff=riderCOD-paid;
    const status=diff>0?'Due '+money(diff):diff<0?'Overpaid '+money(-diff):'Fully settled';
    x('codRiderStatus').textContent=status;
    x('codRiderStatus').className='cod-pill '+(diff>0?'cod-pill-due':diff<0?'cod-pill-over':'cod-pill-ok');

    const card=el('article','cod-rider cod-rider-focus');
    const top=el('div','cod-rider-head'), actions=el('div','cod-rider-actions');
    actions.append(button('Send Due to KM',()=>sendToKM(r.id)));
    actions.append(button('Rename Rider',()=>{
      if(!ensureReady())return;
      const n=prompt('Rider name (updates this rider across all work dates):',r.name);
      if(!n||!n.trim())return;
      const name=n.trim().slice(0,90),old=r.name;
      if(normalizedName(name)===normalizedName(old))return;
      if(riderRoster.some(z=>z.id!==r.id&&normalizedName(z.name)===normalizedName(name)))
        return alert('Rider with this name already exists.');
      const member=riderRoster.find(z=>z.id===r.id||normalizedName(z.name)===normalizedName(old));
      if(!member)return alert('This is a historical rider. Add it to the shared list before renaming.');
      // The roster controls future dates. Older completed ledgers retain
      // their original rider labels until explicitly edited.
      member.name=name;r.name=name;rosterDirty=true;
      persist();render();
      notice('Rider renamed for this date and future work dates. Older financial records are unchanged.');
    }));
    actions.append(button('Remove Rider',()=>{
      if(!confirm('Remove '+r.name+' and all the entries for this work date?'))return;
      if(transfersOf(d).some(t=>t.fromId===r.id||t.toId===r.id)){
        alert('This rider has COD transfers. Remove or edit those transfers before deleting the rider.');return;
      }
      d.riders=d.riders.filter(item=>item.id!==r.id);
      const rosterIndex=riderRoster.findIndex(z=>z.id===r.id||
        normalizedName(z.name)===normalizedName(r.name));
      if(rosterIndex>=0){
        riderRoster.splice(rosterIndex,1);rosterDirty=true;
      }
      selectedRiderId=null;persist();render();
    },'cod-danger'));
    const toolsDetail=el('details','cod-rider-tools');
    toolsDetail.append(el('summary','', 'Rider settings'),actions);
    top.append(toolsDetail);card.append(top);

    const metrics=el('div','cod-rider-metrics');
    for(const [name,val,extra] of [
      ['Original COD (Hive)',riderOriginal,'cod-metric-original'],
      ['After Transfer',riderCOD,'cod-metric-adjusted'],
      ['Collected',paid,''],
      [diff>0?'DUE':diff<0?'OVERPAID':'SETTLED',Math.abs(diff),diff>0?'cod-metric-due':diff<0?'cod-metric-over':'cod-metric-ok']
    ]){
      const item=el('div','cod-rider-metric '+extra);
      item.append(el('span','',name),el('strong','',money(val)));
      if(name==='Collected'){
        const split=el('div','cod-collected-breakdown');
        const cashLine=el('div','cod-collected-breakdown-line');
        cashLine.append(el('span','', 'Cash'),el('b','',money(riderCashPaid)));
        const onlineLine=el('div','cod-collected-breakdown-line');
        onlineLine.append(el('span','', 'Online'),el('b','',money(riderOnlinePaid)));
        split.append(cashLine,onlineLine);
        item.append(split);
      }
      metrics.append(item);
    }
    card.append(metrics);
    if(riderMovement.incoming||riderMovement.outgoing){
      const parts=[];
      if(riderMovement.outgoing)parts.push('Sent: '+money(riderMovement.outgoing));
      if(riderMovement.incoming)parts.push('Received: '+money(riderMovement.incoming));
      card.append(el('p','cod-transfer-effect','Transfer record — '+parts.join(' · ')+'. Original COD stays unchanged.'));
    }
    if(r.sent)card.append(el('small','cod-memo',
      'This rider/date already has a COD Due transfer to KM Tracker. Changes here do not adjust that deduction automatically.'));

    renderCODCashAdditions(cashQuickEntry,card,d,r);

    // Transactions are entered and reviewed before transferring rider COD.
    card.append(el('h4','cod-subtitle','Add Transaction'));
    addPaymentForm(card,p=>{
      const before=Math.max(0,effectiveCOD(d,r.id)-sums(r).paid);
      r.payments.push(p);
      const after=Math.max(0,effectiveCOD(d,r.id)-sums(r).paid);
      const details='Transaction '+money(p.amount)+' · Due '+money(before)+' → '+money(after)+
        (after===before?' (already settled; extra payment is overpaid).':'');
      transactionFeedback={date:today(),riderId:r.id,text:details+' · Saving...'};
      const saved=persist();
      render();
      saved.then(ok=>{
        if(transactionFeedback?.date===today()&&transactionFeedback.riderId===r.id){
          transactionFeedback.text=details+(ok?' · Saved to Firebase.':' · SAVE FAILED. Export backup and refresh cloud.');
          const node=x('codTransactionFeedback');
          if(node)node.textContent=transactionFeedback.text;
        }
      });
    });
    if(transactionFeedback?.date===date&&transactionFeedback.riderId===r.id){
      const feedback=el('p','cod-transaction-feedback',transactionFeedback.text);
      feedback.id='codTransactionFeedback';card.append(feedback);
    }
    const paymentsTable=table(r.payments,id=>{
      if(!confirm('Remove this payment?'))return;
      r.payments=r.payments.filter(p=>p.id!==id);
      persist();render();
    },id=>openEditPayment('rider',r.id,id));
    card.append(makeHistory('Transaction History',r.payments.length,'transaction',paymentsTable));
    // Reuse the live transfer form node, preserving attached event listeners.
    card.append(transferPanelNode);
    target.append(card);
  }

  if(r)renderTransferUI(d);
  const at=x('agentRows');
  x('codAgentHistoryCount').textContent='('+d.agent.length+')';
  at.replaceChildren();
  if(!d.agent.length){
    const tr=el('tr'),td=el('td','cod-empty','No agent payments recorded');
    td.colSpan=4;tr.append(td);at.append(tr);
  }
  for(const p of d.agent){
    const tr=el('tr');
    tr.append(el('td','',p.method),el('td','',money(p.amount)));
    const referenceCell=el('td','',p.reference||'—');
    if(p.notes){
      const breakdown=el('small','cod-agent-note-breakdown','Notes: '+noteDescription(p.notes));
      referenceCell.append(breakdown);
    }else if(p.method==='Cash'){
      referenceCell.append(el('small','cod-agent-note-unknown','Note counts not recorded'));
    }
    tr.append(referenceCell);
    const td=el('td');
    td.append(button('Edit',()=>openEditPayment('agent',null,p.id)));
    td.append(button('Remove',()=>{
      if(!confirm('Remove agent payment?'))return;
      d.agent=d.agent.filter(z=>z.id!==p.id);persist();render();
    },'cod-danger'));
    tr.append(td);at.append(tr);
  }
}

/* Two accessible workspaces share the same daily Firebase record; tabs only
   change visibility, never the data, selected date or calculation rules. */
function selectCODTab(tab,moveFocus=false){
  const names=['rider','agent','expense'];
  const next=names.includes(tab)?tab:'rider';
  const tabs={rider:['codRiderTab','codRiderTabPanel'],
    agent:['codAgentTab','codAgentTabPanel'],
    expense:['codExpenseTab','codExpenseTabPanel']};
  for(const name of names){
    const [buttonId,panelId]=tabs[name],active=name===next;
    const btn=x(buttonId),panel=x(panelId);
    btn.setAttribute('aria-selected',String(active));
    btn.tabIndex=active?0:-1;
    btn.classList.toggle('is-active',active);
    panel.hidden=!active;
    if(active&&moveFocus)btn.focus();
  }
}
for(const name of ['rider','agent','expense']){
  const id=name==='rider'?'codRiderTab':name==='agent'?'codAgentTab':'codExpenseTab';
  x(id).addEventListener('click',()=>selectCODTab(name));
  x(id).addEventListener('keydown',event=>{
    const tabs=['rider','agent','expense'];
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs[2]:
      tabs[(tabs.indexOf(name)+(event.key==='ArrowRight'?1:2))%3];
    selectCODTab(next,true);
  });
}
selectCODTab('rider');

x('codRiderSelect').addEventListener('change',e=>{
  if(editingTransferId)resetTransferEditor();
  selectedRiderId=e.target.value;render();
});

function sendToKM(id){const r=current().riders.find(z=>z.id===id);if(!r)return;
const sourceId='cod-'+today()+'-'+r.id;
try{
  const ack=JSON.parse(localStorage.getItem('adjoy:cod-km-sent:v1')||'{}');
  if(ack[sourceId])r.sent=true;
}catch(e){}
const amount=effectiveCOD(current(),r.id)-sums(r).paid;if(amount<=0)return alert('No outstanding COD due for this rider.');if(r.sent)return alert('Due was already sent for this rider/date. Adjust previously sent entry manually in KM Tracker.');const message='Record COD outstanding '+money(amount)+' for '+r.name+' on '+today()+' as a deduction from the rider KM balance? This is NOT a new KM earning and will not auto-adjust if you later collect more COD.';if(!confirm(message))return;
const payload={version:1,sourceId:'cod-'+today()+'-'+r.id,riderName:r.name,date:today(),amountCents:amount,createdAt:Date.now()};try{sessionStorage.setItem('adjoy:cod-km-handoff:v1',JSON.stringify(payload));}catch(e){return alert('Browser session storage unavailable.');}
const route='#page='+encodeURIComponent('pages/rider-km-tracker/rider-km-tracker.html');try{if(window.parent!==window&&window.parent.location.origin===window.location.origin)window.parent.location.hash=route;else location.href='../rider-km-tracker/rider-km-tracker.html';}catch(e){location.href='../rider-km-tracker/rider-km-tracker.html';}}
function shiftWorkDate(days){
  const currentDate=today();
  if(!validDate(currentDate))return alert('Select a valid work date first.');
  const dt=new Date(currentDate+'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate()+days);
  const next=dt.toISOString().slice(0,10);
  if(!validDate(next))return;
  x('codDate').value=next;
  x('codDate').dispatchEvent(new Event('change',{bubbles:true}));
}
x('codPrevDate').addEventListener('click',()=>shiftWorkDate(-1));
x('codNextDate').addEventListener('click',()=>shiftWorkDate(1));
x('codDate').addEventListener('change',()=>{
  if(!validDate(today()))return;
  if(editingTransferId)resetTransferEditor();
  transactionFeedback=null;
  syncUi();render();
});
x('codAddRider').addEventListener('click',()=>{
  if(!ensureReady())return;
  const n=prompt('New rider name (shared across work dates):');
  if(!n||!n.trim())return;
  const name=n.trim().slice(0,90),d=current();
  if(riderRoster.some(r=>normalizedName(r.name)===normalizedName(name))||
     d.riders.some(r=>normalizedName(r.name)===normalizedName(name)))
    return alert('Rider already exists.');
  if(riderRoster.length>=150)return alert('Maximum rider limit reached.');
  const id=uid();riderRoster.push({id,name});rosterDirty=true;
  d.riders.push(dayRider({id,name}));selectedRiderId=id;
  persist();render();
});
x('agentForm').addEventListener('submit',e=>{
  e.preventDefault();if(!ensureReady())return;
  const amount=parseMoney(x('agentAmount').value),method=x('agentMethod').value;
  if(amount===null||amount<=0)return alert('Enter a valid agent payment amount.');
  const entry={id:uid(),method,amount,reference:x('agentReference').value.trim().slice(0,140)};
  const inputNotes=[...x('agentNoteCounter').querySelectorAll('[data-note-value]')];
  if(method==='Cash'){
    const notes=readNotes(inputNotes);
    if(notes===null)return alert('Enter valid whole-number cash note counts.');
    const counted=noteTotal(notes);
    if(counted===null)return alert('Invalid note count.');
    if(counted>0&&counted!==amount)return alert('Cash-note total does not match Amount. Correct it before saving.');
    if(counted>0)entry.notes=notes;
  }
  current().agent.push(entry);
  const saved=persist();
  x('agentForm').reset();render();
  saved.then(ok=>notice(ok?'Agent payment and note breakdown saved to Firebase.':'Agent payment save failed. Check cloud status.'));
});

function generateAgentReportJpg(){
  const day=current();
  const entries=day.agent||[];
  if(!entries.length&&!expenseEntries(day).length)return alert('No agent payments or cash expense records saved for this work date.');
  const cash=entries.filter(p=>p.method==='Cash');
  const online=entries.filter(p=>p.method!=='Cash');
  const sum=list=>list.reduce((n,p)=>n+p.amount,0);
  const paidToAgent=sum(entries);
  const panelCOD=transferStatus(day).base; // Total COD before rider-to-rider transfers
  const riderPayments=day.riders.flatMap(r=>r.payments);
  const cashCollected=riderPayments.filter(p=>p.method==='Cash').reduce((n,p)=>n+p.amount,0);
  const onlineCollected=riderPayments.filter(p=>p.method!=='Cash').reduce((n,p)=>n+p.amount,0);
  const expenseBalance=expenseAccounting(day,cashCollected,onlineCollected,panelCOD);
  const expenseByType=key=>expenseEntries(day).filter(e=>e.type===key).reduce((n,e)=>n+e.amount,0);
  const settlementDifference=paidToAgent-panelCOD;
  const settlementStatus=settlementDifference>0?'AGENT OVERPAID':settlementDifference<0?'AGENT DUE':'SETTLED';
  const counted={};
  for(const denomination of NOTE_VALUES)counted[denomination]=0;
  let notCounted=0;
  for(const p of cash){
    if(p.notes){for(const denom of NOTE_VALUES)counted[denom]+=p.notes[denom]||0;}
    else notCounted+=p.amount;
  }
  const width=1200,height=2200;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const g=canvas.getContext('2d');
  if(!g)return alert('JPG report unavailable in this browser.');
  g.fillStyle='#f4f7fc';g.fillRect(0,0,width,height);
  const rounded=(x,y,w,h,r,fill)=>{
    g.fillStyle=fill;g.beginPath();g.roundRect(x,y,w,h,r);g.fill();
  };
  const label=(value,x,y,size=26,bold=false,color='#263654',align='left')=>{
    g.textAlign=align;g.textBaseline='alphabetic';
    g.font=(bold?'700 ':'400 ')+size+'px Arial, sans-serif';g.fillStyle=color;
    g.fillText(String(value),x,y);
  };
  const m=value=>'BDT '+(value/100).toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2});
  rounded(48,42,1104,2116,22,'#ffffff');
  rounded(48,42,1104,128,22,'#17386a');g.fillStyle='#17386a';g.fillRect(48,115,1104,55);
  label('AGENT CASH HANDOVER REPORT',86,108,36,true,'#ffffff');
  label('AD JOY PANEL  |  Work Date: '+today(),86,149,21,false,'#e2eaff');
  label('Payment Summary',85,230,30,true);
  rounded(85,260,1030,142,14,'#eef4ff');
  label('Total to Agent',112,313,22,false);
  label(m(paidToAgent),112,366,38,true,'#1b3d77');
  label('Cash: '+m(sum(cash)),720,315,22,true);
  label('Online / Other: '+m(sum(online)),720,359,21,false);
  // Agent Due / Overpaid is calculated against TOTAL COD, not rider collections
  // and not only physical cash. Mirrors the Payment Agent panel.
  rounded(85,425,1030,153,14,'#edf3fc');
  label('Agent Settlement vs Total COD',112,464,25,true,'#243e6a');
  label('Total Panel COD',112,508,20,false,'#5a6e8c');
  label(m(panelCOD),112,550,29,true,'#1b3d77');
  label(settlementStatus,650,508,21,true,
    settlementDifference>0?'#ae293d':settlementDifference<0?'#986116':'#177849');
  label(m(Math.abs(settlementDifference)),650,550,30,true,
    settlementDifference>0?'#ae293d':settlementDifference<0?'#986116':'#177849');
  label('Cash Note Denominations',85,631,30,true);
  label('Denomination',114,677,20,true,'#5a6e8c');
  label('Quantity',665,677,20,true,'#5a6e8c');
  label('Amount',1080,677,20,true,'#5a6e8c','right');
  let y=694,totalCount=0,countedCash=0;
  for(const denomination of NOTE_VALUES){
    const qty=counted[denomination]||0;
    totalCount+=qty;countedCash+=denomination*qty*100;
    if(y%2===0)rounded(92,y,1004,53,5,'#f6f8fc');
    label('BDT '+denomination,114,y+36,21);
    label(qty,681,y+36,22,true,'#263654','center');
    label(m(denomination*qty*100),1080,y+36,22,true,'#263654','right');
    y+=57;
  }
  rounded(90,1224,1008,75,12,'#e8f6ed');
  label('Total notes: '+totalCount,114,1271,24,true,'#176846');
  label(m(countedCash),1080,1271,28,true,'#176846','right');
  if(notCounted){
    rounded(90,1317,1008,70,10,'#fff4e6');
    label('Cash without saved note counts',114,1360,21,true,'#8b5a17');
    label(m(notCounted),1080,1360,23,true,'#8b5a17','right');
  }else{
    label('All saved cash payments have recorded note counts.',104,1360,20,false,'#5c708d');
  }
  label('Other Payment Methods',85,1426,26,true);
  const byMethod=new Map();
  for(const p of online)byMethod.set(p.method,(byMethod.get(p.method)||0)+p.amount);
  const otherText=byMethod.size?[...byMethod].map(([key,value])=>key+': '+m(value)).join('   |   '):'None';
  // Wrap long method lines on narrow report space.
  const segments=otherText.match(/.{1,74}(?:\s|$)|.{1,74}/g)||[otherText];
  segments.slice(0,3).forEach((part,i)=>label(part.trim(),104,1468+i*30,19,false,'#3c526f'));
  // Expense ledger is supplemental: never silently lower the Agent-vs-Total-COD figure.
  label('CASH EXPENSE & PERSONAL USE BREAKDOWN',85,1605,26,true);
  rounded(85,1630,1030,360,13,'#f4f7fc');
  for(const [i,entry] of [
    ['Fuel (authorized)',expenseByType('fuel')],
    ['Hub / Office (authorized)',expenseByType('office')],
    ['Other authorized expense',expenseByType('other')],
    ['Personal Use (still owed)',expenseByType('personal')],
    ['Personal Cash Returned',expenseByType('repayment')]
  ].entries()){
    const pos=1683+i*58;
    label(entry[0],113,pos,23,i===3,'#314564');
    label(m(entry[1]),1084,pos,24,true,i===3?'#a22b39':'#28466f','right');
  }
  label('Cash remaining: '+m(expenseBalance.cashRemaining),104,2026,22,true,
    expenseBalance.cashRemaining<0?'#ab293b':'#176846');
  label('Personal outstanding: '+m(expenseBalance.outstanding),1084,2026,22,true,
    expenseBalance.outstanding>0?'#ab293b':'#176846','right');
  label('Authorized expense records require actual approval; personal use is never an expense.',104,2055,17,false,'#64748b');
  g.strokeStyle='#d7e1ef';g.lineWidth=2;g.beginPath();g.moveTo(85,2090);g.lineTo(1114,2090);g.stroke();
  label('Prepared for agent handover',85,2130,20,false,'#64748b');
  label('Report includes the selected date COD, Agent payments and cash expense ledger',1114,2130,15,false,'#64748b','right');
  canvas.toBlob(blob=>{
    if(!blob){alert('Could not generate JPG.');return;}
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='Agent_Cash_Handover_'+today()+'.jpg';
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  },'image/jpeg',0.93);
}
x('codAgentJpg').addEventListener('click',generateAgentReportJpg);

function download(name,content,type){const b=new Blob([content],{type}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
x('codExport').addEventListener('click',()=>{
  const headers=['Date','Type','Rider','Effective COD','Payment Method','Payment Amount','Due','Overpaid','Reference / Remarks','From Rider','To Rider'];
  const lines=[headers],d=current(),names=new Map(d.riders.map(r=>[r.id,r.name]));
  for(const r of d.riders){
    const paid=sums(r).paid,amount=effectiveCOD(d,r.id),difference=amount-paid;
    lines.push([today(),'Rider summary',r.name,centsToInput(amount),'',centsToInput(paid),
      centsToInput(Math.max(0,difference)),centsToInput(Math.max(0,-difference)),r.remarks,'','']);
    for(const p of r.payments)
      lines.push([today(),'Rider payment',r.name,'',p.method,centsToInput(p.amount),'','',p.reference,'','']);
  }
  for(const a of dayAdditions(d))
    lines.push([today(),'Added Panel COD cash',names.get(a.riderId)||'',
      centsToInput(a.amount),'','','','',a.reference,'','']);
  for(const t of transfersOf(d))
    lines.push([today(),'COD transfer','','','',centsToInput(t.amount),'','',t.reference,
      names.get(t.fromId)||'',names.get(t.toId)||'']);
  for(const p of d.agent)
    lines.push([today(),'Agent payment','','',p.method,centsToInput(p.amount),'','',
      p.reference+(p.notes?' | Notes: '+noteDescription(p.notes):''),'','']);
  for(const e of expenseEntries(d))
    lines.push([today(),EXPENSE_TYPES[e.type], '', '', 'Cash',centsToInput(e.amount),'','',
      (e.reference?e.reference+' | ':'')+e.note,'','']);
  const csv='\uFEFF'+lines.map(row=>row.map(v=>{
    let value=String(v??'');
    // Avoid spreadsheet formula injection from user-entered notes/names.
    if(/^[=+@]/.test(value))value="'"+value;
    return '"'+value.replace(/"/g,'""')+'"';
  }).join(',')).join('\r\n');
  download('COD_Collection_'+today()+'.csv',csv,'text/csv;charset=utf-8');
});
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
          date,riders:value.riders,agent:value.agent,transfers:value.transfers||[],codAdditions:value.codAdditions||[],expenses:value.expenses||[],revision:1,
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