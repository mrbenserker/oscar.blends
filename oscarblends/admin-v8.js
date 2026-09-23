const v8State={
  waitlist:[],
  exceptionalOpenings:[],
  bookingRules:{min_notice_minutes:120,max_advance_days:60},
  services:[]
};

function injectAdminV8UI(){
  const nav=document.querySelector('.admin-nav');
  if(nav&&!document.querySelector('[data-admin-view="stats"]')){
    const clientsBtn=document.querySelector('[data-admin-view="clients"]');
    clientsBtn?.insertAdjacentHTML('afterend',
      '<button type="button" class="admin-nav-btn" data-admin-view="stats">Statistiques</button>'+
      '<button type="button" class="admin-nav-btn" data-admin-view="waitlist">Liste d’attente <span id="waitlistPill" class="nav-pill hidden">0</span></button>'
    );
  }

  const main=document.querySelector('.admin-main');
  const closures=document.querySelector('[data-view-panel="closures"]');
  if(main&&!document.querySelector('[data-view-panel="stats"]')){
    closures?.insertAdjacentHTML('beforebegin',`
      <section class="admin-view hidden" data-view-panel="stats">
        <div class="admin-section-head">
          <div><p class="panel-kicker">Statistiques</p><h2>Ton activité en un coup d’œil.</h2><p>Les montants sont calculés à partir des prestations réservées, sans paiement en ligne.</p></div>
        </div>
        <div id="statsOverview" class="stats-overview"></div>
        <div class="admin-two-col stats-two-col">
          <div class="admin-card admin-form-card"><h3>Prestations les plus demandées</h3><div id="statsServices" class="stats-list"></div></div>
          <div class="admin-card admin-form-card"><h3>Horaires les plus demandés</h3><div id="statsHours" class="stats-list"></div></div>
        </div>
      </section>

      <section class="admin-view hidden" data-view-panel="waitlist">
        <div class="admin-section-head">
          <div><p class="panel-kicker">Liste d’attente</p><h2>Clients à rappeler si une place se libère.</h2><p>Lorsqu’un créneau réapparaît, tu peux contacter les personnes intéressées. L’e-mail automatique sera utilisé dès que la messagerie sera activée.</p></div>
        </div>
        <div id="waitlistAdminList" class="waitlist-admin-list"></div>
      </section>
    `);
  }

  const agendaHead=document.querySelector('[data-view-panel="agenda"] .admin-section-head');
  if(agendaHead&&!document.querySelector('#visualTimelineV8')){
    agendaHead.insertAdjacentHTML('afterend','<div id="visualTimelineV8" class="visual-timeline-wrap"></div>');
  }

  const closuresPanel=document.querySelector('[data-view-panel="closures"]');
  if(closuresPanel&&!document.querySelector('#exceptionalOpeningForm')){
    closuresPanel.insertAdjacentHTML('beforeend',`
      <div class="admin-two-col v8-extra-block">
        <form id="exceptionalOpeningForm" class="admin-card admin-form-card">
          <h3>Ouverture exceptionnelle</h3>
          <p class="small">Ouvre une date précise, même si ce jour est normalement fermé.</p>
          <div class="field"><label for="exceptionDate">Date</label><input id="exceptionDate" type="date" required></div>
          <div class="time-fields">
            <div class="field"><label for="exceptionStart">De</label><input id="exceptionStart" type="time" value="10:00" required></div>
            <div class="field"><label for="exceptionEnd">À</label><input id="exceptionEnd" type="time" value="16:00" required></div>
          </div>
          <div class="field"><label for="exceptionLabel">Note <span class="muted-label">facultatif</span></label><input id="exceptionLabel" maxlength="120" placeholder="Ex. dimanche exceptionnel"></div>
          <button class="btn btn-primary" type="submit">Ouvrir cette plage</button>
        </form>
        <div class="admin-card admin-form-card">
          <h3>Ouvertures exceptionnelles</h3>
          <div id="exceptionalOpeningList" class="closure-list"></div>
        </div>
      </div>
    `);
  }

  const settingsPanel=document.querySelector('[data-view-panel="settings"]');
  if(settingsPanel&&!document.querySelector('#bookingRulesCard')){
    settingsPanel.insertAdjacentHTML('beforeend',`
      <div class="admin-card admin-settings-block" id="bookingRulesCard">
        <div class="settings-copy">
          <h3>Limites de réservation</h3>
          <p>Choisis le délai minimum avant un rendez-vous et jusqu’à combien de jours à l’avance un client peut réserver.</p>
        </div>
        <div class="setting-control booking-rules-controls">
          <label>Délai minimum
            <select id="minNoticeSelect">
              <option value="60">1 heure</option>
              <option value="120">2 heures</option>
              <option value="180">3 heures</option>
              <option value="360">6 heures</option>
              <option value="720">12 heures</option>
              <option value="1440">24 heures</option>
            </select>
          </label>
          <label>Réservable jusqu’à
            <select id="maxAdvanceSelect">
              <option value="14">14 jours</option>
              <option value="30">30 jours</option>
              <option value="45">45 jours</option>
              <option value="60">60 jours</option>
              <option value="90">90 jours</option>
            </select>
          </label>
          <button type="button" class="btn btn-primary btn-small" id="saveBookingRules">Enregistrer</button>
        </div>
      </div>

      <div class="admin-card admin-settings-block" id="serviceBuffersCard">
        <div class="settings-copy">
          <h3>Temps de battement</h3>
          <p>Ajoute quelques minutes après une prestation pour nettoyer, souffler ou préparer le client suivant. Ce temps est bloqué dans le planning mais n’est pas affiché comme durée de prestation.</p>
        </div>
        <div id="serviceBuffersList" class="service-buffers-list"></div>
        <button type="button" class="btn btn-primary" id="saveServiceBuffers">Enregistrer les battements</button>
      </div>
    `);
  }

  bindV8Events();
}

