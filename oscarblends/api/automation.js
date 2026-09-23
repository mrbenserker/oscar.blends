const {createMailer}=require('./_mailer');
function json(res,status,payload){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}

async function supabaseRequest(path,options={}){
  const base=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key) throw new Error('Configuration Supabase serveur manquante');
  const headers={apikey:key,'Content-Type':'application/json',...(options.headers||{})};
  const response=await fetch(`${base}${path}`,{...options,headers});
  const text=await response.text();
  let data=null;
  if(text){try{data=JSON.parse(text)}catch{data=text}}
  if(!response.ok) throw new Error(data?.message||data?.hint||data?.error||`Supabase HTTP ${response.status}`);
  return data;
}

function esc(v=''){
  return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function siteBase(){
  const raw=(process.env.SITE_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').replace(/\/$/,'');
  if(!raw) return '';
  return raw.startsWith('http')?raw:'https://'+raw;
}

function fmtDate(iso){
  const d=new Date(iso);
  const date=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long'}).format(d);
  const time=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(d);
  return {date:date.charAt(0).toUpperCase()+date.slice(1),time};
}

function transporter(){
  return createMailer();
}

async function sendReminder(mail,a){
  const s=a.services||{};
  const when=fmtDate(a.starts_at);
  const manage=a.management_token&&siteBase()?`${siteBase()}/manage.html?t=${a.management_token}`:'';
  const subject=`Rappel Oscar Blends — demain à ${when.time}`;
  const html=`<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1e8;font-family:Arial,sans-serif;color:#1f2b27"><div style="max-width:620px;margin:auto;padding:28px 18px"><div style="background:#18352d;color:#fff;padding:24px;border-radius:18px 18px 0 0"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.75">Oscar Blends</div><h1 style="margin:9px 0 0;font-size:24px">Petit rappel pour demain</h1></div><div style="background:#fff;padding:26px;border-radius:0 0 18px 18px"><p>Bonjour ${esc(a.customer_name||'')},</p><p>Ton rendez-vous <strong>${esc(s.name||'Oscar Blends')}</strong> est prévu <strong>${esc(when.date)} à ${esc(when.time)}</strong>.</p>${manage?`<p><a href="${esc(manage)}" style="display:inline-block;background:#3b7061;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Gérer mon rendez-vous</a></p>`:''}<p>À demain,<br><strong>Oscar Blends</strong></p></div></div></body></html>`;
  const text=`Bonjour ${a.customer_name||''},\n\nRappel : ton rendez-vous Oscar Blends est prévu ${when.date} à ${when.time}.\nPrestation : ${s.name||'Prestation'}.${manage?`\nGérer le rendez-vous : ${manage}`:''}\n\nÀ demain,\nOscar Blends`;
  await mail.send({to:a.email,subject,html,text});
}

async function processReminders(mail){
  // Le cron tourne une fois par jour en début de soirée.
  // Cette fenêtre couvre les rendez-vous du lendemain aux horaires habituels du salon.
  const from=new Date(Date.now()+10*60*60*1000).toISOString();
  const to=new Date(Date.now()+30*60*60*1000).toISOString();
  const rows=await supabaseRequest(
    `/rest/v1/appointments?status=eq.confirmed&reminder_email_sent_at=is.null&starts_at=gte.${encodeURIComponent(from)}&starts_at=lt.${encodeURIComponent(to)}&select=id,customer_name,email,starts_at,management_token,services(name)&order=starts_at.asc`
  );
  let sent=0;
  for(const a of rows||[]){
    if(!a.email) continue;
    try{
      await sendReminder(mail,a);
      await supabaseRequest(`/rest/v1/appointments?id=eq.${encodeURIComponent(a.id)}`,{
        method:'PATCH',
        headers:{Prefer:'return=minimal'},
        body:JSON.stringify({reminder_email_sent_at:new Date().toISOString()})
      });
      sent++;
    }catch(error){console.error('reminder',a.id,error);}
  }
  return sent;
}

async function availableSlotsFor(date,slug){
  return supabaseRequest('/rest/v1/rpc/get_available_slots',{
    method:'POST',
    body:JSON.stringify({p_date:date,p_service_slug:slug})
  });
}

async function sendWaitlistNotice(mail,w){
  const service=w.services||{};
  const dateLabel=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long' }).format(new Date(w.desired_date+'T12:00:00'));
  const booking=siteBase()?`${siteBase()}/?service=${encodeURIComponent(service.slug||'')}`:'';
  const subject=`Une place est disponible chez Oscar Blends — ${dateLabel}`;
  const html=`<!doctype html><html lang="fr"><body style="margin:0;background:#f4f1e8;font-family:Arial,sans-serif;color:#1f2b27"><div style="max-width:620px;margin:auto;padding:28px 18px"><div style="background:#18352d;color:#fff;padding:24px;border-radius:18px 18px 0 0"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.75">Oscar Blends</div><h1 style="margin:9px 0 0;font-size:24px">Une place vient de se libérer</h1></div><div style="background:#fff;padding:26px;border-radius:0 0 18px 18px"><p>Bonjour ${esc(w.customer_name||'')},</p><p>Un créneau est de nouveau disponible le <strong>${esc(dateLabel)}</strong> pour <strong>${esc(service.name||'ta prestation')}</strong>.</p><p>Les créneaux restent disponibles au premier arrivé.</p>${booking?`<p><a href="${esc(booking)}" style="display:inline-block;background:#3b7061;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Voir les créneaux</a></p>`:''}</div></div></body></html>`;
  const text=`Bonjour ${w.customer_name||''},\n\nUne place est disponible le ${dateLabel} pour ${service.name||'ta prestation'}.${booking?`\nVoir les créneaux : ${booking}`:''}\n\nOscar Blends`;
  await mail.send({to:w.email,subject,html,text});
}

async function processWaitlist(mail){
  const today=new Intl.DateTimeFormat('fr-CA',{timeZone:'Europe/Paris'}).format(new Date());
  const rows=await supabaseRequest(
    `/rest/v1/waitlist_entries?status=eq.waiting&notify_sent_at=is.null&desired_date=gte.${encodeURIComponent(today)}&select=id,desired_date,customer_name,email,services(name,slug)&order=desired_date.asc&limit=100`
  );
  let sent=0;
  for(const w of rows||[]){
    if(!w.email||!w.services?.slug) continue;
    try{
      const slots=await availableSlotsFor(w.desired_date,w.services.slug);
      if(!Array.isArray(slots)||!slots.length) continue;
      await sendWaitlistNotice(mail,w);
      await supabaseRequest(`/rest/v1/waitlist_entries?id=eq.${encodeURIComponent(w.id)}`,{
        method:'PATCH',
        headers:{Prefer:'return=minimal'},
        body:JSON.stringify({notify_sent_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      });
      sent++;
    }catch(error){console.error('waitlist',w.id,error);}
  }
  return sent;
}

module.exports=async function handler(req,res){
  if(!['GET','POST'].includes(req.method)) return json(res,405,{error:'Méthode non autorisée'});
  const secret=String(process.env.CRON_SECRET||'').trim();
  if(!secret) return json(res,200,{ok:true,skipped:true,reason:'CRON_SECRET non configuré'});
  if(req.headers.authorization!==`Bearer ${secret}`) return json(res,401,{error:'Non autorisé'});

  try{
    const mail=await transporter();
    if(!mail) return json(res,200,{ok:true,skipped:true,reason:'E-mail non configuré'});
    const [reminders,waitlist]=await Promise.all([processReminders(mail),processWaitlist(mail)]);
    return json(res,200,{ok:true,remindersSent:reminders,waitlistSent:waitlist});
  }catch(error){
    console.error(error);
    return json(res,500,{error:error instanceof Error?error.message:'Erreur serveur'});
  }
};
