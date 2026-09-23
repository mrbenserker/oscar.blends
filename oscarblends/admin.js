let cfg = window.OSCAR_CONFIG || {};
let isDemo = true;
let db = null;
let emailEnabled = false;

const state = {
  appointments: [],
  closures: [],
  openingHours: [],
  services: [],
  pendingHoldMinutes: 1440,
  agendaRange: 'today',
  activeView: 'dashboard',
  clientSearch: ''
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const ACTIVE_STATUSES = new Set(['pending','confirmed']);
const WEEKDAYS = [
  {id:1,label:'Lundi'}, {id:2,label:'Mardi'}, {id:3,label:'Mercredi'},
  {id:4,label:'Jeudi'}, {id:5,label:'Vendredi'}, {id:6,label:'Samedi'},
  {id:0,label:'Dimanche'}
];

async function loadRuntimeConfig(){
  try{
    const r=await fetch('/api/public-config',{cache:'no-store'});
    if(r.ok){
      const runtime=await r.json();
      cfg={...cfg,...runtime};
      window.OSCAR_CONFIG=cfg;
      emailEnabled=Boolean(runtime.emailEnabled);
    }
  }catch(e){ console.warn('Configuration serveur indisponible, mode démo conservé.',e); }
  const publicKey=cfg.supabasePublishableKey||cfg.supabaseAnonKey;
  isDemo=!cfg.supabaseUrl||cfg.supabaseUrl==='demo'||!publicKey||publicKey==='demo';
  if(!isDemo && window.supabase) db=window.supabase.createClient(cfg.supabaseUrl,publicKey);
}

function esc(v=''){ return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function safeTel(v=''){ return String(v).replace(/[^0-9+]/g,''); }
function addMinutesToTime(hhmm,min){
  const [h,m]=String(hhmm).slice(0,5).split(':').map(Number);
  const total=Math.min(23*60+59,h*60+m+min);
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
function timeMinutes(v){ const [h,m]=String(v).slice(0,5).split(':').map(Number); return h*60+m; }
function parisDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
function addDaysKey(key,days){
  const [y,m,d]=key.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d+days,12,0,0));
  return dt.toISOString().slice(0,10);
}
function appointmentDateKey(a){ return a.starts_at ? parisDateKey(new Date(a.starts_at)) : (a.date||''); }
function fmtDateKey(key,options={weekday:'long',day:'numeric',month:'long'}){
  const [y,m,d]=key.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d,12,0,0));
  const text=new Intl.DateTimeFormat('fr-FR',{timeZone:'UTC',...options}).format(date);
  return text.charAt(0).toUpperCase()+text.slice(1);
}
function fmtTime(iso){ return new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(iso)); }
function fmtRange(a){
  if(a.starts_at&&a.ends_at) return `${fmtTime(a.starts_at)} – ${fmtTime(a.ends_at)}`;
  const start=(a.time||'').slice(0,5);
  const duration=Number(a.duration_minutes||a.duration||0);
  return `${start} – ${addMinutesToTime(start,duration)}`;
}
function statusLabel(a){
  if(a.status==='cancelled'&&String(a.cancellation_reason||'').toLowerCase().includes('délai')) return 'Expiré';
  return ({pending:'En attente',confirmed:'Confirmé',rejected:'Refusé',cancelled:'Annulé'})[a.status]||a.status;
}
function priceLabel(a){ const cents=Number(a.price_cents??((a.price||0)*100)); return `${(cents/100).toLocaleString('fr-FR',{maximumFractionDigits:2})} €`; }
function durationLabel(a){ const d=Number(a.duration_minutes||a.duration||0); return d>=60?`${Math.floor(d/60)} h${d%60?` ${d%60}`:''}`:`${d} min`; }
function isActive(a){ return ACTIVE_STATUSES.has(a.status); }

function showFlash(message,type='success'){
  const el=$('#adminFlash');
  if(!el) return;
  el.textContent=message;
  el.className=`status-box show admin-flash ${type}`;
  window.clearTimeout(showFlash._timer);
  showFlash._timer=window.setTimeout(()=>el.classList.remove('show'),6000);
}

function expireDemo(){
  const list=JSON.parse(localStorage.getItem('oscar_demo_appointments')||'[]');
  const now=Date.now();
  let changed=false;
  list.forEach(a=>{
    if(a.status==='pending'&&a.expires_at&&new Date(a.expires_at).getTime()<=now){
      a.status='cancelled';
      a.cancellation_reason='Délai de confirmation dépassé';
      changed=true;
    }
  });
  if(changed) localStorage.setItem('oscar_demo_appointments',JSON.stringify(list));
  return list;
}
function setDemoAppointments(list){ localStorage.setItem('oscar_demo_appointments',JSON.stringify(list)); }

