let accountSession=null;

const $=s=>document.querySelector(s);

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

let loginCooldownTimer=null;
function startLoginCooldown(seconds=60){
  const btn=$('#accountLoginBtn');
  if(!btn) return;
  if(loginCooldownTimer) clearInterval(loginCooldownTimer);
  let remaining=Math.max(1,Number(seconds)||60);
  btn.disabled=true;
  btn.textContent=`Renvoyer dans ${remaining}s`;
  loginCooldownTimer=setInterval(()=>{
    remaining-=1;
    if(remaining<=0){
      clearInterval(loginCooldownTimer);
      loginCooldownTimer=null;
      btn.disabled=false;
      btn.textContent='Recevoir mon lien de connexion';
      return;
    }
    btn.textContent=`Renvoyer dans ${remaining}s`;
  },1000);
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
  return {date:date.charAt(0).toUpperCase()+date.slice(1),time};
}

function euro(cents){
  return (Number(cents||0)/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
}

function escapeHtml(v=''){
  return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
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

function renderAppointments(rows=[]){
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

async function loadAccount(){
  const response=await fetch('/api/account-me',{cache:'no-store',credentials:'same-origin'});
  if(response.status===401){
    accountSession=null;
    showOnly('accountLogin');
    return false;
  }
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error||'Impossible de charger ton espace.');
  accountSession={email:payload.email};
  $('#accountUserEmail').textContent=payload.email||'';
  showOnly('accountView');
  renderAppointments(payload.appointments||[]);
  return true;
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
      credentials:'same-origin',
      body:JSON.stringify({email})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===429) startLoginCooldown(Number(payload.retryAfter||60));
      throw new Error(payload.error||'Impossible d’envoyer le lien de connexion.');
    }
    setLoginStatus('E-mail Oscar Blends envoyé depuis rdv.oscarblends@gmail.com. Ouvre-le puis clique sur « Accéder à mon espace ».',true);
    startLoginCooldown(60);
  }catch(error){
    setLoginStatus(error.message||'Impossible d’envoyer le lien de connexion.');
    if(!loginCooldownTimer){
      btn.disabled=false;
      btn.textContent='Recevoir mon lien de connexion';
    }
  }
}

async function logout(){
  try{
    await fetch('/api/account-logout',{method:'POST',credentials:'same-origin'});
  }catch{}
  accountSession=null;
  $('#accountClaimNotice')?.classList.add('hidden');
  showOnly('accountLogin');
}

document.addEventListener('DOMContentLoaded',async()=>{
  $('#accountLoginForm').addEventListener('submit',sendMagicLink);
  $('#accountLogout').addEventListener('click',logout);

  const params=new URLSearchParams(location.search);
  const loginState=params.get('login');
  if(loginState) history.replaceState({},document.title,'/compte.html');

  try{
    const authenticated=await loadAccount();
    if(authenticated&&loginState==='success'){
      const notice=$('#accountClaimNotice');
      if(notice){
        notice.textContent='Connexion réussie. Bienvenue dans ton espace Oscar Blends.';
        notice.classList.remove('hidden');
      }
    }else if(!authenticated&&loginState==='invalid'){
      setLoginStatus('Ce lien de connexion est invalide ou a expiré. Demande un nouveau lien.');
    }else if(!authenticated&&loginState==='error'){
      setLoginStatus('Impossible de te connecter avec ce lien. Demande un nouveau lien.');
    }
  }catch(error){
    showOnly('accountLogin');
    setLoginStatus(error.message||'Impossible de charger l’espace client.');
  }
});
