let cfg=window.OSCAR_CONFIG||{};
let db=null;
let accountSession=null;

const $=s=>document.querySelector(s);

async function loadRuntimeConfig(){
  try{
    const r=await fetch('/api/public-config',{cache:'no-store'});
    if(r.ok) cfg={...cfg,...await r.json()};
  }catch{}
  const key=cfg.supabasePublishableKey||cfg.supabaseAnonKey;
  if(!cfg.supabaseUrl||cfg.supabaseUrl==='demo'||!key||key==='demo'||!window.supabase){
    throw new Error('L’espace client n’est pas encore connecté à la base en ligne.');
  }
  db=window.supabase.createClient(cfg.supabaseUrl,key);
}

function showOnly(id){
  ['accountLoading','accountLogin','accountView'].forEach(x=>$('#'+x)?.classList.toggle('hidden',x!==id));
}

function setLoginStatus(message,ok=false){
  const el=$('#accountLoginStatus');
  el.textContent=message;
  el.className='status-box show';
  el.style.background=ok?'#edf6f2':'#fff0ee';
  el.style.color=ok?'#173f37':'#8c392f';
}

function statusLabel(status){
  return ({
    pending:'En attente',
    confirmed:'Confirmé',
    rejected:'Refusé',
    cancelled:'Annulé',
    completed:'Terminé',
    no_show:'Absent'
  })[status]||status;
}

function formatDate(iso){
  const d=new Date(iso);
  const date=new Intl.DateTimeFormat('fr-FR',{
    timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long',year:'numeric'
  }).format(d);
  const time=new Intl.DateTimeFormat('fr-FR',{
    timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'
  }).format(d);
  const clean=date.charAt(0).toUpperCase()+date.slice(1);
  return {date:clean,time};
}

function euro(cents){
  return (Number(cents||0)/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
}

function appointmentCard(a){
  const when=formatDate(a.starts_at);
  const active=['pending','confirmed'].includes(a.status)&&new Date(a.starts_at)>new Date();
  const management=a.management_token?'/manage.html?t='+encodeURIComponent(a.management_token):'';
  return `<article class="account-appointment">
    <div class="account-appointment-top">
      <div>
        <span class="account-date">${when.date}</span>
        <strong class="account-time">${when.time}</strong>
      </div>
      <span class="badge ${a.status}">${statusLabel(a.status)}</span>
    </div>
    <div class="account-service">
      <strong>${escapeHtml(a.service_name||'Prestation')}</strong>
      <span>${Number(a.duration_minutes||0)} min · ${euro(a.price_cents)}</span>
    </div>
    <div class="account-actions">
      ${active&&management?`<a class="btn btn-primary btn-small" href="${management}">Déplacer / annuler</a>`:''}
      <a class="btn btn-secondary btn-small" href="/?service=${encodeURIComponent(a.service_slug||'')}">Reprendre cette prestation</a>
    </div>
  </article>`;
}

function escapeHtml(v=''){
  return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

async function loadAppointments(){
  const {data,error}=await db.rpc('get_my_appointments');
  if(error) throw error;
  const rows=data||[];
  const now=Date.now();
  const upcoming=rows
    .filter(a=>['pending','confirmed'].includes(a.status)&&new Date(a.starts_at).getTime()>=now)
    .sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
  const history=rows
    .filter(a=>!upcoming.some(u=>u.id===a.id))
    .sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));

  $('#accountUpcoming').innerHTML=upcoming.length
    ? upcoming.map(appointmentCard).join('')
    : '<div class="empty-state"><strong>Aucun rendez-vous à venir.</strong><span>Tu peux réserver ton prochain passage quand tu veux.</span><a class="btn btn-primary btn-small" href="/">Réserver</a></div>';

  $('#accountHistory').innerHTML=history.length
    ? history.map(appointmentCard).join('')
    : '<div class="empty-state compact"><span>Ton historique apparaîtra ici.</span></div>';
}

async function showAccount(session){
  accountSession=session;
  $('#accountUserEmail').textContent=session.user.email||'';
  showOnly('accountView');

  try{
    const {data:claimed,error:claimError}=await db.rpc('claim_customer_appointments');
    if(claimError) throw claimError;
    const n=Number(claimed||0);
    if(n>0){
      const el=$('#accountClaimNotice');
      el.textContent=n===1?'1 ancien rendez-vous a été ajouté à ton espace.':`${n} anciens rendez-vous ont été ajoutés à ton espace.`;
      el.classList.remove('hidden');
    }
    await loadAppointments();
  }catch(error){
    $('#accountUpcoming').innerHTML=`<div class="empty-state"><strong>Impossible de charger tes rendez-vous.</strong><span>${escapeHtml(error.message||'Réessaie dans quelques instants.')}</span></div>`;
  }
}

async function sendMagicLink(e){
  e.preventDefault();
  const email=$('#accountEmail').value.trim().toLowerCase();
  const btn=$('#accountLoginBtn');
  if(!email) return;

  btn.disabled=true;
  btn.textContent='Envoi…';
  try{
    const response=await fetch('/api/account-login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(payload.error||'Impossible d’envoyer le lien de connexion.');
    setLoginStatus('Lien Oscar Blends envoyé. Ouvre l’e-mail reçu puis clique sur « Accéder à mon espace ».',true);
  }catch(error){
    setLoginStatus(error.message||'Impossible d’envoyer le lien de connexion.');
  }finally{
    btn.disabled=false;
    btn.textContent='Recevoir mon lien de connexion';
  }
}

async function logout(){
  await db.auth.signOut();
  accountSession=null;
  $('#accountClaimNotice').classList.add('hidden');
  showOnly('accountLogin');
}

document.addEventListener('DOMContentLoaded',async()=>{
  try{
    await loadRuntimeConfig();
    $('#accountLoginForm').addEventListener('submit',sendMagicLink);
    $('#accountLogout').addEventListener('click',logout);

    const {data,error}=await db.auth.getSession();
    if(error) throw error;
    if(data.session){
      if(location.hash||location.search.includes('code=')){
        history.replaceState({},document.title,'/compte.html');
      }
      await showAccount(data.session);
    }else{
      showOnly('accountLogin');
    }

    db.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_IN'&&session&&session.user?.id!==accountSession?.user?.id) showAccount(session);
      if(event==='SIGNED_OUT') showOnly('accountLogin');
    });
  }catch(error){
    showOnly('accountLogin');
    setLoginStatus(error.message||'Impossible de charger l’espace client.');
  }
});
