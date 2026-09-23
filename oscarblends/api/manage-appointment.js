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

function validToken(token){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(token||''));
}

async function getAppointment(token){
  const rows=await supabaseRequest(
    `/rest/v1/appointments?management_token=eq.${encodeURIComponent(token)}&select=id,status,starts_at,ends_at,customer_name,phone,email,notes,created_at,expires_at,confirmed_at,cancellation_reason,services(slug,name,price_cents,duration_minutes,buffer_after_minutes)&limit=1`
  );
  return Array.isArray(rows)?rows[0]:null;
}

module.exports=async function handler(req,res){
  try{
    const token=String(req.method==='GET'?(req.query?.token||''):(req.body?.token||''));
    if(!validToken(token)) return json(res,400,{error:'Lien de gestion invalide'});

    if(req.method==='GET'){
      const appointment=await getAppointment(token);
      if(!appointment) return json(res,404,{error:'Rendez-vous introuvable'});
      return json(res,200,{appointment});
    }

    if(req.method!=='POST') return json(res,405,{error:'Méthode non autorisée'});

    const body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    const action=String(body.action||'');

    if(action==='cancel'){
      await supabaseRequest('/rest/v1/rpc/client_cancel_appointment',{
        method:'POST',
        body:JSON.stringify({p_token:token})
      });
    }else if(action==='move'){
      const date=String(body.date||'');
      const time=String(body.time||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)){
        return json(res,400,{error:'Nouveau créneau invalide'});
      }
      await supabaseRequest('/rest/v1/rpc/client_move_appointment',{
        method:'POST',
        body:JSON.stringify({p_token:token,p_date:date,p_time:time})
      });
    }else{
      return json(res,400,{error:'Action inconnue'});
    }

    const appointment=await getAppointment(token);
    return json(res,200,{ok:true,appointment});
  }catch(error){
    console.error(error);
    const message=error instanceof Error?error.message:'Erreur serveur';
    const status=/introuvable/i.test(message)?404:/ne peut|indisponible|chevauche|dehors|proche|autorisé|pris/i.test(message)?409:500;
    return json(res,status,{error:message});
  }
};
