const nodemailer=require('nodemailer');

function bool(v){
  return ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());
}

function config(){
  const smtpHost=String(process.env.SMTP_HOST||'').trim();
  const smtpUser=String(process.env.SMTP_USER||'').trim();
  const smtpPass=String(process.env.SMTP_PASS||'').trim();
  const smtpPort=Number(process.env.SMTP_PORT||0);
  const smtpSecure=process.env.SMTP_SECURE==null ? smtpPort===465 : bool(process.env.SMTP_SECURE);

  if(smtpHost&&smtpUser&&smtpPass){
    return {
      type:'smtp',
      host:smtpHost,
      port:smtpPort||587,
      secure:smtpSecure,
      user:smtpUser,
      pass:smtpPass,
      from:String(process.env.EMAIL_FROM||`Oscar Blends <${smtpUser}>`).trim(),
      replyTo:String(process.env.EMAIL_REPLY_TO||smtpUser).trim()
    };
  }

  const gmailUser=String(process.env.GMAIL_USER||'').trim();
  const gmailPass=String(process.env.GMAIL_APP_PASSWORD||'').replace(/\s+/g,'');
  if(gmailUser&&gmailPass){
    return {
      type:'gmail',
      host:'smtp.gmail.com',
      port:465,
      secure:true,
      user:gmailUser,
      pass:gmailPass,
      from:String(process.env.EMAIL_FROM||`Oscar Blends <${gmailUser}>`).trim(),
      replyTo:String(process.env.EMAIL_REPLY_TO||gmailUser).trim()
    };
  }

  return null;
}

function isConfigured(){
  return Boolean(config());
}

function createMailer(){
  const c=config();
  if(!c) return null;

  const transporter=nodemailer.createTransport({
    host:c.host,
    port:c.port,
    secure:c.secure,
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
      html,
      text
    })
  };
}

module.exports={config,isConfigured,createMailer};
