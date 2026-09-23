let cfg=window.OSCAR_CONFIG||{};
let db=null;
let token='';
let appointment=null;
let selectedMoveSlot=null;
let bookingRules={min_notice_minutes:120,max_advance_days:60};

const $=s=>document.querySelector(s);

async function loadRuntimeConfig(){
  try{
    const r=await fetch('/api/public-config',{cache:'no-store'});
    if(r.ok) cfg={...cfg,...await r.json()};
  }catch{}
  const key=cfg.supabasePublishableKey||cfg.supabaseAnonKey;
  if(cfg.supabaseUrl&&key&&window.supabase) db=window.supabase.createClient(cfg.supabaseUrl,key);
}

function statusLabel(status){
  return ({pending:'En attente',confirmed:'Confirmé',rejected:'Refusé',cancelled:'Annulé',completed:'Terminé',no_show:'Absent'})[status]||status;
}
function formatDate(iso){
  const d=new Date(iso);
  const date=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(d);
  const time=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(d);
  return `${date.charAt(0).toUpperCase()+date.slice(1)} à ${time}`;
}
function localDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
function addDaysKey(key,days){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+days,12)).toISOString().slice(0,10);
}
function showStatus(message,ok=false){
  const el=$('#manageStatusBox');
  el.textContent=message;
  el.className='status-box show';
  el.style.background=ok?'#edf6f2':'#fff0ee';
  el.style.color=ok?'#173f37':'#8c392f';
}
async function api(method,body){
  const url=method==='GET'?'/api/manage-appointment?token='+encodeURIComponent(token):'/api/manage-appointment';
  const r=await fetch(url,{
    method,
    headers:method==='POST'?{'Content-Type':'application/json'}:undefined,
    body:method==='POST'?JSON.stringify({token,...body}):undefined,
    cache:'no-store'
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||'Impossible de gérer ce rendez-vous');
  return data;
}

async function loadRules(){
  if(!db) return;
  const {data}=await db.rpc('get_public_booking_rules');
  const row=Array.isArray(data)?data[0]:data;
  if(row) bookingRules={...bookingRules,...row};
}

function render(){
  const a=appointment;
  if(!a) return;
  const s=a.services||{};
  $('#manageTitle').textContent=`${a.customer_name||'Ton rendez-vous'}`;
  $('#manageStatus').textContent=statusLabel(a.status);
  $('#manageStatus').className=`badge ${a.status}`;
  $('#manageDate').textContent=formatDate(a.starts_at);
  $('#manageService').textContent=s.name||'Prestation';
  $('#manageDuration').textContent=`${s.duration_minutes||0} min`;
  $('#managePrice').textContent=`${((s.price_cents||0)/100).toLocaleString('fr-FR',{maximumFractionDigits:2})} €`;
  $('#managePendingNote').classList.toggle('hidden',a.status!=='pending');

  const editable=['pending','confirmed'].includes(a.status)&&new Date(a.starts_at)>new Date();
  $('#manageActions').classList.toggle('hidden',!editable);
  $('#calendarAction').classList.toggle('hidden',a.status!=='confirmed');
  $('#rebookBtn').href=`/?service=${encodeURIComponent(s.slug||'')}`;

  const date=$('#manageMoveDate');
  date.min=localDateKey();
  date.max=addDaysKey(localDateKey(),Number(bookingRules.max_advance_days||60));

  $('#manageLoading').classList.add('hidden');
  $('#manageError').classList.add('hidden');
  $('#manageView').classList.remove('hidden');
}

async function loadAppointment(){
  try{
    const data=await api('GET');
    appointment=data.appointment;
    render();
  }catch(err){
    $('#manageLoading').classList.add('hidden');
    $('#manageView').classList.add('hidden');
    $('#manageError').classList.remove('hidden');
    $('#manageErrorText').textContent=err.message||'Lien invalide.';
  }
}

function slotButton(slot){
  return `<button type="button" class="slot" data-move-slot="${slot.slot}"><span>${slot.slot}</span>${slot.recommended?'<small>Conseillé</small>':''}</button>`;
}

async function loadMoveSlots(){
  selectedMoveSlot=null;
  const date=$('#manageMoveDate').value;
  if(!date||!db||!appointment?.services?.slug) return;
  $('#manageMoveSlots').innerHTML='<span class="small">Chargement des créneaux…</span>';
  try{
    const {data,error}=await db.rpc('get_available_slots',{p_date:date,p_service_slug:appointment.services.slug});
    if(error) throw error;
    const slots=(data||[]).map(x=>({slot:String(x.slot||x).slice(0,5),recommended:Boolean(x.recommended)})).filter(x=>x.slot);
    $('#manageMoveSlots').innerHTML=slots.length?`<div class="slot-grid">${slots.map(slotButton).join('')}</div>`:'<span class="small">Aucun autre créneau disponible ce jour.</span>';
  }catch(err){
    $('#manageMoveSlots').innerHTML='<span class="small">Impossible de charger les créneaux.</span>';
  }
}

async function moveAppointment(slot){
  const date=$('#manageMoveDate').value;
  if(!date||!slot) return;
  if(!confirm(`Déplacer ton rendez-vous au ${date} à ${slot} ?`)) return;
  try{
    const data=await api('POST',{action:'move',date,time:slot});
    appointment=data.appointment;
    $('#moveClientPanel').classList.add('hidden');
    showStatus('Ton rendez-vous a bien été déplacé.',true);
    render();
  }catch(err){showStatus(err.message||'Impossible de déplacer le rendez-vous.');}
}

async function cancelAppointment(){
  if(!confirm('Annuler définitivement ce rendez-vous ? Le créneau sera libéré.')) return;
  try{
    const data=await api('POST',{action:'cancel'});
    appointment=data.appointment;
    showStatus('Ton rendez-vous a été annulé et le créneau est libéré.',true);
    render();
  }catch(err){showStatus(err.message||'Impossible d’annuler le rendez-vous.');}
}

function calendarDate(iso){
  return new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
}
function addToCalendar(){
  if(!appointment) return;
  const s=appointment.services||{};
  const ics=[
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Oscar Blends//RDV//FR',
    'BEGIN:VEVENT',
    `UID:${appointment.id}@oscarblends`,
    `DTSTAMP:${calendarDate(new Date().toISOString())}`,
    `DTSTART:${calendarDate(appointment.starts_at)}`,
    `DTEND:${calendarDate(appointment.ends_at)}`,
    `SUMMARY:Oscar Blends - ${String(s.name||'Rendez-vous').replace(/[,;]/g,' ')}`,
    'DESCRIPTION:Rendez-vous confirmé chez Oscar Blends',
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='rendez-vous-oscar-blends.ics';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-move-slot]');
  if(btn) moveAppointment(btn.dataset.moveSlot);
});

document.addEventListener('DOMContentLoaded',async()=>{
  token=new URLSearchParams(location.search).get('t')||'';
  if(!token){
    $('#manageLoading').classList.add('hidden');
    $('#manageError').classList.remove('hidden');
    $('#manageErrorText').textContent='Ce lien de gestion est incomplet.';
    return;
  }
  await loadRuntimeConfig();
  await loadRules();
  await loadAppointment();

  $('#showMoveBtn').addEventListener('click',()=>{
    $('#moveClientPanel').classList.remove('hidden');
    $('#manageMoveDate').value='';
    $('#manageMoveSlots').innerHTML='<span class="small">Choisis une date.</span>';
    $('#moveClientPanel').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('#closeMoveBtn').addEventListener('click',()=>$('#moveClientPanel').classList.add('hidden'));
  $('#manageMoveDate').addEventListener('change',loadMoveSlots);
  $('#cancelClientBtn').addEventListener('click',cancelAppointment);
  $('#calendarBtn').addEventListener('click',addToCalendar);
});
