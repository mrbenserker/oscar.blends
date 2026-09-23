const {clearSessionCookie}=require('./_account-auth');

module.exports=async function handler(req,res){
  if(req.method!=='POST'){
    res.status(405).end('Méthode non autorisée');
    return;
  }
  res.setHeader('Set-Cookie',clearSessionCookie());
  res.setHeader('Cache-Control','no-store');
  res.status(200).json({ok:true});
};
