const SERVICES = [
  {id:'classique',name:'Le Classique',price:22,duration:50,display:'30–50 min',desc:'Coupe signature adaptée au coiffage, conseils personnalisés et finition produit.'},
  {id:'barbe-clean',name:'Barbe Clean',price:15,duration:30,display:'30 min',desc:"Taille de barbe à la tondeuse avec finitions nettes et conseils d’entretien."},
  {id:'barbe-old-school',name:'Barbe Old School',price:23,duration:50,display:'30–50 min',desc:"Taille de barbe, rasage à l’ancienne et serviettes chaudes."},
  {id:'ptit-blend',name:"Le P'tit Blend",price:15,duration:40,display:'30–40 min',desc:"Coupe garçon de 2 à 12 ans avec finitions propres et naturelles."},
  {id:'rituel-royal',name:'Le Rituel Royal',price:38,duration:75,display:'1 h 15',desc:"Coupe signature, taille de barbe et rasage à l’ancienne à la serviette chaude."},
  {id:'gentleman',name:'Le Gentleman',price:32,duration:65,display:'45–65 min',desc:"Coupe signature + taille de barbe, mise en forme complète et conseils."},
  {id:'mise-a-zero',name:'La Mise à Zéro',price:19,duration:30,display:'30 min',desc:'Rasage intégral avec soins apaisants et finition nette.'}
];

let cfg = window.OSCAR_CONFIG || {};
let isDemo = true;
let db = null;
let selectedService = null;
let selectedDate = null;
let selectedSlot = null;
let currentStep = 1;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];

async function loadRuntimeConfig(){
  try{
    const r=await fetch('/api/public-config',{cache:'no-store'});
    if(r.ok){
      const runtime=await r.json();
      cfg={...cfg,...runtime};
      window.OSCAR_CONFIG=cfg;
    }
  }catch(e){ console.warn('Configuration serveur indisponible, mode démo conservé.',e); }
  const publicKey=cfg.supabasePublishableKey||cfg.supabaseAnonKey;
  isDemo=!cfg.supabaseUrl||cfg.supabaseUrl==='demo'||!publicKey||publicKey==='demo';
  if(!isDemo && window.supabase) db=window.supabase.createClient(cfg.supabaseUrl,publicKey);
}