async function loadAppointments(){
  if(isDemo){ state.appointments=expireDemo(); return; }
  try {
    await db.rpc('expire_pending_appointments');
  } catch (error) {
    console.warn('Expiration automatique temporairement indisponible.', error);
  }
  const {data,error}=await db.from('appointments_admin').select('*').order('starts_at',{ascending:true});
  if(error) throw error;
  state.appointments=data||[];
}
async function loadClosures(){
  if(isDemo){ state.closures=JSON.parse(localStorage.getItem('oscar_demo_closures')||'[]'); return; }
  const {data,error}=await db.from('closures').select('*').order('closed_date',{ascending:true}).order('start_time',{ascending:true});
  if(error) throw error;
  state.closures=data||[];
}
async function loadSettings(){
  if(isDemo){ state.pendingHoldMinutes=Number(localStorage.getItem('oscar_demo_pending_hold_minutes')||cfg.pendingHoldMinutes||1440); return; }
  const {data,error}=await db.from('booking_settings').select('pending_hold_minutes').eq('id',1).maybeSingle();
  if(error) throw error;
  state.pendingHoldMinutes=Number(data?.pending_hold_minutes||1440);
}
async function loadServices(){
  if(isDemo){
    state.services=[
      {slug:'classique',name:'Le Classique',price_cents:2200,duration_minutes:50},
      {slug:'barbe-clean',name:'Barbe Clean',price_cents:1500,duration_minutes:30},
      {slug:'barbe-old-school',name:'Barbe Old School',price_cents:2300,duration_minutes:50},
      {slug:'ptit-blend',name:"Le P'tit Blend",price_cents:1500,duration_minutes:40},
      {slug:'rituel-royal',name:'Le Rituel Royal',price_cents:3800,duration_minutes:75},
      {slug:'gentleman',name:'Le Gentleman',price_cents:3200,duration_minutes:65},
      {slug:'mise-a-zero',name:'La Mise à Zéro',price_cents:1900,duration_minutes:30}
    ];
    return;
  }
  const {data,error}=await db.from('services').select('slug,name,price_cents,duration_minutes,active,sort_order').eq('active',true).order('sort_order',{ascending:true});
  if(error) throw error;
  state.services=data||[];
}

async function loadOpeningHours(){
  if(isDemo){
    try{
      const saved=JSON.parse(localStorage.getItem('oscar_demo_schedule')||'null');
      if(saved){ state.openingHours=demoScheduleToRows(saved); return; }
    }catch{}
    state.openingHours=demoScheduleToRows(cfg.demoWorkingSessions||{});
    return;
  }
  const {data,error}=await db.from('opening_hours').select('*').order('weekday',{ascending:true}).order('start_time',{ascending:true});
  if(error) throw error;
  state.openingHours=data||[];
}

function demoScheduleToRows(schedule){
  const rows=[];
  Object.entries(schedule||{}).forEach(([weekday,sessions])=>{
    (sessions||[]).forEach((s,i)=>rows.push({
      id:`demo-${weekday}-${i}`,
      weekday:Number(weekday),
      start_time:s.start,
      end_time:s.finishBy||addMinutesToTime(s.lastStart||s.start,75),
      latest_start_time:s.lastStart||null,
      slot_interval_minutes:15,
      active:true
    }));
  });
  return rows;
}

async function loadAll(){
  try{
    await Promise.all([loadAppointments(),loadClosures(),loadSettings(),loadOpeningHours(),loadServices()]);
    renderEverything();
  }catch(error){
    console.error(error);
    if(error?.code==='PGRST301'||String(error?.message||'').toLowerCase().includes('jwt')) return showLogin();
    showFlash(error.message||'Impossible de charger le planning.','error');
  }
}

function renderEverything(){
  renderMetrics();
  renderDashboard();
  renderAgenda();
  renderRequests();
  renderClients();
  renderClosures();
  renderSettings();
  renderEmailState();
  populateManualServices();
}

function renderMetrics(){
  const today=parisDateKey();
  const active=state.appointments.filter(isActive);
  const todayList=active.filter(a=>appointmentDateKey(a)===today);
  const confirmedToday=todayList.filter(a=>a.status==='confirmed');
  const now=Date.now();
  const next=active
    .filter(a=>new Date(a.starts_at||`${a.date}T${a.time}`).getTime()>=now)
    .sort((a,b)=>new Date(a.starts_at||`${a.date}T${a.time}`)-new Date(b.starts_at||`${b.date}T${b.time}`))[0];
  $('#metricToday').textContent=todayList.length;
  $('#metricPending').textContent=state.appointments.filter(a=>a.status==='pending').length;
  $('#metricRevenue').textContent=`${(confirmedToday.reduce((sum,a)=>sum+Number(a.price_cents||0),0)/100).toLocaleString('fr-FR',{maximumFractionDigits:2})} €`;
  $('#metricNext').textContent=next?fmtTime(next.starts_at):'—';
  $('#metricNextName').textContent=next?(next.customer_name||'Client'):'Aucun à venir';
  const pending=state.appointments.filter(a=>a.status==='pending').length;
  $('#pendingPill').textContent=pending;
  $('#pendingPill').classList.toggle('hidden',pending===0);
}

function agendaDateKeys(){
  const today=parisDateKey();
  if(state.agendaRange==='tomorrow') return [addDaysKey(today,1)];
  if(state.agendaRange==='week') return Array.from({length:7},(_,i)=>addDaysKey(today,i));
  return [today];
}

function filterAgenda(){
  const keys=agendaDateKeys();
  const start=keys[0], end=keys[keys.length-1];
  return state.appointments
    .filter(a=>isActive(a))
    .filter(a=>{ const k=appointmentDateKey(a); return k>=start&&k<=end; })
    .sort((a,b)=>new Date(a.starts_at||`${a.date}T${a.time}`).getTime()-new Date(b.starts_at||`${b.date}T${b.time}`).getTime());
}

function weekdayForDateKey(key){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,12,0,0)).getUTCDay();
}

