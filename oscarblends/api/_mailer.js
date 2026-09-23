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
      html,
      text
    })
  };
}

module.exports={config,isConfigured,createMailer};
