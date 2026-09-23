const {createClient}=require('@supabase/supabase-js');
const {sessionFromRequest}=require('./_account-auth');

function json(res,status,payload){
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}

function dbClient(){
  const url=String(process.env.SUPABASE_URL||'').trim();
  const key=String(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'').trim();
  if(!url||!key) throw new Error('Configuration Supabase serveur manquante');
  return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'Méthode non autorisée'});

  try{
    const session=sessionFromRequest(req);
    if(!session) return json(res,401,{authenticated:false});

    const email=String(session.email).trim().toLowerCase();
    const db=dbClient();
    const {data,error}=await db
      .from('appointments')
      .select('id,status,starts_at,ends_at,customer_name,management_token,created_at,confirmed_at,services(slug,name,price_cents,duration_minutes)')
      .eq('email',email)
      .order('starts_at',{ascending:false});

    if(error) throw error;

    const appointments=(data||[]).map(a=>({
      id:a.id,
      status:a.status,
      starts_at:a.starts_at,
      ends_at:a.ends_at,
      customer_name:a.customer_name,
      management_token:a.management_token,
      created_at:a.created_at,
      confirmed_at:a.confirmed_at,
      service_slug:a.services&&a.services.slug||'',
      service_name:a.services&&a.services.name||'Prestation',
      price_cents:a.services&&a.services.price_cents||0,
      duration_minutes:a.services&&a.services.duration_minutes||0
    }));

    return json(res,200,{authenticated:true,email,appointments});
  }catch(error){
    console.error(error);
    return json(res,500,{error:'Impossible de charger ton espace pour le moment.'});
  }
};