function emptyDayContent(key){
  const fullDayClosure=state.closures.find(c=>c.closed_date===key&&!c.start_time&&!c.end_time);
  if(fullDayClosure){
    return `<div class="agenda-empty-day unavailable"><strong>Journée indisponible</strong><span>${fullDayClosure.reason?esc(fullDayClosure.reason):'Aucun rendez-vous proposé ce jour.'}</span></div>`;
  }
  const weekday=weekdayForDateKey(key);
  const isOpen=state.openingHours.some(r=>Number(r.weekday)===weekday&&r.active!==false);
  if(!isOpen){
    return '<div class="agenda-empty-day closed"><strong>Fermé</strong><span>Aucun horaire de travail configuré pour cette journée.</span></div>';
  }
  return '<div class="agenda-empty-day"><strong>Journée libre</strong><span>Aucun rendez-vous pour le moment.</span></div>';
}

function renderAgenda(){
  $$('#agendaRange button').forEach(b=>b.classList.toggle('active',b.dataset.range===state.agendaRange));
  const list=filterAgenda();
  const root=$('#agendaList');
  const groups=new Map();
  list.forEach(a=>{
    const key=appointmentDateKey(a);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(a);
  });
  const keys=agendaDateKeys();
  root.innerHTML=keys.map(key=>{
    const items=groups.get(key)||[];
    return `<section class="agenda-day">
      <div class="agenda-day-head"><strong>${esc(dayHeading(key))}</strong><span>${items.length?`${items.length} rendez-vous`:'0 rendez-vous'}</span></div>
      <div class="agenda-day-items">${items.length?items.map(appointmentCard).join(''):emptyDayContent(key)}</div>
    </section>`;
  }).join('');
}

function dayHeading(key){
  const today=parisDateKey();
  if(key===today) return `Aujourd’hui · ${fmtDateKey(key,{day:'numeric',month:'long'})}`;
  if(key===addDaysKey(today,1)) return `Demain · ${fmtDateKey(key,{day:'numeric',month:'long'})}`;
  return fmtDateKey(key);
}

function remainingLabel(expiresAt){
  if(!expiresAt) return '';
  const ms=new Date(expiresAt).getTime()-Date.now();
  if(ms<=0) return 'Expiration en cours';
  const min=Math.ceil(ms/60000);
  if(min<60) return `Expire dans ${min} min`;
  const h=Math.floor(min/60), rem=min%60;
  if(h<24) return `Expire dans ${h} h${rem?` ${rem} min`:''}`;
  const d=Math.floor(h/24); return `Expire dans ${d} j`;
}

function appointmentCard(a){
  const name=esc(a.customer_name||a.name||'Client');
  const service=esc(a.service_name||a.service_slug||a.service||'Prestation');
  const phone=esc(a.phone||'');
  const email=esc(a.email||'');
  const notes=esc(a.notes||'');
  const pendingTimer=a.status==='pending'&&a.expires_at?`<span class="pending-timer">${esc(remainingLabel(a.expires_at))}</span>`:'';
  const actions=[];
  if(a.status==='pending'){
    actions.push(`<button class="btn btn-primary btn-small" type="button" data-appt-action="confirm" data-id="${esc(a.id)}">Confirmer</button>`);
    actions.push(`<button class="btn btn-secondary btn-small" type="button" data-appt-action="reject" data-id="${esc(a.id)}">Refuser</button>`);
  }else if(a.status==='confirmed'){
    actions.push(`<button class="btn btn-secondary btn-small danger-outline" type="button" data-appt-action="cancel" data-id="${esc(a.id)}">Annuler le RDV</button>`);
  }
  if(['pending','confirmed'].includes(a.status)){
    actions.push(`<button class="btn btn-secondary btn-small" type="button" data-move-appt="${esc(a.id)}">Déplacer</button>`);
  }
  if(a.phone||a.email){
    actions.push(`<button class="btn btn-secondary btn-small" type="button" data-client-history="${esc(clientKey(a))}">Historique</button>`);
  }
  if(a.status==='confirmed'&&emailEnabled&&!a.confirmation_email_sent_at){
    actions.push(`<button class="btn btn-secondary btn-small" type="button" data-appt-action="resend_confirmation" data-id="${esc(a.id)}">Envoyer l’e-mail</button>`);
  }

  const contacts=[];
  if(a.phone) contacts.push(`<a href="tel:${safeTel(a.phone)}">${phone}</a>`);
  if(a.email) contacts.push(`<a href="mailto:${encodeURIComponent(a.email)}">${email}</a>`);

  return `<article class="agenda-item status-${esc(a.status)}">
    <div class="agenda-time"><strong>${esc(fmtRange(a))}</strong><span>${esc(durationLabel(a))}</span></div>
    <div class="agenda-body">
      <div class="agenda-title-row"><div><strong>${name}</strong><span>${service} · ${esc(priceLabel(a))}</span></div><span class="badge ${esc(a.status)}">${esc(statusLabel(a))}</span></div>
      ${pendingTimer}
      <div class="agenda-contact">${contacts.join('<span>·</span>')}</div>
      ${notes?`<div class="agenda-notes">${notes}</div>`:''}
      ${a.confirmation_email_sent_at?'<div class="email-delivery success">✓ Confirmation e-mail envoyée</div>':''}
      ${a.confirmation_email_error&&emailEnabled?`<div class="email-delivery error">E-mail non envoyé · ${esc(a.confirmation_email_error)}</div>`:''}
      ${actions.length?`<div class="appt-actions">${actions.join('')}</div>`:''}
    </div>
  </article>`;
}


