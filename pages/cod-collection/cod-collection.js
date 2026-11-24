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
function defaultDay(){return {riders:Array.from({length:5},(_,i)=>({id:uid(),name:'Rider '+(i+1),cod:0,payments:[],remarks:'',sent:false})),agent:[],transfers:[]};}
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
  if(v.transfers!==undefined){
    if(!Array.isArray(v.transfers)||v.transfers.length>3000)throw Error('Invalid COD transfers');
    const refs=new Set(),ids=new Set();
    for(const t of v.transfers){
      if(!t||typeof t.id!=='string'||ids.has(t.id)||
        !riders.has(t.fromId)||!riders.has(t.toId)||t.fromId===t.toId||
        !Number.isSafeInteger(t.amount)||t.amount<=0||
        typeof t.reference!=='string'||!t.reference.trim()||t.reference.length>120||
        refs.has(t.reference.trim().toUpperCase()))throw Error('Invalid/duplicate COD transfer');
      refs.add(t.reference.trim().toUpperCase());ids.add(t.id);
    }
  }
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
        date,riders:data.riders,agent:data.agent,transfers:data.transfers||[],
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
  try { await cleanupExpired(cloudRef,snap.docs); }
  catch(err) { console.warn('Expired COD cleanup skipped; Firestore TTL can delete later:',err); }
  const loaded={version:1,days:{}};
  const versions={};
  for(const doc of snap.docs){
    if(isExpired(doc.id))continue;
    const value=doc.data();
    if(!value||!Array.isArray(value.riders)||!Array.isArray(value.agent))continue;
    validateDay(value);
    loaded.days[doc.id]={riders:value.riders,agent:value.agent,transfers:value.transfers||[]};
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
        date,riders:value.riders,agent:value.agent,transfers:value.transfers||[],
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
        loaded.days[date]={riders:valueRemote.riders,agent:valueRemote.agent,transfers:valueRemote.transfers||[]};
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
/* COD transfers are offsets, never new COD: incoming - outgoing = zero globally. */
function transfersOf(day){return Array.isArray(day.transfers)?day.transfers:[];}
function effectiveCOD(day,riderId,excludingId=null){
  const rider=day.riders.find(r=>r.id===riderId);
  if(!rider)return 0;
  let net=rider.cod;
  for(const t of transfersOf(day)){
    if(t.id===excludingId)continue;
    if(t.fromId===riderId)net-=t.amount;
    if(t.toId===riderId)net+=t.amount;
  }
  return net;
}
function transferStatus(day){
  const base=day.riders.reduce((n,r)=>n+r.cod,0);
  const effective=day.riders.reduce((n,r)=>n+effectiveCOD(day,r.id),0);
  return {base,effective};
}
function safeTransfer(day,t,excludingId=null){
  const validIds=new Set(day.riders.map(r=>r.id));
  if(!validIds.has(t.fromId)||!validIds.has(t.toId)||t.fromId===t.toId)
    return 'Choose two different riders.';
  if(!Number.isSafeInteger(t.amount)||t.amount<=0)return 'Enter a valid transfer amount.';
  if(!t.reference||!t.reference.trim())return 'Parcel CID / unique reference is required.';
  if(transfersOf(day).some(other=>other.id!==excludingId &&
      other.reference.trim().toUpperCase()===t.reference.trim().toUpperCase()))
    return 'This parcel CID / reference has already been transferred today.';
  if(effectiveCOD(day,t.fromId,excludingId)<t.amount)
    return 'Transfer exceeds available COD of the source rider.';
  return null;
}
function sums(r){const paid=r.payments.reduce((n,p)=>n+p.amount,0);return {paid,diff:r.cod-paid};}
function el(tag,cls,content){const a=document.createElement(tag);if(cls)a.className=cls;if(content!==undefined)a.textContent=content;return a;}
function button(label,fn,cls=''){const b=el('button','cod-action '+cls,label);b.type='button';b.addEventListener('click',fn);return b;}
function field(label,value,handler,type='text'){const wrap=el('label');wrap.append(el('span','',label));const input=el('input');input.type=type;input.value=value;input.addEventListener('change',()=>handler(input.value,input));wrap.append(input);return wrap;}
function addPaymentForm(container,callback){const f=el('form','cod-entry-form');const method=el('select');for(const m of methods){const o=el('option','',m);o.value=m;method.append(o);}const amount=el('input');amount.type='number';amount.min='.01';amount.step='.01';amount.placeholder='0.00';amount.required=true;const ref=el('input');ref.maxLength=140;ref.placeholder='Reference / note';for(const [label,input] of [['Method',method],['Amount (BDT)',amount],['Reference',ref]]){const wrap=el('label');wrap.append(el('span','',label),input);f.append(wrap);}const b=el('button','btn btn-primary','+ Add Payment');b.type='submit';f.append(b);f.addEventListener('submit',e=>{e.preventDefault();const v=parseMoney(amount.value);if(v===null||v<=0)return alert('Enter a valid positive amount (maximum two decimals).');callback({id:uid(),method:method.value,amount:v,reference:ref.value.trim().slice(0,140)});f.reset();});container.append(f);}
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
  x('codEditHeading').textContent=kind==='agent'?'Edit Agent Payment':'Edit Rider Payment';
  if(typeof editDialog.showModal==='function')editDialog.showModal();
  else editDialog.setAttribute('open','');
}
function closeEditPayment(){
  editingPayment=null;
  if(typeof editDialog.close==='function')editDialog.close();
  else editDialog.removeAttribute('open');
}
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
  entry.amount=amount;entry.method=method;entry.reference=reference;
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
  const from=x('codTransferFrom'),to=x('codTransferTo');
  const prevFrom=from.value,prevTo=to.value;
  selectOptions(from,d.riders);selectOptions(to,d.riders);
  if(editingTransferId && editingTransferDate!==today())resetTransferEditor();
  if(editingTransferId){
    const t=transfersOf(d).find(z=>z.id===editingTransferId);
    if(!t)resetTransferEditor();
    else {from.value=t.fromId;to.value=t.toId;}
  }else{
    if(d.riders.some(r=>r.id===selectedRiderId))from.value=selectedRiderId;
    else if(d.riders.some(r=>r.id===prevFrom))from.value=prevFrom;
    if(d.riders.some(r=>r.id===prevTo) && prevTo!==from.value)to.value=prevTo;
    else to.value=d.riders.find(r=>r.id!==from.value)?.id||'';
  }
  from.disabled=d.riders.length<2;
  to.disabled=d.riders.length<2;
  x('codTransferSubmit').disabled=d.riders.length<2;
  const panel=x('codTransferHistory');
  panel.replaceChildren();
  if(!transfersOf(d).length){
    panel.append(el('p','cod-empty','No parcel COD transfers for this date.'));
  }
  const names=new Map(d.riders.map(r=>[r.id,r.name]));
  for(const t of transfersOf(d).slice().reverse()){
    const card=el('div','cod-transfer-item');
    const detail=el('div','cod-transfer-detail');
    detail.append(
      el('strong','',money(t.amount)+' · '+(names.get(t.fromId)||'Unknown')+' → '+(names.get(t.toId)||'Unknown')),
      el('small','',t.reference)
    );
    const actions=el('div','cod-transfer-item-actions');
    actions.append(button('Edit',()=>{
      if(!ensureReady())return;
      editingTransferId=t.id;editingTransferDate=today();
      from.value=t.fromId;to.value=t.toId;
      x('codTransferAmount').value=centsToInput(t.amount);
      x('codTransferRef').value=t.reference;
      x('codTransferSubmit').textContent='Update Transfer';
      x('codTransferCancel').hidden=false;
      x('codTransferForm').scrollIntoView({behavior:'smooth',block:'center'});
    }));
    actions.append(button('Remove',()=>{
      if(!ensureReady())return;
      if(!confirm('Remove transfer '+money(t.amount)+' ('+t.reference+')?'))return;
      const candidate=clone(d);candidate.transfers=transfersOf(d).filter(z=>z.id!==t.id);
      if(candidate.riders.some(r=>effectiveCOD(candidate,r.id)<0))
        return alert('Cannot remove this transfer: another rider has already transferred some of its COD onward. Reverse or edit later transfers first.');
      d.transfers=candidate.transfers;
      resetTransferEditor();persist();render();
    },'cod-danger'));
    card.append(detail,actions);panel.append(card);
  }
}
x('codTransferForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(!ensureReady())return;
  const d=current(),amount=parseMoney(x('codTransferAmount').value);
  const fromId=x('codTransferFrom').value,toId=x('codTransferTo').value;
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

let selectedRiderId = null;
let selectedRiderDate = null;

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
  const agent=d.agent.reduce((n,p)=>n+p.amount,0);
  for(const [id,n] of [
    ['codTotal',total],['codCash',cash],['codOnline',online],
    ['codCollected',collected],['codDue',due],['codOver',over],
    ['agentPaid',agent]
  ])x(id).textContent=money(n);
  const balance=collected-agent;
  x('agentBalance').textContent=(balance<0?'Overpaid ':'')+money(Math.abs(balance));
  x('agentBalance').style.color=balance<0?'#be123c':'#172442';
  x('codReconcileNote').textContent=due>0
    ? money(due)+' is still outstanding across '+d.riders.filter(r=>sums(r).diff>0).length+' rider(s).'
    : 'All rider COD amounts are settled or overpaid.';
  x('agentReconcile').textContent=balance>0
    ? 'Money still held for payment agent: '+money(balance)
    :balance<0
      ? 'Agent received '+money(-balance)+' more than recorded rider collections.'
      :'All recorded collections have been settled with agent.';

  target.replaceChildren();
  const r=d.riders.find(q=>q.id===selectedRiderId);
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
    const riderCOD=effectiveCOD(d,r.id),diff=riderCOD-paid;
    const paidCash=r.payments.filter(p=>p.method==='Cash').reduce((n,p)=>n+p.amount,0);
    const paidOnline=paid-paidCash;
    const status=diff>0?'Due '+money(diff):diff<0?'Overpaid '+money(-diff):'Fully settled';
    x('codRiderStatus').textContent=status;
    x('codRiderStatus').className='cod-pill '+(diff>0?'cod-pill-due':diff<0?'cod-pill-over':'cod-pill-ok');

    const card=el('article','cod-rider cod-rider-focus');
    const top=el('div','cod-rider-head'), actions=el('div','cod-rider-actions');
    actions.append(button('Send Due to KM',()=>sendToKM(r.id)));
    actions.append(button('Remove Rider',()=>{
      if(!confirm('Remove '+r.name+' and all the entries for this work date?'))return;
      if(transfersOf(d).some(t=>t.fromId===r.id||t.toId===r.id)){
        alert('This rider has COD transfers. Remove or edit those transfers before deleting the rider.');return;
      }
      d.riders=d.riders.filter(item=>item.id!==r.id);
      selectedRiderId=null;persist();render();
    },'cod-danger'));
    top.append(actions);card.append(top);

    const fields=el('div','cod-rider-fields');
    fields.append(field('Panel COD (BDT)',centsToInput(r.cod),(v,inp)=>{
      const n=parseMoney(v);
      if(n===null){alert('Invalid amount');inp.value=centsToInput(r.cod);return;}
      if(n!==r.cod && n<0){alert('Invalid COD amount');return;}
      const old=r.cod;r.cod=n;
      if(effectiveCOD(d,r.id)<0){r.cod=old;alert('COD would fall below transfers already sent from this rider. Edit a transfer first.');inp.value=centsToInput(old);return;}
      persist();render();
    },'number'));
    fields.append(field('Remarks',r.remarks,(v)=>{r.remarks=v.slice(0,300);persist();},'text'));
    card.append(fields);

    const metrics=el('div','cod-rider-metrics');
    for(const [name,val,extra] of [
      ['Panel COD',riderCOD,''],
      ['Cash',paidCash,''],
      ['Online',paidOnline,''],
      ['Total Paid',paid,''],
      [diff>0?'DUE':diff<0?'OVERPAID':'SETTLED',Math.abs(diff),diff>0?'cod-metric-due':diff<0?'cod-metric-over':'cod-metric-ok']
    ]){
      const item=el('div','cod-rider-metric '+extra);
      item.append(el('span','',name),el('strong','',money(val)));
      metrics.append(item);
    }
    card.append(metrics);
    if(diff>0)card.append(el('p','cod-due-explainer',
      'Outstanding: '+money(riderCOD)+' assigned COD − '+money(paid)+' collected = '+money(diff)+' still due.'));
    else if(diff<0)card.append(el('p','cod-due-explainer cod-paid-note',
      'Overpaid by '+money(-diff)+'. Please verify the extra payment.'));
    else card.append(el('p','cod-due-explainer cod-paid-note','All COD for this rider has been collected.'));
    if(r.sent)card.append(el('small','cod-memo',
      'This rider/date already has a COD Due transfer to KM Tracker. Changes here do not adjust that deduction automatically.'));

    const sub=el('h4','cod-subtitle','Payment History');
    card.append(sub,table(r.payments,id=>{
      if(!confirm('Remove this payment?'))return;
      r.payments=r.payments.filter(p=>p.id!==id);
      persist();render();
    },id=>openEditPayment('rider',r.id,id)));
    card.append(el('h4','cod-subtitle','Add Cash or Online Payment'));
    addPaymentForm(card,p=>{r.payments.push(p);persist();render();});
    target.append(card);
  }

  renderTransferUI(d);
  const at=x('agentRows');
  at.replaceChildren();
  if(!d.agent.length){
    const tr=el('tr'),td=el('td','cod-empty','No agent payments recorded');
    td.colSpan=4;tr.append(td);at.append(tr);
  }
  for(const p of d.agent){
    const tr=el('tr');
    [p.method,money(p.amount),p.reference||'—'].forEach(v=>tr.append(el('td','',v)));
    const td=el('td');
    td.append(button('Edit',()=>openEditPayment('agent',null,p.id)));
    td.append(button('Remove',()=>{
      if(!confirm('Remove agent payment?'))return;
      d.agent=d.agent.filter(z=>z.id!==p.id);persist();render();
    },'cod-danger'));
    tr.append(td);at.append(tr);
  }
}
x('codRiderSelect').addEventListener('change',e=>{
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
x('codDate').addEventListener('change',()=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(today()))return;render();});
x('codAddRider').addEventListener('click',()=>{const n=prompt('Rider name:');if(!n||!n.trim())return;const d=current();if(d.riders.some(r=>r.name.toLowerCase()===n.trim().toLowerCase()))return alert('Rider already exists for this day.');const rider={id:uid(),name:n.trim().slice(0,90),cod:0,payments:[],remarks:'',sent:false};d.riders.push(rider);selectedRiderId=rider.id;persist();render();});
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
          date,riders:value.riders,agent:value.agent,transfers:value.transfers||[],revision:1,
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