let v8EventsBound=false;
function bindV8Events(){
  if(v8EventsBound) return;
  v8EventsBound=true;

  document.addEventListener('click',async e=>{
    const statusBtn=e.target.closest('[data-v8-status]');
    if(statusBtn) return markAppointmentStatusV8(statusBtn.dataset.id,statusBtn.dataset.v8Status);

    const waitBtn=e.target.closest('[data-wait-status]');
    if(waitBtn) return updateWaitlistStatusV8(waitBtn.dataset.id,waitBtn.dataset.waitStatus);

    const deleteOpening=e.target.closest('[data-delete-opening]');
    if(deleteOpening) return deleteExceptionalOpeningV8(deleteOpening.dataset.deleteOpening);
  });

  document.addEventListener('submit',e=>{
    if(e.target.id==='exceptionalOpeningForm') saveExceptionalOpeningV8(e);
  });

  document.addEventListener('click',e=>{
    if(e.target.id==='saveBookingRules') saveBookingRulesV8();
    if(e.target.id==='saveServiceBuffers') saveServiceBuffersV8();
  });

  document.addEventListener('click',e=>{
    const btn=e.target.closest('.admin-nav-btn[data-admin-view]');
    if(btn) setTimeout(renderV8All,0);
  });
}

async function loadV8Data(){
  if(isDemo){
    v8State.waitlist=JSON.parse(localStorage.getItem('oscar_demo_waitlist')||'[]');
    v8State.exceptionalOpenings=JSON.parse(localStorage.getItem('oscar_demo_exceptional_openings')||'[]');
    v8State.bookingRules=JSON.parse(localStorage.getItem('oscar_demo_booking_rules')||'null')||{min_notice_minutes:120,max_advance_days:60};
    v8State.services=(state.services||[]).map((s,i)=>({...s,id:s.id||s.slug||String(i),buffer_after_minutes:Number(s.buffer_after_minutes||0)}));
    return;
  }

  const [waitlist,openings,rules,services]=await Promise.all([
    db.from('waitlist_entries').select('*,services(name,slug)').order('desired_date',{ascending:true}).order('created_at',{ascending:true}),
    db.from('exceptional_openings').select('*').order('open_date',{ascending:true}).order('start_time',{ascending:true}),
    db.from('booking_settings').select('min_notice_minutes,max_advance_days').eq('id',1).maybeSingle(),
    db.from('services').select('id,slug,name,price_cents,duration_minutes,buffer_after_minutes,active,sort_order').order('sort_order',{ascending:true})
  ]);
  if(waitlist.error) throw waitlist.error;
  if(openings.error) throw openings.error;
  if(rules.error) throw rules.error;
  if(services.error) throw services.error;
  v8State.waitlist=waitlist.data||[];
  v8State.exceptionalOpenings=openings.data||[];
  v8State.bookingRules=rules.data||{min_notice_minutes:120,max_advance_days:60};
  v8State.services=services.data||[];
  state.services=v8State.services.filter(s=>s.active!==false);
}