function renderDashboard(){
  const today=parisDateKey();
  const todayList=state.appointments.filter(a=>isActive(a)&&appointmentDateKey(a)===today)
    .sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const now=Date.now();
  const next=todayList.find(a=>new Date(a.starts_at).getTime()>=now);
  const confirmed=todayList.filter(a=>a.status==='confirmed');
  const pending=todayList.filter(a=>a.status==='pending');
  const revenue=confirmed.reduce((sum,a)=>sum+Number(a.price_cents||0),0)/100;
  $('#dashboardDate').textContent=fmtDateKey(today);
  $('#dashboardNext').innerHTML=next?
    `<div class="dashboard-next-time">${esc(fmtTime(next.starts_at))}</div><strong>${esc(next.customer_name||'Client')}</strong><span>${esc(next.service_name||'Prestation')} · ${esc(durationLabel(next))}</span>`:
    '<div class="empty-state compact"><strong>Aucun autre rendez-vous aujourd’hui.</strong></div>';
  $('#dashboardSummary').innerHTML=`
    <div><strong>${todayList.length}</strong><span>RDV actifs</span></div>
    <div><strong>${pending.length}</strong><span>à confirmer</span></div>
    <div><strong>${revenue.toLocaleString('fr-FR',{maximumFractionDigits:2})} €</strong><span>CA prévu</span></div>`;
  $('#dashboardTodayList').innerHTML=todayList.length?todayList.map(appointmentCard).join(''):'<div class="agenda-empty-day"><strong>Journée libre</strong><span>Aucun rendez-vous pour le moment.</span></div>';
}

function clientKey(a){
  const email=String(a.email||'').trim().toLowerCase();
  if(email) return 'e:'+email;
  const phone=safeTel(a.phone||'');
  return 'p:'+phone;
}
function buildClients(){
  const map=new Map();
  state.appointments.forEach(a=>{
    const key=clientKey(a);
    if(key==='p:') return;
    if(!map.has(key)) map.set(key,{key,name:a.customer_name||'Client',phone:a.phone||'',email:a.email||'',appointments:[]});
    const client=map.get(key);
    if((a.customer_name||'').length>(client.name||'').length) client.name=a.customer_name;
    if(!client.phone&&a.phone) client.phone=a.phone;
    if(!client.email&&a.email) client.email=a.email;
    client.appointments.push(a);
  });
  return [...map.values()].map(client=>{
    client.appointments.sort((a,b)=>new Date(b.starts_at||b.created_at)-new Date(a.starts_at||a.created_at));
    client.total=client.appointments.length;
    client.completedLike=client.appointments.filter(a=>a.status==='confirmed'&&new Date(a.starts_at)<new Date()).length;
    client.cancelled=client.appointments.filter(a=>['cancelled','rejected'].includes(a.status)).length;
    client.next=client.appointments.filter(a=>isActive(a)&&new Date(a.starts_at)>=new Date()).sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at))[0]||null;
    client.last=client.appointments.find(a=>new Date(a.starts_at)<new Date())||null;
    return client;
  }).sort((a,b)=>(b.next?1:0)-(a.next?1:0)||a.name.localeCompare(b.name,'fr'));
}
function renderClients(){
  const root=$('#clientList');
  if(!root) return;
  const q=String(state.clientSearch||'').trim().toLowerCase();
  let clients=buildClients();
  if(q) clients=clients.filter(c=>[c.name,c.phone,c.email].some(v=>String(v||'').toLowerCase().includes(q)));
  $('#clientCount').textContent=`${clients.length} client${clients.length>1?'s':''}`;
  root.innerHTML=clients.length?clients.map(c=>`
    <article class="client-card">
      <div class="client-main"><strong>${esc(c.name)}</strong><span>${esc(c.phone||'')}${c.phone&&c.email?' · ':''}${esc(c.email||'')}</span></div>
      <div class="client-meta"><span><b>${c.total}</b> réservation${c.total>1?'s':''}</span><span>${c.next?`Prochain : ${esc(fmtDateKey(appointmentDateKey(c.next),{day:'numeric',month:'short'}))} à ${esc(fmtTime(c.next.starts_at))}`:(c.last?`Dernière visite : ${esc(fmtDateKey(appointmentDateKey(c.last),{day:'numeric',month:'short'}))}`:'Nouveau client')}</span></div>
      <button type="button" class="btn btn-secondary btn-small" data-client-history="${esc(c.key)}">Voir l’historique</button>
    </article>`).join(''):'<div class="empty-state"><strong>Aucun client trouvé.</strong><span>Les clients apparaissent automatiquement dès leur première réservation.</span></div>';
}
function openClientHistory(key){
  const client=buildClients().find(c=>c.key===key);
  if(!client) return;
  $('#clientHistoryName').textContent=client.name;
  $('#clientHistoryContact').textContent=[client.phone,client.email].filter(Boolean).join(' · ');
  $('#clientHistoryStats').innerHTML=`
    <div><strong>${client.total}</strong><span>réservations</span></div>
    <div><strong>${client.completedLike}</strong><span>visites passées</span></div>
    <div><strong>${client.cancelled}</strong><span>annulations/refus</span></div>`;
  $('#clientHistoryList').innerHTML=client.appointments.map(a=>`
    <article class="client-history-row">
      <div><strong>${esc(fmtDateKey(appointmentDateKey(a)))} · ${esc(fmtRange(a))}</strong><span>${esc(a.service_name||'Prestation')} · ${esc(priceLabel(a))}</span></div>
      <span class="badge ${esc(a.status)}">${esc(statusLabel(a))}</span>
    </article>`).join('');
  $('#clientHistoryDialog').showModal();
}

