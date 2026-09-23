let bookingRulesV8={min_notice_minutes:120,max_advance_days:60};

const baseLoadRuntimeConfigV8=loadRuntimeConfig;
loadRuntimeConfig=async function(){
  await baseLoadRuntimeConfigV8();
  if(!isDemo&&db){
    try{
      const {data}=await db.rpc('get_public_booking_rules');
      const row=Array.isArray(data)?data[0]:data;
      if(row) bookingRulesV8={...bookingRulesV8,...row};
    }catch{}
  }
};

function addDaysKeyV8(key,days){
  const [y,m,d]=key.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+days,12)).toISOString().slice(0,10);
}

function applyBookingLimitsV8(){
  const input=document.querySelector('#dateInput');
  if(!input) return;
  input.min=localDateKey(new Date());
  input.max=addDaysKeyV8(input.min,Number(bookingRulesV8.max_advance_days||60));
}

function preselectServiceV8(){
  const slug=new URLSearchParams(location.search).get('service');
  if(!slug) return;
  const card=document.querySelector(`.service-card[data-service="${CSS.escape(slug)}"]`);
  if(card&&!selectedService) card.click();
}

const baseRenderServicesV8=renderServices;
renderServices=function(){
  baseRenderServicesV8();
  queueMicrotask(preselectServiceV8);
};

function injectWaitlistDialogV8(){
  if(document.querySelector('#waitlistDialog')) return;
  document.body.insertAdjacentHTML('beforeend',`
    <dialog id="waitlistDialog" class="admin-dialog waitlist-dialog">
      <form id="waitlistForm" class="dialog-card">
        <div class="dialog-head">
          <div><p class="panel-kicker">Liste d’attente</p><h2>Préviens-moi si une place se libère.</h2><p class="small" id="waitlistContext"></p></div>
          <button type="button" class="dialog-close" data-close-waitlist aria-label="Fermer">×</button>
        </div>
        <div class="dialog-grid">
          <div class="field"><label for="waitFirstName">Prénom</label><input id="waitFirstName" required></div>
          <div class="field"><label for="waitLastName">Nom</label><input id="waitLastName" required></div>
          <div class="field"><label for="waitPhone">Téléphone</label><input id="waitPhone" type="tel" required></div>
          <div class="field"><label for="waitEmail">E-mail</label><input id="waitEmail" type="email" required></div>
        </div>
        <div class="privacy-note">Tes coordonnées servent uniquement à te prévenir si un créneau se libère pour cette date.</div>
        <div id="waitlistStatus" class="status-box"></div>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-close-waitlist>Annuler</button>
          <button type="submit" class="btn btn-primary">Me mettre sur liste d’attente</button>
        </div>
      </form>
    </dialog>`);
  document.querySelectorAll('[data-close-waitlist]').forEach(b=>b.addEventListener('click',()=>document.querySelector('#waitlistDialog').close()));
  document.querySelector('#waitlistForm').addEventListener('submit',submitWaitlistV8);
}

function openWaitlistV8(){
  injectWaitlistDialogV8();
  if(!selectedService||!selectedDate) return;
  document.querySelector('#waitlistContext').textContent=`${selectedService.name} · ${formatLongDate(selectedDate)}`;
  document.querySelector('#waitFirstName').value=document.querySelector('#firstNameInput')?.value||'';
  document.querySelector('#waitLastName').value=document.querySelector('#lastNameInput')?.value||'';
  document.querySelector('#waitPhone').value=document.querySelector('#phoneInput')?.value||'';
  document.querySelector('#waitEmail').value=document.querySelector('#emailInput')?.value||'';
  document.querySelector('#waitlistStatus').className='status-box';
  document.querySelector('#waitlistDialog').showModal();
}

async function submitWaitlistV8(e){
  e.preventDefault();
  const first=document.querySelector('#waitFirstName').value.trim();
  const last=document.querySelector('#waitLastName').value.trim();
  const phone=document.querySelector('#waitPhone').value.trim();
  const email=document.querySelector('#waitEmail').value.trim().toLowerCase();
  const status=document.querySelector('#waitlistStatus');
  if(!selectedService||!selectedDate) return;
  if(!first||!last||!phone||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    status.textContent='Complète correctement tes coordonnées.';
    status.className='status-box show';
    return;
  }
  try{
    if(isDemo){
      const list=JSON.parse(localStorage.getItem('oscar_demo_waitlist')||'[]');
      list.push({id:crypto.randomUUID(),service_slug:selectedService.id,service_name:selectedService.name,desired_date:selectedDate,customer_name:`${first} ${last}`,phone,email,status:'waiting',created_at:new Date().toISOString()});
      localStorage.setItem('oscar_demo_waitlist',JSON.stringify(list));
    }else{
      const {error}=await db.rpc('join_waitlist',{p_service_slug:selectedService.id,p_date:selectedDate,p_customer_name:`${first} ${last}`,p_phone:phone,p_email:email});
      if(error) throw error;
    }
    status.textContent='C’est bon. Tu es sur la liste d’attente pour cette journée.';
    status.style.background='#edf6f2';
    status.style.color='#173f37';
    status.className='status-box show';
    e.target.querySelector('button[type="submit"]').disabled=true;
  }catch(err){
    status.textContent=err.message||'Impossible de rejoindre la liste d’attente.';
    status.className='status-box show';
  }
}

const baseRenderSlotsV8=renderSlots;
renderSlots=function(slots){
  baseRenderSlotsV8(slots);
  if(!slots.length&&selectedService&&selectedDate){
    const root=document.querySelector('#slots');
    root.insertAdjacentHTML('beforeend',`
      <div class="waitlist-cta">
        <strong>Cette journée est complète ?</strong>
        <span>Laisse tes coordonnées pour être prévenu si une place se libère.</span>
        <button type="button" class="btn btn-secondary btn-small" id="joinWaitlistBtn">Rejoindre la liste d’attente</button>
      </div>`);
    document.querySelector('#joinWaitlistBtn')?.addEventListener('click',openWaitlistV8);
  }
};

document.addEventListener('DOMContentLoaded',()=>{
  injectWaitlistDialogV8();
  setTimeout(()=>{
    applyBookingLimitsV8();
    preselectServiceV8();
  },250);
});