const baseLoadAllV8=loadAll;
loadAll=async function(){
  await baseLoadAllV8();
  try{
    await loadV8Data();
    renderV8All();
  }catch(error){
    console.error(error);
    showFlash(error.message||'Certaines fonctions V8 n’ont pas pu être chargées.','error');
  }
};

const baseStatusLabelV8=statusLabel;
statusLabel=function(a){
  if(a?.status==='completed') return 'Terminé';
  if(a?.status==='no_show') return 'Absent';
  return baseStatusLabelV8(a);
};

const baseAppointmentCardV8=appointmentCard;
appointmentCard=function(a){
  let html=baseAppointmentCardV8(a);
  if(a.status==='confirmed'){
    const extra=`<button class="btn btn-secondary btn-small" type="button" data-v8-status="completed" data-id="${esc(a.id)}">Terminé</button><button class="btn btn-secondary btn-small danger-outline" type="button" data-v8-status="no_show" data-id="${esc(a.id)}">Absent</button>`;
    html=html.replace('<div class="appt-actions">','<div class="appt-actions">'+extra);
  }
  return html;
};

const baseRenderAgendaV8=renderAgenda;
renderAgenda=function(){
  baseRenderAgendaV8();
  renderVisualTimelineV8();
};

function renderV8All(){
  renderStatsV8();
  renderWaitlistV8();
  renderExceptionalOpeningsV8();
  renderBookingRulesV8();
  renderServiceBuffersV8();
  renderVisualTimelineV8();
}

async function markAppointmentStatusV8(id,status){
  try{
    if(isDemo){
      const list=expireDemo();
      const a=list.find(x=>String(x.id)===String(id));
      if(!a) throw new Error('Rendez-vous introuvable');
      a.status=status;
      a.expires_at=null;
      setDemoAppointments(list);
    }else{
      await callAppointmentAction(id,status==='completed'?'complete':'no_show');
    }
    showFlash(status==='completed'?'Rendez-vous marqué comme terminé.':'Client marqué absent.','success');
    await loadAll();
  }catch(error){showFlash(error.message||'Impossible de mettre à jour le rendez-vous.','error');}
}

function renderVisualTimelineV8(){
  const root=document.querySelector('#visualTimelineV8');
  if(!root) return;
  if(state.agendaRange==='week'){
    root.innerHTML='';
    root.classList.add('hidden');
    return;
  }
  root.classList.remove('hidden');
  const key=agendaDateKeys()[0];
  const appointments=state.appointments
    .filter(a=>isActive(a)&&appointmentDateKey(a)===key)
    .sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));

  const weekday=weekdayForDateKey(key);
  const schedule=state.openingHours.filter(r=>Number(r.weekday)===weekday&&r.active!==false);
  let start=9*60,end=20*60+30;
  if(schedule.length){
    start=Math.max(0,Math.min(...schedule.map(r=>timeMinutes(r.start_time)))-30);
    end=Math.min(24*60,Math.max(...schedule.map(r=>r.latest_start_time?timeMinutes(r.latest_start_time)+120:timeMinutes(r.end_time)))+30);
  }
  if(appointments.length){
    start=Math.min(start,...appointments.map(a=>timeMinutes(fmtTime(a.starts_at))-30));
    end=Math.max(end,...appointments.map(a=>timeMinutes(fmtTime(a.ends_at))+30));
  }
  const pxPerMinute=.95;
  const height=Math.max(420,(end-start)*pxPerMinute);
  const hours=[];
  for(let m=Math.ceil(start/60)*60;m<=end;m+=60){
    hours.push(`<div class="timeline-hour" style="top:${(m-start)*pxPerMinute}px"><span>${String(Math.floor(m/60)).padStart(2,'0')}:00</span></div>`);
  }
  const blocks=appointments.map(a=>{
    const s=timeMinutes(fmtTime(a.starts_at));
    const e=timeMinutes(fmtTime(a.ends_at));
    const top=(s-start)*pxPerMinute;
    const h=Math.max(42,(e-s)*pxPerMinute);
    return `<button type="button" class="timeline-appt status-${esc(a.status)}" style="top:${top}px;height:${h}px" data-client-history="${esc(clientKey(a))}">
      <strong>${esc(fmtTime(a.starts_at))} · ${esc(a.customer_name||'Client')}</strong>
      <span>${esc(a.service_name||'Prestation')} · ${esc(durationLabel(a))}</span>
    </button>`;
  }).join('');
  root.innerHTML=`<div class="timeline-title"><strong>Vue planning</strong><span>${esc(dayHeading(key))}</span></div><div class="visual-timeline" style="height:${height}px">${hours.join('')}${blocks||'<div class="timeline-empty">Aucun rendez-vous</div>'}</div>`;
}