function populateManualServices(){
  const select=$('#manualService');
  if(!select) return;
  const current=select.value;
  select.innerHTML='<option value="">Choisir une prestation</option>'+state.services.map(s=>`<option value="${esc(s.slug)}">${esc(s.name)} · ${(Number(s.price_cents||0)/100).toLocaleString('fr-FR',{maximumFractionDigits:2})} € · ${Number(s.duration_minutes)} min</option>`).join('');
  if(current&&state.services.some(s=>s.slug===current)) select.value=current;
}
function selectedManualService(){
  return state.services.find(s=>s.slug===$('#manualService').value)||null;
}
function updateManualPreview(){
  const s=selectedManualService(),date=$('#manualDate').value,time=$('#manualTime').value;
  $('#manualAppointmentPreview').innerHTML=s&&date&&time?`<strong>${esc(fmtDateKey(date))} à ${esc(time)}</strong><span>${esc(s.name)} · ${Number(s.duration_minutes)} min · ${(Number(s.price_cents)/100).toLocaleString('fr-FR',{maximumFractionDigits:2})} €</span>`:'';
}
function openManualDialog(){
  $('#manualAppointmentForm').reset();
  $('#manualDate').min=parisDateKey();
  $('#manualDate').value=parisDateKey();
  populateManualServices();
  updateManualPreview();
  $('#manualAppointmentDialog').showModal();
}
async function saveManualAppointment(e){
  e.preventDefault();
  const service=selectedManualService();
  const date=$('#manualDate').value,time=$('#manualTime').value;
  const first=$('#manualFirstName').value.trim(),last=$('#manualLastName').value.trim();
  const phone=$('#manualPhone').value.trim(),email=$('#manualEmail').value.trim().toLowerCase();
  const notes=$('#manualNotes').value.trim();
  if(!service||!date||!time||!first||!last||!phone||!email) return showFlash('Complète tous les champs obligatoires.','error');
  try{
    if(isDemo){
      const start=new Date(`${date}T${time}:00`);
      const end=new Date(start.getTime()+Number(service.duration_minutes)*60000);
      const list=expireDemo();
      if(list.some(a=>isActive(a)&&new Date(a.starts_at)<end&&new Date(a.ends_at)>start)) throw new Error('Ce créneau chevauche déjà un autre rendez-vous.');
      list.push({id:crypto.randomUUID(),starts_at:start.toISOString(),ends_at:end.toISOString(),customer_name:`${first} ${last}`,phone,email,notes,status:'confirmed',service_slug:service.slug,service_name:service.name,price_cents:service.price_cents,duration_minutes:service.duration_minutes});
      setDemoAppointments(list);
    }else{
      const {error}=await db.rpc('admin_create_appointment',{p_service_slug:service.slug,p_date:date,p_time:time,p_customer_name:`${first} ${last}`,p_phone:phone,p_email:email,p_notes:notes||null});
      if(error) throw error;
    }
    $('#manualAppointmentDialog').close();
    showFlash('Rendez-vous ajouté au planning.','success');
    await loadAll();
  }catch(error){ showFlash(error.message||'Impossible d’ajouter ce rendez-vous.','error'); }
}
function openMoveDialog(id){
  const a=state.appointments.find(x=>String(x.id)===String(id));
  if(!a) return;
  $('#moveAppointmentId').value=a.id;
  $('#moveAppointmentLabel').textContent=`${a.customer_name||'Client'} · ${a.service_name||'Prestation'} · ${durationLabel(a)}`;
  const date=appointmentDateKey(a);
  $('#moveDate').min=parisDateKey();
  $('#moveDate').value=date;
  $('#moveTime').value=fmtTime(a.starts_at);
  updateMovePreview();
  $('#moveAppointmentDialog').showModal();
}
function updateMovePreview(){
  const id=$('#moveAppointmentId').value,a=state.appointments.find(x=>String(x.id)===String(id));
  const date=$('#moveDate').value,time=$('#moveTime').value;
  $('#moveAppointmentPreview').innerHTML=a&&date&&time?`<strong>Nouveau créneau : ${esc(fmtDateKey(date))} à ${esc(time)}</strong><span>${esc(a.service_name||'Prestation')} · ${esc(durationLabel(a))}</span>`:'';
}
async function saveMoveAppointment(e){
  e.preventDefault();
  const id=$('#moveAppointmentId').value,date=$('#moveDate').value,time=$('#moveTime').value;
  if(!id||!date||!time) return;
  try{
    if(isDemo){
      const list=expireDemo(),a=list.find(x=>String(x.id)===String(id));
      if(!a) throw new Error('Rendez-vous introuvable');
      const duration=Number(a.duration_minutes||a.duration||0);
      const start=new Date(`${date}T${time}:00`),end=new Date(start.getTime()+duration*60000);
      if(list.some(x=>String(x.id)!==String(id)&&isActive(x)&&new Date(x.starts_at)<end&&new Date(x.ends_at)>start)) throw new Error('Ce créneau chevauche déjà un autre rendez-vous.');
      a.starts_at=start.toISOString(); a.ends_at=end.toISOString();
      setDemoAppointments(list);
    }else{
      const {error}=await db.rpc('admin_move_appointment',{p_id:id,p_date:date,p_time:time});
      if(error) throw error;
    }
    $('#moveAppointmentDialog').close();
    showFlash('Rendez-vous déplacé.','success');
    await loadAll();
  }catch(error){ showFlash(error.message||'Impossible de déplacer ce rendez-vous.','error'); }
}

