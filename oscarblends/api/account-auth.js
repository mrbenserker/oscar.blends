const {createSessionToken,verifySignedToken,sessionCookie}=require('./_account-auth');

module.exports=async function handler(req,res){
  if(req.method!=='GET'){
    res.status(405).end('Méthode non autorisée');
    return;
  }

  try{
    const payload=verifySignedToken(req.query&&req.query.token,'login');
    if(!payload){
      res.status(302).setHeader('Location','/compte.html?login=invalid').end();
      return;
    }

    const session=createSessionToken(String(payload.email).trim().toLowerCase());
    res.setHeader('Set-Cookie',sessionCookie(session));
    res.setHeader('Cache-Control','no-store');
    res.status(302).setHeader('Location','/compte.html?login=success').end();
  }catch(error){
    console.error(error);
    res.status(302).setHeader('Location','/compte.html?login=error').end();
  }
};