function statsDateRangeV8(){
  const today=parisDateKey();
  const month=today.slice(0,7);
  const monthList=state.appointments.filter(a=>appointmentDateKey(a).startsWith(month));
  const sevenEnd=addDaysKey(today,6);
  const weekList=state.appointments.filter(a=>{const k=appointmentDateKey(a);return k>=today&&k<=sevenEnd;});
  return {today,month,monthList,weekList};
}

function renderStatsV8(){
  const overview=document.querySelector('#statsOverview');
  if(!overview) return;
  const {monthList,weekList}=statsDateRangeV8();
  const revenueStatuses=new Set(['confirmed','completed']);
  const monthRevenue=monthList.filter(a=>revenueStatuses.has(a.status)).reduce((s,a)=>s+Number(a.price_cents||0),0)/100;
  const weekRevenue=weekList.filter(a=>revenueStatuses.has(a.status)).reduce((s,a)=>s+Number(a.price_cents||0),0)/100;
  const completed=monthList.filter(a=>a.status==='completed').length;
  const cancelled=monthList.filter(a=>['cancelled','rejected','no_show'].includes(a.status)).length;
  const relevant=monthList.filter(a=>['confirmed','completed','cancelled','rejected','no_show'].includes(a.status)).length;
  const cancellationRate=relevant?Math.round(cancelled/relevant*100):0;
  const clients=typeof buildClients==='function'?buildClients():[];
  const returning=clients.filter(c=>c.total>=2).length;

  overview.innerHTML=`
    <article><span>CA prévu ce mois</span><strong>${monthRevenue.toLocaleString('fr-FR',{maximumFractionDigits:2})} €</strong><small>confirmés + terminés</small></article>
    <article><span>7 prochains jours</span><strong>${weekRevenue.toLocaleString('fr-FR',{maximumFractionDigits:2})} €</strong><small>CA théorique</small></article>
    <article><span>Terminés ce mois</span><strong>${completed}</strong><small>rendez-vous</small></article>
    <article><span>Annulations / absences</span><strong>${cancellationRate} %</strong><small>${cancelled} sur ${relevant||0}</small></article>
    <article><span>Clients récurrents</span><strong>${returning}</strong><small>au moins 2 réservations</small></article>
  `;

  const valid=state.appointments.filter(a=>!['cancelled','rejected'].includes(a.status));
  const byService=new Map();
  valid.forEach(a=>{
    const key=a.service_name||a.service_slug||'Prestation';
    byService.set(key,(byService.get(key)||0)+1);
  });
  const services=[...byService.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  document.querySelector('#statsServices').innerHTML=services.length?services.map(([name,count],i)=>`<div class="stats-row"><span><b>${i+1}</b>${esc(name)}</span><strong>${count}</strong></div>`).join(''):'<div class="empty-state compact"><span>Pas encore assez de données.</span></div>';

  const byHour=new Map();
  valid.forEach(a=>{
    if(!a.starts_at) return;
    const hour=fmtTime(a.starts_at).slice(0,2)+':00';
    byHour.set(hour,(byHour.get(hour)||0)+1);
  });
  const hours=[...byHour.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  document.querySelector('#statsHours').innerHTML=hours.length?hours.map(([hour,count],i)=>`<div class="stats-row"><span><b>${i+1}</b>${hour}</span><strong>${count}</strong></div>`).join(''):'<div class="empty-state compact"><span>Pas encore assez de données.</span></div>';
}

function waitStatusLabelV8(status){
  return ({waiting:'En attente',contacted:'Contacté',booked:'Réservé',cancelled:'Annulé'})[status]||status;
}

function renderWaitlistV8(){
  const root=document.querySelector('#waitlistAdminList');
  if(!root) return;
  const waiting=v8State.waitlist.filter(w=>w.status==='waiting').length;
  const pill=document.querySelector('#waitlistPill');
  if(pill){
    pill.textContent=waiting;
    pill.classList.toggle('hidden',waiting===0);
  }

  const list=[...v8State.waitlist].sort((a,b)=>
    Number(a.status!=='waiting')-Number(b.status!=='waiting') ||
    String(a.desired_date).localeCompare(String(b.desired_date)) ||
    String(a.created_at).localeCompare(String(b.created_at))
  );

  root.innerHTML=list.length?list.map(w=>{
    const service=w.services?.name||w.service_name||'Prestation';
    const phone=esc(w.phone||'');
    const email=esc(w.email||'');
    return `<article class="waitlist-admin-card">
      <div class="waitlist-admin-main">
        <div><span class="badge wait-${esc(w.status)}">${esc(waitStatusLabelV8(w.status))}</span><strong>${esc(w.customer_name||'Client')}</strong></div>
        <span>${esc(fmtDateKey(w.desired_date))} · ${esc(service)}</span>
        <div class="agenda-contact"><a href="tel:${safeTel(w.phone||'')}">${phone}</a><span>·</span><a href="mailto:${encodeURIComponent(w.email||'')}">${email}</a></div>
        ${w.notify_sent_at?'<small>✓ Alerte de disponibilité envoyée</small>':''}
      </div>
      <div class="appt-actions">
        ${w.status==='waiting'?'<button class="btn btn-secondary btn-small" type="button" data-wait-status="contacted" data-id="'+esc(w.id)+'">Marquer contacté</button>':''}
        ${['waiting','contacted'].includes(w.status)?'<button class="btn btn-primary btn-small" type="button" data-wait-status="booked" data-id="'+esc(w.id)+'">Réservation faite</button>':''}
        ${w.status!=='cancelled'?'<button class="btn btn-secondary btn-small danger-outline" type="button" data-wait-status="cancelled" data-id="'+esc(w.id)+'">Retirer</button>':''}
      </div>
    </article>`;
  }).join(''):'<div class="empty-state"><strong>Liste d’attente vide.</strong><span>Les clients qui choisissent une journée complète apparaîtront ici.</span></div>';
}

async function updateWaitlistStatusV8(id,status){
  try{
    if(isDemo){
      const item=v8State.waitlist.find(w=>String(w.id)===String(id));
      if(item) item.status=status;
      localStorage.setItem('oscar_demo_waitlist',JSON.stringify(v8State.waitlist));
    }else{
      const {error}=await db.from('waitlist_entries').update({status,updated_at:new Date().toISOString()}).eq('id',id);
      if(error) throw error;
    }
    showFlash('Liste d’attente mise à jour.','success');
    await loadV8Data();renderWaitlistV8();
  }catch(error){showFlash(error.message||'Impossible de mettre à jour la liste d’attente.','error');}
}

function renderExceptionalOpeningsV8(){
  const root=document.querySelector('#exceptionalOpeningList');
  if(!root) return;
  const today=parisDateKey();
  const list=v8State.exceptionalOpenings.filter(o=>o.open_date>=today);
  root.innerHTML=list.length?list.map(o=>`
    <article class="closure-item">
      <div><strong>${esc(fmtDateKey(o.open_date))}</strong><span>${esc(String(o.start_time).slice(0,5))} – ${esc(String(o.end_time).slice(0,5))}${o.label?' · '+esc(o.label):''}</span></div>
      <button type="button" class="icon-button" data-delete-opening="${esc(o.id)}" aria-label="Supprimer">×</button>
    </article>`).join(''):'<div class="empty-state compact"><span>Aucune ouverture exceptionnelle à venir.</span></div>';
  const date=document.querySelector('#exceptionDate');
  if(date) date.min=today;
}

async function saveExceptionalOpeningV8(e){
  e.preventDefault();
  const date=document.querySelector('#exceptionDate').value;
  const start=document.querySelector('#exceptionStart').value;
  const end=document.querySelector('#exceptionEnd').value;
  const label=document.querySelector('#exceptionLabel').value.trim()||null;
  if(!date||!start||!end||timeMinutes(end)<=timeMinutes(start)) return showFlash('Vérifie la date et les horaires.','error');
  try{
    if(isDemo){
      v8State.exceptionalOpenings.push({id:crypto.randomUUID(),open_date:date,start_time:start,end_time:end,label});
      localStorage.setItem('oscar_demo_exceptional_openings',JSON.stringify(v8State.exceptionalOpenings));
    }else{
      const {error}=await db.from('exceptional_openings').insert({open_date:date,start_time:start,end_time:end,label});
      if(error) throw error;
    }
    e.target.reset();
    document.querySelector('#exceptionStart').value='10:00';
    document.querySelector('#exceptionEnd').value='16:00';
    showFlash('Ouverture exceptionnelle ajoutée.','success');
    await loadV8Data();renderExceptionalOpeningsV8();
  }catch(error){showFlash(error.message||'Impossible d’ajouter cette ouverture.','error');}
}

async function deleteExceptionalOpeningV8(id){
  try{
    if(isDemo){
      v8State.exceptionalOpenings=v8State.exceptionalOpenings.filter(o=>String(o.id)!==String(id));
      localStorage.setItem('oscar_demo_exceptional_openings',JSON.stringify(v8State.exceptionalOpenings));
    }else{
      const {error}=await db.from('exceptional_openings').delete().eq('id',id);
      if(error) throw error;
    }
    showFlash('Ouverture exceptionnelle supprimée.','success');
    await loadV8Data();renderExceptionalOpeningsV8();
  }catch(error){showFlash(error.message||'Impossible de supprimer.','error');}
}

function renderBookingRulesV8(){
  const min=document.querySelector('#minNoticeSelect');
  const max=document.querySelector('#maxAdvanceSelect');
  if(!min||!max) return;
  min.value=String(v8State.bookingRules.min_notice_minutes||120);
  max.value=String(v8State.bookingRules.max_advance_days||60);
}

async function saveBookingRulesV8(){
  const min=Number(document.querySelector('#minNoticeSelect').value);
  const max=Number(document.querySelector('#maxAdvanceSelect').value);
  try{
    if(isDemo){
      v8State.bookingRules={min_notice_minutes:min,max_advance_days:max};
      localStorage.setItem('oscar_demo_booking_rules',JSON.stringify(v8State.bookingRules));
    }else{
      const {error}=await db.from('booking_settings').update({min_notice_minutes:min,max_advance_days:max}).eq('id',1);
      if(error) throw error;
    }
    showFlash('Limites de réservation enregistrées.','success');
    await loadV8Data();renderBookingRulesV8();
  }catch(error){showFlash(error.message||'Impossible d’enregistrer les limites.','error');}
}

function renderServiceBuffersV8(){
  const root=document.querySelector('#serviceBuffersList');
  if(!root) return;
  root.innerHTML=v8State.services.filter(s=>s.active!==false).map(s=>`
    <label class="buffer-row" data-service-buffer="${esc(s.id)}">
      <span><strong>${esc(s.name)}</strong><small>${Number(s.duration_minutes)} min de prestation</small></span>
      <select>
        <option value="0" ${Number(s.buffer_after_minutes||0)===0?'selected':''}>0 min</option>
        <option value="5" ${Number(s.buffer_after_minutes||0)===5?'selected':''}>5 min</option>
        <option value="10" ${Number(s.buffer_after_minutes||0)===10?'selected':''}>10 min</option>
        <option value="15" ${Number(s.buffer_after_minutes||0)===15?'selected':''}>15 min</option>
        <option value="20" ${Number(s.buffer_after_minutes||0)===20?'selected':''}>20 min</option>
        <option value="30" ${Number(s.buffer_after_minutes||0)===30?'selected':''}>30 min</option>
      </select>
    </label>`).join('');
}

async function saveServiceBuffersV8(){
  const values=[...document.querySelectorAll('[data-service-buffer]')].map(row=>({id:row.dataset.serviceBuffer,buffer:Number(row.querySelector('select').value)}));
  try{
    if(isDemo){
      values.forEach(v=>{
        const s=v8State.services.find(x=>String(x.id)===String(v.id));
        if(s) s.buffer_after_minutes=v.buffer;
      });
    }else{
      for(const v of values){
        const {error}=await db.from('services').update({buffer_after_minutes:v.buffer}).eq('id',v.id);
        if(error) throw error;
      }
    }
    showFlash('Temps de battement enregistrés.','success');
    await loadV8Data();renderServiceBuffersV8();
  }catch(error){showFlash(error.message||'Impossible d’enregistrer les battements.','error');}
}

document.addEventListener('DOMContentLoaded',()=>{
  injectAdminV8UI();
});