function renderRequests(){
  const list=state.appointments
    .filter(a=>a.status==='pending')
    .sort((a,b)=>new Date(a.starts_at||`${a.date}T${a.time}`).getTime()-new Date(b.starts_at||`${b.date}T${b.time}`).getTime());
  $('#requestList').innerHTML=list.length?list.map(a=>`<section class="agenda-day"><div class="agenda-day-head"><strong>${esc(dayHeading(appointmentDateKey(a)))}</strong><span>${esc(fmtRange(a))}</span></div><div class="agenda-day-items">${appointmentCard(a)}</div></section>`).join(''):'<div class="empty-state"><strong>Aucune demande en attente.</strong><span>Tout est traité.</span></div>';
}

function renderClosures(){
  const today=parisDateKey();
  const list=state.closures.filter(c=>c.closed_date>=today).sort((a,b)=>`${a.closed_date}${a.start_time||''}`.localeCompare(`${b.closed_date}${b.start_time||''}`));
  $('#closureList').innerHTML=list.length?list.map(c=>{
    const period=c.start_time&&c.end_time?`${String(c.start_time).slice(0,5)} – ${String(c.end_time).slice(0,5)}`:'Journée entière';
    return `<article class="closure-item"><div><strong>${esc(fmtDateKey(c.closed_date))}</strong><span>${esc(period)}${c.reason?` · ${esc(c.reason)}`:''}</span></div><button type="button" class="icon-button" data-delete-closure="${esc(c.id)}" aria-label="Supprimer l’indisponibilité">×</button></article>`;
  }).join(''):'<div class="empty-state compact"><span>Aucune indisponibilité à venir.</span></div>';
}

function normalizeSchedule(){
  const result={};
  WEEKDAYS.forEach(day=>{
    const rows=state.openingHours.filter(r=>Number(r.weekday)===day.id&&r.active!==false).sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time)));
    const morning=rows.find(r=>!r.latest_start_time)||rows[0];
    const afternoon=rows.find(r=>r.latest_start_time)||rows[1];
    result[day.id]={
      enabled:rows.length>0,
      morningStart:String(morning?.start_time||'09:30').slice(0,5),
      morningEnd:String(morning?.end_time||'12:30').slice(0,5),
      afternoonStart:String(afternoon?.start_time||'14:00').slice(0,5),
      lastStart:String(afternoon?.latest_start_time||'19:00').slice(0,5)
    };
  });
  return result;
}

function renderSettings(){
  $('#pendingHoldSelect').value=String(state.pendingHoldMinutes||1440);
  const schedule=normalizeSchedule();
  $('#scheduleEditor').innerHTML=WEEKDAYS.map(day=>{
    const s=schedule[day.id];
    return `<article class="schedule-day" data-weekday="${day.id}">
      <div class="schedule-day-title"><label class="schedule-toggle"><input type="checkbox" class="day-enabled" ${s.enabled?'checked':''}><span>${day.label}</span></label></div>
      <div class="schedule-day-fields ${s.enabled?'':'disabled'}">
        <label>Matin <span><input type="time" class="morning-start" value="${s.morningStart}"> → <input type="time" class="morning-end" value="${s.morningEnd}"></span></label>
        <label>Après-midi <span><input type="time" class="afternoon-start" value="${s.afternoonStart}"> · dernier départ <input type="time" class="last-start" value="${s.lastStart}"></span></label>
      </div>
    </article>`;
  }).join('');
  $$('.day-enabled').forEach(input=>input.addEventListener('change',()=>{
    input.closest('.schedule-day').querySelector('.schedule-day-fields').classList.toggle('disabled',!input.checked);
  }));
}

function renderEmailState(){
  const el=$('#emailConfigState');
  const btn=$('#testEmailBtn');
  if(emailEnabled){
    el.textContent='Messagerie configurée : confirmation, rappel la veille et alertes de liste d’attente sont prêts.';
    if(btn) btn.disabled=false;
  }else{
    el.textContent='Messagerie non configurée dans Vercel. Les rendez-vous restent utilisables, mais aucun e-mail n’est envoyé.';
    if(btn) btn.disabled=true;
  }
}

