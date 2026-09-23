const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const {createMailer,isConfigured}=require('./_mailer');
const {createLoginToken}=require('./_account-auth');

const memoryRateLimit=new Map();

function json(res,status,payload){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}

function normalizeEmail(value=''){
  return String(value).trim().toLowerCase();
}

function validEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=254;
}

function siteBase(req){
  const env=(process.env.SITE_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').trim().replace(/\/$/,'');
  if(env) return env.startsWith('http')?env:'https://'+env;
  const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  return host?`${proto}://${host}`:'';
}

function adminClient(){
  const url=String(process.env.SUPABASE_URL||'').trim();
  const key=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  if(!url||!key) throw new Error('Configuration Supabase serveur manquante');
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

function memoryLimit(hash){
  const now=Date.now();
  const row=memoryRateLimit.get(hash);
  if(row&&now-row.last<60000){
    return {ok:false,retryAfter:Math.ceil((60000-(now-row.last))/1000)};
  }
  const windowStart=row&&now-row.windowStart<3600000?row.windowStart:now;
  const count=row&&windowStart===row.windowStart?row.count:0;
  if(count>=5) return {ok:false,retryAfter:3600};
  memoryRateLimit.set(hash,{last:now,windowStart,count:count+1});
  return {ok:true};
}

async function rateLimit(db,email){
  const hash=crypto.createHash('sha256').update(email).digest('hex');
  const now=new Date();

  try{
    const {data,error}=await db
      .from('account_login_requests')
      .select('last_sent_at,window_started_at,sent_count')
      .eq('email_hash',hash)
      .maybeSingle();

    if(error) throw error;

    if(data?.last_sent_at){
      const seconds=(now-new Date(data.last_sent_at))/1000;
      if(seconds<60) return {ok:false,retryAfter:Math.ceil(60-seconds)};
    }

    let windowStart=data?.window_started_at?new Date(data.window_started_at):null;
    let count=Number(data?.sent_count||0);
    if(!windowStart || now-windowStart>=60*60*1000){
      windowStart=now;
      count=0;
    }
    if(count>=5) return {ok:false,retryAfter:3600};

    return {
      ok:true,
      hash,
      persistent:true,
      next:{
        email_hash:hash,
        last_sent_at:now.toISOString(),
        window_started_at:windowStart.toISOString(),
        sent_count:count+1
      }
    };
  }catch(error){
    console.warn('Persistent account login rate limit unavailable, using memory fallback.',error?.message||error);
    return {...memoryLimit(hash),hash,persistent:false};
  }
}

function emailTemplate({email,actionLink,base}){
  const logo=base?`${base}/assets/logo-oscar-blends.png`:'';
  const safeEmail=String(email).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const safeLink=String(actionLink).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const safeLogo=String(logo).replace(/&/g,'&amp;').replace(/"/g,'&quot;');

  const html=`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connexion Oscar Blends</title>
</head>
<body style="margin:0;background:#efe3d2;font-family:Arial,Helvetica,sans-serif;color:#1d2925">
  <div style="max-width:620px;margin:0 auto;padding:30px 16px">
    <div style="background:#fbf5ec;border:1px solid rgba(73,56,42,.13);border-bottom:0;border-radius:22px 22px 0 0;padding:26px;text-align:center;color:#2b574d">
      ${safeLogo?`<img src="${safeLogo}" alt="Oscar Blends" width="145" style="display:block;width:145px;max-width:65%;height:auto;margin:0 auto 18px">`:''}
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#3b7061;font-weight:700">Espace client Oscar Blends</div>
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.08;font-weight:500;margin:10px 0 0;color:#2b574d">Ton lien de connexion</h1>
    </div>
    <div style="background:#fbf5ec;border:1px solid rgba(73,56,42,.13);border-top:0;border-radius:0 0 22px 22px;padding:28px">
      <p style="font-size:16px;line-height:1.65;margin:0 0 16px">Bonjour,</p>
      <p style="font-size:16px;line-height:1.65;margin:0 0 22px">Tu as demandé à accéder à ton espace client <strong>Oscar Blends</strong> avec l’adresse <strong>${safeEmail}</strong>.</p>
      <p style="margin:0 0 24px;text-align:center">
        <a href="${safeLink}" style="display:inline-block;background:#3b7061;color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-size:15px;font-weight:700">Accéder à mon espace</a>
      </p>
      <div style="background:#efe3d2;border-radius:14px;padding:14px 16px;font-size:13px;line-height:1.55;color:#665f56">
        Ce lien est personnel et sécurisé. Si tu n’es pas à l’origine de cette demande, ignore simplement cet e-mail.
      </div>
      <p style="font-size:13px;line-height:1.6;color:#746d63;margin:22px 0 0">À bientôt,<br><strong style="color:#2b574d">Oscar Blends</strong></p>
    </div>
  </div>
</body>
</html>`;

  const text=`Oscar Blends — Ton lien de connexion

Bonjour,

Tu as demandé à accéder à ton espace client Oscar Blends avec l’adresse ${email}.

Accéder à mon espace :
${actionLink}

Ce lien est personnel et sécurisé. Si tu n’es pas à l’origine de cette demande, ignore simplement cet e-mail.

À bientôt,
Oscar Blends`;

  return {
    subject:'Ton lien de connexion — Oscar Blends',
    html,
    text
  };
}

module.exports=async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});

  try{
    const email=normalizeEmail(typeof req.body==='string'?JSON.parse(req.body||'{}').email:req.body?.email);
    if(!validEmail(email)) return json(res,400,{error:'Adresse e-mail invalide'});
    if(!isConfigured()) return json(res,503,{error:'L’envoi des e-mails n’est pas configuré'});

    const db=adminClient();
    const limit=await rateLimit(db,email);
    if(!limit.ok){
      res.setHeader('Retry-After',String(limit.retryAfter||60));
      return json(res,429,{error:'Un lien vient déjà d’être envoyé. Attends un peu avant de réessayer.'});
    }

    const base=siteBase(req);
    if(!base) throw new Error('URL du site introuvable');
    const loginToken=createLoginToken(email);
    const actionLink=`${base}/api/account-auth?token=${encodeURIComponent(loginToken)}`;

    const mailer=createMailer();
    const mail=emailTemplate({email,actionLink,base});
    await mailer.send({to:email,subject:mail.subject,html:mail.html,text:mail.text});

    if(limit.persistent&&limit.next){
      const {error:logError}=await db
        .from('account_login_requests')
        .upsert(limit.next,{onConflict:'email_hash'});
      if(logError) console.error('account_login_requests',logError);
    }

    return json(res,200,{ok:true});
  }catch(error){
    console.error(error);
    const message=String(error?.message||'').toLowerCase();
    const code=String(error?.code||error?.error_code||'').toLowerCase();
    const isRateLimit=
      Number(error?.status)===429 ||
      message.includes('rate limit') ||
      code.includes('rate_limit') ||
      code.includes('over_email_send_rate_limit');

    if(isRateLimit){
      res.setHeader('Retry-After','60');
      return json(res,429,{
        error:'Un lien de connexion vient déjà d’être généré. Attends environ 1 minute avant de recommencer.',
        retryAfter:60
      });
    }

    return json(res,500,{error:'Impossible d’envoyer le lien pour le moment. Réessaie dans quelques instants.'});
  }
};
