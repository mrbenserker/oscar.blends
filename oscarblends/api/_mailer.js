const nodemailer=require('nodemailer');

function config(){
  const gmailUser=String(process.env.GMAIL_USER||'').trim();
  const gmailPass=String(process.env.GMAIL_APP_PASSWORD||'').replace(/\s+/g,'');
  if(!gmailUser||!gmailPass) return null;

  return {
    user:gmailUser,
    pass:gmailPass,
    from:String(process.env.EMAIL_FROM||`Oscar Blends <${gmailUser}>`).trim(),
    replyTo:String(process.env.EMAIL_REPLY_TO||gmailUser).trim()
  };
}

function isConfigured(){
  return Boolean(config());
}

function darkModeSafeHtml(html=''){
  let out=String(html||'');
  if(!out) return out;

  const protection=`
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <style>
    :root{color-scheme:light only;supported-color-schemes:light}
    body,table,td,div,p,a,span,h1,h2,h3,strong{color-scheme:light only!important}
  </style>`;

  if(!/name=["']color-scheme["']/i.test(out)){
    if(/<head[^>]*>/i.test(out)){
      out=out.replace(/<head([^>]*)>/i,`<head$1>${protection}`);
    }else if(/<html[^>]*>/i.test(out)){
      out=out.replace(/<html([^>]*)>/i,`<html$1><head>${protection}</head>`);
    }else{
      out=`<!doctype html><html><head>${protection}</head><body>${out}</body></html>`;
    }
  }

  // Les gradients 1 couleur sont volontairement redondants :
  // Outlook/Gmail mobile ont tendance à inverser background-color en mode sombre,
  // mais conservent généralement les background-image.
  out=out.replace(
    /background:(#[0-9a-fA-F]{3,8})(?![^;"']*!important)/g,
    'background-color:$1!important;background-image:linear-gradient($1,$1)!important'
  );

  // Conserve les couleurs de texte explicites sans toucher aux background-color.
  out=out.replace(
    /(^|[;\s"'])color:(#[0-9a-fA-F]{3,8})(?!\s*!important)/g,
    '$1color:$2!important'
  );

  return out;
}

function createMailer(){
  const c=config();
  if(!c) return null;

  const transporter=nodemailer.createTransport({
    host:'smtp.gmail.com',
    port:465,
    secure:true,
    auth:{user:c.user,pass:c.pass}
  });

  return {
    config:c,
    transporter,
    send:({to,subject,html,text})=>transporter.sendMail({
      from:c.from,
      replyTo:c.replyTo,
      to,
      subject,
      html:darkModeSafeHtml(html),
      text
    })
  };
}

module.exports={config,isConfigured,createMailer,darkModeSafeHtml};
