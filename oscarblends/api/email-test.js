const {createMailer,isConfigured}=require('./_mailer');

function json(res,status,payload){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}

function supabaseConfig(){
  const base=process.env.SUPABASE_URL;
  const apiKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
  if(!base||!apiKey) throw new Error('Configuration Supabase publique manquante');
  return {base,apiKey};
}

async function requireAdmin(req){
  const auth=String(req.headers.authorization||'');
  const match=auth.match(/^Bearer\s+(.+)$/i);
  if(!match) return null;
  const token=match[1];
  const {base,apiKey}=supabaseConfig();

  const userRes=await fetch(`${base}/auth/v1/user`,{
    headers:{apikey:apiKey,Authorization:`Bearer ${token}`}
  });
  if(!userRes.ok) return null;
  const user=await userRes.json();
  if(!user?.id||!user?.email) return null;

  const adminRes=await fetch(
    `${base}/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
    {headers:{apikey:apiKey,Authorization:`Bearer ${token}`}}
  );
  if(!adminRes.ok) return null;
  const admins=await adminRes.json();
  return Array.isArray(admins)&&admins.length?user:null;
}

module.exports=async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});
  try{
    const user=await requireAdmin(req);
    if(!user) return json(res,401,{error:'Connexion administrateur requise'});
    if(!isConfigured()) return json(res,409,{error:'Messagerie non configurée dans Vercel'});

    const mailer=createMailer();
    const info=await mailer.send({
      to:user.email,
      subject:'Test e-mail Oscar Blends ✓',
      html:`<!doctype html><html lang="fr"><body style="margin:0;background:#efe3d2;font-family:Arial,sans-serif;color:#1d2925"><div style="max-width:600px;margin:auto;padding:30px 18px"><div style="background:#2b574d;color:#fff;padding:24px;border-radius:18px 18px 0 0"><div style="font-size:12px;letter-spacing:.15em;text-transform:uppercase;opacity:.75">Oscar Blends</div><h1 style="margin:8px 0 0;font-size:24px">L’envoi d’e-mails fonctionne ✓</h1></div><div style="background:#f7eee2;padding:26px;border-radius:0 0 18px 18px"><p style="margin:0 0 10px">Ce message confirme que la messagerie Oscar Blends est correctement configurée.</p><p style="margin:0;color:#746d63">Les confirmations, rappels et alertes de liste d’attente peuvent maintenant être envoyés automatiquement.</p></div></div></body></html>`,
      text:'Test Oscar Blends : l’envoi d’e-mails fonctionne correctement.'
    });

    return json(res,200,{ok:true,email:user.email,id:info?.messageId||null});
  }catch(error){
    console.error(error);
    return json(res,500,{error:error instanceof Error?error.message:'Erreur serveur'});
  }
};
