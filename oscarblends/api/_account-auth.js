const crypto=require('crypto');

const COOKIE_NAME='oscar_account_session';
const LOGIN_TTL_SECONDS=15*60;
const SESSION_TTL_SECONDS=30*24*60*60;

function secret(){
  const value=String(process.env.ACCOUNT_AUTH_SECRET||process.env.CRON_SECRET||'').trim();
  if(!value) throw new Error('ACCOUNT_AUTH_SECRET ou CRON_SECRET non configuré');
  return value;
}

function signPayload(payload){
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature=crypto.createHmac('sha256',secret()).update(body).digest('base64url');
  return body+'.'+signature;
}

function verifySignedToken(token,expectedType){
  const parts=String(token||'').split('.');
  if(parts.length!==2) return null;
  const body=parts[0],signature=parts[1];
  const expected=crypto.createHmac('sha256',secret()).update(body).digest('base64url');
  const a=Buffer.from(signature);
  const b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return null;
  let payload;
  try{payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'))}catch{return null}
  if(!payload||payload.type!==expectedType||!payload.email||!payload.exp) return null;
  if(Number(payload.exp)*1000<=Date.now()) return null;
  return payload;
}

function createLoginToken(email){
  return signPayload({
    type:'login',
    email,
    exp:Math.floor(Date.now()/1000)+LOGIN_TTL_SECONDS,
    nonce:crypto.randomBytes(16).toString('hex')
  });
}

function createSessionToken(email){
  return signPayload({
    type:'session',
    email,
    exp:Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS,
    nonce:crypto.randomBytes(16).toString('hex')
  });
}

function readCookie(req,name){
  const raw=String(req.headers.cookie||'');
  for(const part of raw.split(';')){
    const bits=part.trim().split('=');
    const key=bits.shift();
    if(key===name) return decodeURIComponent(bits.join('='));
  }
  return '';
}

function sessionFromRequest(req){
  return verifySignedToken(readCookie(req,COOKIE_NAME),'session');
}

function sessionCookie(token){
  return COOKIE_NAME+'='+encodeURIComponent(token)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+SESSION_TTL_SECONDS;
}

function clearSessionCookie(){
  return COOKIE_NAME+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

module.exports={
  createLoginToken,
  createSessionToken,
  verifySignedToken,
  sessionFromRequest,
  sessionCookie,
  clearSessionCookie
};