function localDateKey(date){
  const y=date.getFullYear();
  const m=String(date.getMonth()+1).padStart(2,'0');
  const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function parseDateKey(key){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(y,m-1,d,12,0,0,0);
}
function formatLongDate(key,time){
  const d=parseDateKey(key);
  const label=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const clean=label.charAt(0).toUpperCase()+label.slice(1);
  return `${clean}${time?` à ${time}`:''}`;
}
function addMinutes(hhmm,min){
  const [h,m]=hhmm.split(':').map(Number);
  const total=h*60+m+min;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
function timeToMinutes(hhmm){
  const [h,m]=String(hhmm).slice(0,5).split(':').map(Number);
  return h*60+m;
}
function minutesToTime(total){
  const safe=Math.max(0,Math.min(24*60-1,total));
  return `${String(Math.floor(safe/60)).padStart(2,'0')}:${String(safe%60).padStart(2,'0')}`;
}
function overlapsMinutes(start,end,b){ return start < b.end && end > b.start; }
function dateTimeFor(date,time){
  const [y,m,d]=date.split('-').map(Number);
  const [hh,mm]=time.split(':').map(Number);
  return new Date(y,m-1,d,hh,mm,0,0);
}

function expireDemoAppointments(){
  const list=JSON.parse(localStorage.getItem('oscar_demo_appointments')||'[]');
  const now=Date.now();
  let changed=false;
  list.forEach(a=>{
    if(a.status==='pending' && a.expires_at && new Date(a.expires_at).getTime()<=now){
      a.status='cancelled';
      a.cancellation_reason='Délai de confirmation dépassé';
      changed=true;
    }
  });
  if(changed) localStorage.setItem('oscar_demo_appointments',JSON.stringify(list));
  return list;
}
function demoBusy(date){
  return expireDemoAppointments()
    .filter(a=>{
      const key=a.date || (a.starts_at ? localDateKey(new Date(a.starts_at)) : '');
      return key===date && ['pending','confirmed'].includes(a.status);
    })
    .map(a=>{
      const start=a.time ? timeToMinutes(a.time) : (new Date(a.starts_at).getHours()*60+new Date(a.starts_at).getMinutes());
      return {start,end:start+Number(a.duration||a.duration_minutes||0)};
    })
    .sort((a,b)=>a.start-b.start);
}
function demoClosures(date){
  const closures=JSON.parse(localStorage.getItem('oscar_demo_closures')||'[]').filter(c=>c.closed_date===date);
  if(closures.some(c=>!c.start_time&&!c.end_time)) return {fullDay:true,busy:[]};
  return {
    fullDay:false,
    busy:closures.filter(c=>c.start_time&&c.end_time).map(c=>({start:timeToMinutes(c.start_time),end:timeToMinutes(c.end_time)}))
  };
}
function demoWorkingSessions(){
  try{
    const saved=JSON.parse(localStorage.getItem('oscar_demo_schedule')||'null');
    if(saved) return saved;
  }catch{}
  return cfg.demoWorkingSessions||{};
}
function isFutureDemoSlot(date,startMinutes){
  return dateTimeFor(date,minutesToTime(startMinutes)).getTime()>Date.now();
}
function demoSlots(date){
  if(!selectedService) return [];
  const day=parseDateKey(date).getDay();
  const sessions=(demoWorkingSessions()[day]||[]);
  const closure=demoClosures(date);
  if(!sessions.length || closure.fullDay) return [];

  const duration=selectedService.duration;
  const busy=[...demoBusy(date),...closure.busy].sort((a,b)=>a.start-b.start);
  const all=[];

  sessions.forEach(session=>{
    const open=timeToMinutes(session.start);
    const finishBy=session.finishBy?timeToMinutes(session.finishBy):null;
    const lastStart=session.lastStart?timeToMinutes(session.lastStart):null;
    const maxStart=lastStart ?? (finishBy-duration);
    const close=lastStart!=null ? lastStart+duration : finishBy;
    if(maxStart==null || close==null || maxStart<open) return;

    const candidates=new Set();
    for(let t=open;t<=maxStart;t+=15) candidates.add(t);
    candidates.add(open);
    candidates.add(maxStart);
    busy.forEach(b=>{
      candidates.add(b.end);
      candidates.add(b.start-duration);
    });

    [...candidates].sort((a,b)=>a-b).forEach(candidateStart=>{
      const candidateEnd=candidateStart+duration;
      if(candidateStart<open || candidateStart>maxStart || candidateEnd>close || !isFutureDemoSlot(date,candidateStart)) return;
      if(busy.some(b=>overlapsMinutes(candidateStart,candidateEnd,b))) return;

      const previousEnds=busy.filter(b=>b.end<=candidateStart).map(b=>b.end);
      const nextStarts=busy.filter(b=>b.start>=candidateEnd).map(b=>b.start);
      const leftBoundary=previousEnds.length?Math.max(open,...previousEnds):open;
      const rightBoundary=nextStarts.length?Math.min(close,...nextStarts):close;
      const gapBefore=candidateStart-leftBoundary;
      const gapAfter=rightBoundary-candidateEnd;
      const packedLeft=gapBefore===0;
      const packedRight=gapAfter===0;
      const recommended=packedLeft||packedRight;
      const score=(packedLeft?150:0)+(packedRight?150:0)-(gapBefore+gapAfter)/20;
      all.push({slot:minutesToTime(candidateStart),recommended,score});
    });
  });

  const unique=new Map();
  all.forEach(x=>{
    const old=unique.get(x.slot);
    if(!old || x.score>old.score) unique.set(x.slot,x);
  });
  return [...unique.values()].sort((a,b)=>Number(b.recommended)-Number(a.recommended)||b.score-a.score||a.slot.localeCompare(b.slot));
}

function renderServices(){
  $('#servicesGrid').innerHTML=SERVICES.map(s=>`<button type="button" class="service-card" data-service="${s.id}" aria-label="Choisir ${s.name}, ${s.price} euros, ${s.display}">
    <div class="service-main"><span class="service-name">${s.name}</span><span class="service-meta"><span>${s.display}</span><span>·</span><span>Sur demande</span></span></div>
    <span class="service-price">${s.price} €</span>
    <p class="service-desc">${s.desc}</p>
  </button>`).join('');

  $$('.service-card').forEach(card=>card.addEventListener('click',()=>{
    selectedService=SERVICES.find(s=>s.id===card.dataset.service);
    selectedDate=null;
    selectedSlot=null;
    updateSelectedService();
    renderDays();
    goToStep(2,true);
  }));
}

function updateSelectedService(){
  if(!selectedService) return;
  $('#selectedServiceLabel').textContent=selectedService.name;
  $('#selectedServiceMeta').textContent=`${selectedService.display} · ${selectedService.price} €`;
}

function renderDays(){
  const strip=$('#dayStrip');
  const days=[];
  const now=new Date(); now.setHours(12,0,0,0);
  for(let i=0;i<10;i++){
    const d=new Date(now); d.setDate(now.getDate()+i);
    const key=localDateKey(d);
    days.push({
      key,
      weekday:i===0?'Aujourd’hui':d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''),
      day:d.getDate(),
      month:d.toLocaleDateString('fr-FR',{month:'short'}).replace('.','')
    });
  }
  strip.innerHTML=days.map(d=>`<button type="button" class="day-chip ${selectedDate===d.key?'active':''}" data-date="${d.key}">
    <span class="weekday">${d.weekday}</span><span class="daynum">${d.day}</span><span class="month">${d.month}</span>
  </button>`).join('');
  $$('.day-chip',strip).forEach(btn=>btn.addEventListener('click',()=>selectDate(btn.dataset.date)));
}

async function selectDate(date){
  selectedDate=date;
  selectedSlot=null;
  $('#dateInput').value=date;
  $$('.day-chip').forEach(b=>b.classList.toggle('active',b.dataset.date===date));
  await loadSlots(date);
}

async function loadSlots(date){
  $('#slots').innerHTML='<span class="small">Chargement des créneaux…</span>';
  try{
    let slots=[];
    if(isDemo){
      slots=demoSlots(date);
    }else{
      const {data,error}=await db.rpc('get_available_slots',{p_date:date,p_service_slug:selectedService.id});
      if(error) throw error;
      slots=(data||[]).map(x=>{
        if(typeof x==='string') return {slot:x.slice(0,5),recommended:false};
        return {slot:x.slot?.slice(0,5),recommended:Boolean(x.recommended)};
      }).filter(x=>x.slot);
    }
    renderSlots(slots);
  }catch(err){
    console.error(err);
    $('#slots').innerHTML='<span class="small">Impossible de charger les créneaux. Réessaie dans un instant.</span>';
  }
}

function renderSlots(slots){
  if(!slots.length){
    $('#slots').innerHTML='<span class="small">Aucun créneau disponible ce jour. Essaie une autre date.</span>';
    return;
  }

  const normalized=slots.map(x=>typeof x==='string'?{slot:x,recommended:false}:x);
  const recommended=normalized.filter(x=>x.recommended).slice(0,6);
  const recommendedTimes=new Set(recommended.map(x=>x.slot));
  const others=normalized.filter(x=>!recommendedTimes.has(x.slot)).sort((a,b)=>a.slot.localeCompare(b.slot));
  const button=(x,recommendedLabel=false)=>`<button type="button" class="slot ${recommendedLabel?'recommended':''}" data-time="${x.slot}"><span>${x.slot}</span>${recommendedLabel?'<small>Conseillé</small>':''}</button>`;

  let html='';
  if(recommended.length){
    html+=`<div class="slot-section"><div class="slot-section-title"><strong>Créneaux conseillés</strong><span>Ils remplissent le mieux la journée.</span></div><div class="slot-grid">${recommended.map(x=>button(x,true)).join('')}</div></div>`;
    if(others.length){
      html+=`<details class="all-slots"><summary>Voir aussi les ${others.length} autres horaires disponibles</summary><div class="slot-grid">${others.map(x=>button(x,false)).join('')}</div></details>`;
    }
  }else{
    html=`<div class="slot-section"><div class="slot-section-title"><strong>Horaires disponibles</strong><span>Choisis celui qui te convient.</span></div><div class="slot-grid">${others.map(x=>button(x,false)).join('')}</div></div>`;
  }
  $('#slots').innerHTML=html;

  $$('.slot').forEach(btn=>btn.addEventListener('click',()=>{
    selectedSlot=btn.dataset.time;
    $$('.slot').forEach(b=>b.classList.toggle('active',b===btn));
    updateFinalSummary();
    setTimeout(()=>goToStep(3,true),120);
  }));
}

function updateFinalSummary(){
  if(!selectedService||!selectedDate||!selectedSlot) return;
  const endTime=addMinutes(selectedSlot,selectedService.duration);
  $('#finalDate').textContent=formatLongDate(selectedDate,`${selectedSlot} – ${endTime}`);
  $('#finalService').textContent=`${selectedService.name} · ${selectedService.display}`;
  $('#finalPrice').textContent=`${selectedService.price} €`;
  $('#mobileRecapTitle').textContent=`${selectedService.name} · ${selectedService.price} €`;
  $('#mobileRecapMeta').textContent=formatLongDate(selectedDate,`${selectedSlot} – ${endTime}`);
}

function goToStep(step,scroll=false){
  currentStep=step;
  $$('[data-step-panel]').forEach(p=>p.classList.toggle('hidden',Number(p.dataset.stepPanel)!==step));
  $$('.progress-step').forEach(el=>{
    const n=Number(el.dataset.progress);
    el.classList.toggle('active',n===step);
    el.classList.toggle('done',n<step);
  });
  const showMobile=step===3;
  $('#mobileSubmitWrap').classList.toggle('hidden',!showMobile);
  document.body.classList.toggle('has-mobile-submit',showMobile);
  if(scroll){
    const target=$(`[data-step-panel="${step}"]`);
    setTimeout(()=>target?.scrollIntoView({behavior:'smooth',block:'start'}),40);
  }
}

function demoPendingExpiry(date,time){
  const hold=Number(localStorage.getItem('oscar_demo_pending_hold_minutes')||cfg.pendingHoldMinutes||1440);
  const holdUntil=new Date(Date.now()+hold*60000);
  const starts=dateTimeFor(date,time);
  return new Date(Math.min(holdUntil.getTime(),starts.getTime())).toISOString();
}

async function submitBooking(e){
  if(e) e.preventDefault();
  const firstName=$('#firstNameInput').value.trim();
  const lastName=$('#lastNameInput').value.trim();
  const name=`${firstName} ${lastName}`.trim();
  const phone=$('#phoneInput').value.trim();
  const email=$('#emailInput').value.trim();
  const notes=$('#notesInput').value.trim();
  if(!selectedService||!selectedDate||!selectedSlot) return showStatus('Choisis d’abord une prestation et un créneau.',false);
  if(!firstName||!lastName||!phone||!email) return showStatus('Indique ton prénom, ton nom, ton téléphone et ton e-mail.',false);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showStatus('Indique une adresse e-mail valide.',false);

  const inline=$('#submitBooking');
  const mobile=$('#mobileSubmit');
  inline.disabled=true; mobile.disabled=true;
  inline.textContent='Envoi…'; mobile.textContent='Envoi…';
  try{
    if(isDemo){
      const list=expireDemoAppointments();
      const startMin=timeToMinutes(selectedSlot);
      const closure=demoClosures(selectedDate);
      const conflict=closure.fullDay || [...demoBusy(selectedDate),...closure.busy].some(b=>overlapsMinutes(startMin,startMin+selectedService.duration,b));
      if(conflict) throw new Error('Ce créneau vient d’être pris. Choisis-en un autre.');
      const start=dateTimeFor(selectedDate,selectedSlot);
      const end=new Date(start.getTime()+selectedService.duration*60000);
      list.unshift({
        id:crypto.randomUUID(),
        service:selectedService.id,
        service_slug:selectedService.id,
        service_name:selectedService.name,
        price:selectedService.price,
        price_cents:selectedService.price*100,
        duration:selectedService.duration,
        duration_minutes:selectedService.duration,
        date:selectedDate,
        time:selectedSlot,
        starts_at:start.toISOString(),
        ends_at:end.toISOString(),
        customer_name:name,
        name,phone,email,notes,
        status:'pending',
        expires_at:demoPendingExpiry(selectedDate,selectedSlot),
        created_at:new Date().toISOString()
      });
      localStorage.setItem('oscar_demo_appointments',JSON.stringify(list));
    }else{
      const {error}=await db.rpc('request_appointment',{p_service_slug:selectedService.id,p_date:selectedDate,p_time:selectedSlot,p_customer_name:name,p_phone:phone,p_email:email,p_notes:notes||null});
      if(error) throw error;
    }
    const recap=`${formatLongDate(selectedDate,`${selectedSlot} – ${addMinutes(selectedSlot,selectedService.duration)}`)} · ${selectedService.name} · ${selectedService.price} €.`;
    $('#successRecap').textContent=`${recap} Ta demande reste en attente jusqu’à la confirmation d’Oscar Blends.`;
    $$('[data-step-panel]').forEach(p=>p.classList.add('hidden'));
    $('#successPanel').classList.remove('hidden');
    $('#mobileSubmitWrap').classList.add('hidden');
    document.body.classList.remove('has-mobile-submit');
    $$('.progress-step').forEach(el=>el.classList.add('done'));
    $('#successPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){
    console.error(err);
    showStatus(err.message||'Une erreur est survenue. Réessaie.',false);
  }finally{
    inline.disabled=false; mobile.disabled=false;
    inline.textContent='Demander ce rendez-vous'; mobile.textContent='Demander';
  }
}

function showStatus(message,ok){
  const box=$('#bookingStatus');
  box.textContent=message;
  box.style.background=ok?'#edf6f2':'#fff0ee';
  box.style.color=ok?'#173f37':'#8c392f';
  box.classList.add('show');
}

function resetBooking(){
  selectedService=null; selectedDate=null; selectedSlot=null;
  $('#bookingForm').reset();
  $('#bookingStatus').classList.remove('show');
  $('#successPanel').classList.add('hidden');
  renderDays();
  goToStep(1,true);
}

function initGalleryFallback(){
  $$('.photo-slot img').forEach(img=>img.addEventListener('error',()=>{ img.style.display='none'; }));
}

document.addEventListener('DOMContentLoaded',async()=>{
  await loadRuntimeConfig();
  renderServices(); renderDays(); initGalleryFallback();
  const dateInput=$('#dateInput');
  dateInput.min=localDateKey(new Date());
  dateInput.addEventListener('change',()=>{ if(dateInput.value) selectDate(dateInput.value); });
  $('#changeService').addEventListener('click',()=>goToStep(1,true));
  $('#backToSlots').addEventListener('click',()=>goToStep(2,true));
  $('#bookingForm').addEventListener('submit',submitBooking);
  $('#mobileSubmit').addEventListener('click',()=>$('#bookingForm').requestSubmit());
  $('#newBooking').addEventListener('click',resetBooking);
  $$('.instagram-link').forEach(a=>a.href=cfg.instagramUrl||'#');
  if(isDemo) $('#demoNotice').classList.remove('hidden');
  window.addEventListener('scroll',()=>$('.header')?.classList.toggle('scrolled',window.scrollY>6));
});