async function sendTestEmail(){
  try{
    const {data}=await db.auth.getSession();
    const token=data?.session?.access_token;
    if(!token) throw new Error('Ta session administrateur a expiré. Reconnecte-toi.');
    const btn=$('#testEmailBtn');
    if(btn){btn.disabled=true;btn.textContent='Envoi…';}
    const response=await fetch('/api/email-test',{
      method:'POST',
      headers:{Authorization:`Bearer ${token}`}
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||'Impossible d’envoyer le test');
    showFlash(`E-mail test envoyé à ${payload.email}.`,'success');
  }catch(error){
    showFlash(error.message||'Impossible d’envoyer le test e-mail.','error');
  }finally{
    const btn=$('#testEmailBtn');
    if(btn){btn.disabled=!emailEnabled;btn.textContent='Envoyer un e-mail test';}
  }
}

async function callAppointmentAction(id,action){
  const {data}=await db.auth.getSession();
  const token=data?.session?.access_token;
  if(!token) throw new Error('Ta session administrateur a expiré. Reconnecte-toi.');
  const response=await fetch('/api/appointment-action',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({id,action})
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error||'Impossible de traiter le rendez-vous');
  return payload;
}

async function handleAppointmentAction(id,action){
  try{
    if(isDemo){
      const list=expireDemo();
      const a=list.find(x=>String(x.id)===String(id));
      if(!a) throw new Error('Rendez-vous introuvable');
      if(action==='confirm'){ a.status='confirmed'; a.expires_at=null; a.confirmed_at=new Date().toISOString(); }
      if(action==='reject'){ a.status='rejected'; a.expires_at=null; }
      if(action==='cancel'){ a.status='cancelled'; a.expires_at=null; a.cancellation_reason='Annulé depuis l’espace pro'; }
      setDemoAppointments(list);
      showFlash(action==='confirm'?'Rendez-vous confirmé.':action==='reject'?'Demande refusée : le créneau est libéré.':'Rendez-vous annulé : le créneau est libéré.','success');
    }else{
      const result=await callAppointmentAction(id,action);
      if(action==='confirm') showFlash(result.emailSent?'Rendez-vous confirmé et e-mail envoyé.':(result.warning||'Rendez-vous confirmé.'),result.emailSent||result.emailSkipped?'success':'neutral');
      if(action==='reject') showFlash('Demande refusée : le créneau est de nouveau disponible.','success');
      if(action==='cancel') showFlash('Rendez-vous annulé : le créneau est de nouveau disponible.','success');
      if(action==='resend_confirmation') showFlash(result.emailSent?'E-mail envoyé.':(result.warning||'E-mail non envoyé.'),result.emailSent?'success':'neutral');
    }
    await loadAll();
  }catch(error){ showFlash(error.message||'Une erreur est survenue.','error'); }
}

async function saveClosure(e){
  e.preventDefault();
  const date=$('#closureDate').value;
  const full=$('#closureFullDay').checked;
  const start=full?null:$('#closureStart').value;
  const end=full?null:$('#closureEnd').value;
  const reason=$('#closureReason').value.trim()||null;
  if(!date) return showFlash('Choisis une date.','error');
  if(!full&&(!start||!end||timeMinutes(end)<=timeMinutes(start))) return showFlash('Vérifie l’heure de début et de fin.','error');

  try{
    if(isDemo){
      const list=JSON.parse(localStorage.getItem('oscar_demo_closures')||'[]');
      list.push({id:crypto.randomUUID(),closed_date:date,start_time:start,end_time:end,reason});
      localStorage.setItem('oscar_demo_closures',JSON.stringify(list));
    }else{
      const {error}=await db.from('closures').insert({closed_date:date,start_time:start,end_time:end,reason});
      if(error) throw error;
    }
    e.target.reset();
    $('#closureFullDay').checked=true;
    $('#closureTimes').classList.add('hidden');
    $('#closureStart').value='09:30'; $('#closureEnd').value='10:30';
    $('#closureDate').min=parisDateKey();
    showFlash('Indisponibilité ajoutée. Les créneaux concernés sont retirés du site.','success');
    await loadClosures(); renderClosures();
  }catch(error){ showFlash(error.message||'Impossible d’ajouter l’indisponibilité.','error'); }
}

async function deleteClosure(id){
  try{
    if(isDemo){
      const list=JSON.parse(localStorage.getItem('oscar_demo_closures')||'[]').filter(c=>String(c.id)!==String(id));
      localStorage.setItem('oscar_demo_closures',JSON.stringify(list));
    }else{
      const {error}=await db.from('closures').delete().eq('id',id);
      if(error) throw error;
    }
    showFlash('Indisponibilité supprimée.','success');
    await loadClosures(); renderClosures();
  }catch(error){ showFlash(error.message||'Impossible de supprimer.','error'); }
}

async function savePendingHold(){
  const value=Number($('#pendingHoldSelect').value);
  try{
    if(isDemo){ localStorage.setItem('oscar_demo_pending_hold_minutes',String(value)); }
    else{
      const {error}=await db.from('booking_settings').update({pending_hold_minutes:value}).eq('id',1);
      if(error) throw error;
    }
    state.pendingHoldMinutes=value;
    showFlash('Délai des demandes mis à jour.','success');
  }catch(error){ showFlash(error.message||'Impossible d’enregistrer le délai.','error'); }
}

function collectSchedule(){
  const schedule={};
  $$('.schedule-day').forEach(card=>{
    const weekday=Number(card.dataset.weekday);
    const enabled=card.querySelector('.day-enabled').checked;
    const morningStart=card.querySelector('.morning-start').value;
    const morningEnd=card.querySelector('.morning-end').value;
    const afternoonStart=card.querySelector('.afternoon-start').value;
    const lastStart=card.querySelector('.last-start').value;
    if(enabled){
      if(timeMinutes(morningEnd)<=timeMinutes(morningStart)) throw new Error(`${WEEKDAYS.find(d=>d.id===weekday).label} : la fin de matinée doit être après le début.`);
      if(timeMinutes(lastStart)<timeMinutes(afternoonStart)) throw new Error(`${WEEKDAYS.find(d=>d.id===weekday).label} : le dernier départ doit être après la reprise.`);
      schedule[weekday]=[
        {start:morningStart,finishBy:morningEnd},
        {start:afternoonStart,lastStart:lastStart}
      ];
    }else schedule[weekday]=[];
  });
  return schedule;
}

async function saveSchedule(){
  try{
    const schedule=collectSchedule();
    if(isDemo){
      localStorage.setItem('oscar_demo_schedule',JSON.stringify(schedule));
    }else{
      const days=WEEKDAYS.map(d=>d.id);
      const {error:deleteError}=await db.from('opening_hours').delete().in('weekday',days);
      if(deleteError) throw deleteError;
      const rows=[];
      Object.entries(schedule).forEach(([weekday,sessions])=>{
        (sessions||[]).forEach(s=>{
          if(s.finishBy) rows.push({weekday:Number(weekday),start_time:s.start,end_time:s.finishBy,latest_start_time:null,slot_interval_minutes:15,active:true});
          else rows.push({weekday:Number(weekday),start_time:s.start,end_time:addMinutesToTime(s.lastStart,75),latest_start_time:s.lastStart,slot_interval_minutes:15,active:true});
        });
      });
      if(rows.length){
        const {error:insertError}=await db.from('opening_hours').insert(rows);
        if(insertError) throw insertError;
      }
    }
    showFlash('Horaires habituels enregistrés. Le site de réservation les utilise immédiatement.','success');
    await loadOpeningHours(); renderSettings();
  }catch(error){ showFlash(error.message||'Impossible d’enregistrer les horaires.','error'); }
}

function switchView(view){
  state.activeView=view;
  $$('.admin-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.adminView===view));
  $$('[data-view-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.viewPanel!==view));
}

async function login(e){
  e.preventDefault();
  if(isDemo){ showAdmin(); return loadAll(); }
  const email=$('#adminEmail').value.trim(),password=$('#adminPassword').value;
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) return $('#loginError').textContent=error.message;
  showAdmin();
  await loadAll();
}
function showAdmin(){ $('#loginView').classList.add('hidden'); $('#adminView').classList.remove('hidden'); }
function showLogin(){ $('#loginView').classList.remove('hidden'); $('#adminView').classList.add('hidden'); }
async function logout(){ if(!isDemo) await db.auth.signOut(); showLogin(); }

document.addEventListener('click',e=>{
  const actionBtn=e.target.closest('[data-appt-action]');
  if(actionBtn) handleAppointmentAction(actionBtn.dataset.id,actionBtn.dataset.apptAction);
  const moveBtn=e.target.closest('[data-move-appt]');
  if(moveBtn) openMoveDialog(moveBtn.dataset.moveAppt);
  const clientBtn=e.target.closest('[data-client-history]');
  if(clientBtn) openClientHistory(clientBtn.dataset.clientHistory);
  const closureBtn=e.target.closest('[data-delete-closure]');
  if(closureBtn) deleteClosure(closureBtn.dataset.deleteClosure);
  const closeBtn=e.target.closest('[data-close-dialog]');
  if(closeBtn) document.getElementById(closeBtn.dataset.closeDialog)?.close();
  if(e.target.closest('[data-go-agenda]')) switchView('agenda');
});

document.addEventListener('DOMContentLoaded',async()=>{
  await loadRuntimeConfig();
  $('#loginForm').addEventListener('submit',login);
  $('#logoutBtn').addEventListener('click',logout);
  $('#openManualBtn').addEventListener('click',openManualDialog);
  $('#dashboardAddBtn').addEventListener('click',openManualDialog);
  $('#manualAppointmentForm').addEventListener('submit',saveManualAppointment);
  $('#moveAppointmentForm').addEventListener('submit',saveMoveAppointment);
  ['manualService','manualDate','manualTime'].forEach(id=>$('#'+id).addEventListener('input',updateManualPreview));
  ['moveDate','moveTime'].forEach(id=>$('#'+id).addEventListener('input',updateMovePreview));
  $('#clientSearch').addEventListener('input',e=>{state.clientSearch=e.target.value;renderClients();});
  $('#closureForm').addEventListener('submit',saveClosure);
  $('#closureFullDay').addEventListener('change',()=>$('#closureTimes').classList.toggle('hidden',$('#closureFullDay').checked));
  $('#savePendingHold').addEventListener('click',savePendingHold);
  $('#testEmailBtn').addEventListener('click',sendTestEmail);
  $('#saveSchedule').addEventListener('click',saveSchedule);
  $('#closureDate').min=parisDateKey();

  $$('.admin-nav-btn').forEach(btn=>btn.addEventListener('click',()=>switchView(btn.dataset.adminView)));
  $$('#agendaRange button').forEach(btn=>btn.addEventListener('click',()=>{ state.agendaRange=btn.dataset.range; renderAgenda(); }));

  if(isDemo){
    $('#demoAdmin').classList.remove('hidden');
    showLogin();
  }else{
    const {data}=await db.auth.getSession();
    if(data.session){ showAdmin(); await loadAll(); switchView('dashboard'); } else showLogin();
  }

  window.setInterval(async()=>{
    if($('#adminView').classList.contains('hidden')) return;
    try{ await loadAppointments(); renderMetrics(); renderDashboard(); renderAgenda(); renderRequests(); renderClients(); }catch{}
  },60000);
});
