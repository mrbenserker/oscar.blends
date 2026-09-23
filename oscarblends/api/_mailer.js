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

function applyOscarPalette(html=''){
  let out=String(html||'');

  const replacements=[
    [/#efe3d2/gi,'#fafae7'],
    [/#f4f1e8/gi,'#fafae7'],
    [/#f7f4ec/gi,'#f0efdc'],
    [/#fbf5ec/gi,'#fffdf8'],
    [/#f7eee2/gi,'#fffdf8'],
    [/#18352d/gi,'#2b574d'],
    [/#1d2925/gi,'#17211e'],
    [/#1f2b27/gi,'#17211e'],
    [/#665f56/gi,'#68736f'],
    [/#746d63/gi,'#68736f'],
    [/#6b756f/gi,'#68736f'],
    [/#58635e/gi,'#68736f']
  ];

  for(const [pattern,value] of replacements) out=out.replace(pattern,value);
  return out;
}

function appendClass(attrs='',className){
  const classMatch=attrs.match(/\sclass=(["'])(.*?)\1/i);
  if(classMatch){
    const merged=(classMatch[2]+' '+className).trim().replace(/\s+/g,' ');
    return attrs.replace(classMatch[0],` class=${classMatch[1]}${merged}${classMatch[1]}`);
  }
  return attrs+` class="${className}"`;
}

function decorateDarkModeRoles(html=''){
  const rules=[
    {color:'#fafae7',className:'ob-dm-page'},
    {color:'#fffdf8',className:'ob-dm-surface'},
    {color:'#f0efdc',className:'ob-dm-soft'},
    {color:'#2b574d',className:'ob-dm-header'},
    {color:'#3b7061',className:'ob-dm-action'}
  ];

  let out=html;
  for(const rule of rules){
    const color=rule.color.replace('#','\\#');
    const re=new RegExp(`<(body|table|td|div|a)([^>]*style=["'][^"']*(?:background|background-color)\\s*:\\s*${color}[^"']*["'][^>]*)>`,'gi');
    out=out.replace(re,(match,tag,attrs)=>`<${tag}${appendClass(attrs,rule.className)}>`);
  }
  return out;
}

function darkModeSafeHtml(html=''){
  let out=decorateDarkModeRoles(applyOscarPalette(html));
  if(!out) return out;

  // Autorise explicitement un rendu sombre contrôlé au lieu de laisser
  // Outlook inventer ses propres couleurs.
  out=out.replace(
    /<meta\s+name=["']color-scheme["']\s+content=["'][^"']*["']\s*\/?>/gi,
    '<meta name="color-scheme" content="light dark">'
  );
  out=out.replace(
    /<meta\s+name=["']supported-color-schemes["']\s+content=["'][^"']*["']\s*\/?>/gi,
    '<meta name="supported-color-schemes" content="light dark">'
  );
  out=out.replace(/color-scheme\s*:\s*light only/gi,'color-scheme:light dark');
  out=out.replace(/supported-color-schemes\s*:\s*light(?:\s+only)?/gi,'supported-color-schemes:light dark');

  const protection=`
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    :root{color-scheme:light dark;supported-color-schemes:light dark}

    @media (prefers-color-scheme: dark){
      body,.ob-page,.ob-dm-page{
        background-color:#2b574d!important;
        background-image:linear-gradient(#2b574d,#2b574d)!important;
      }
      .ob-card,.ob-dm-surface{
        background-color:#3b7061!important;
        background-image:linear-gradient(#3b7061,#3b7061)!important;
        border-color:#4f8274!important;
      }
      .ob-note,.ob-dm-soft{
        background-color:#355f54!important;
        background-image:linear-gradient(#355f54,#355f54)!important;
      }
      .ob-header,.ob-dm-header{
        background-color:#2b574d!important;
        background-image:linear-gradient(#2b574d,#2b574d)!important;
      }
      .ob-button,.ob-dm-action{
        background-color:#3b7061!important;
        background-image:linear-gradient(#3b7061,#3b7061)!important;
      }
      .ob-dm-surface,.ob-dm-surface *,
      .ob-dm-soft,.ob-dm-soft *,
      .ob-card,.ob-card *,
      .ob-note,.ob-note *,
      .ob-text,.ob-green,.ob-muted{
        color:#fafae7!important;
      }
      .ob-header,.ob-header *,
      .ob-dm-header,.ob-dm-header *,
      .ob-dm-action,.ob-dm-action *{
        color:#ffffff!important;
      }
    }

    [data-ogsc] body,[data-ogsc] .ob-page,[data-ogsc] .ob-dm-page{
      background-color:#2b574d!important;
      background-image:linear-gradient(#2b574d,#2b574d)!important;
    }
    [data-ogsc] .ob-card,[data-ogsc] .ob-dm-surface{
      background-color:#3b7061!important;
      background-image:linear-gradient(#3b7061,#3b7061)!important;
      border-color:#4f8274!important;
    }
    [data-ogsc] .ob-note,[data-ogsc] .ob-dm-soft{
      background-color:#355f54!important;
      background-image:linear-gradient(#355f54,#355f54)!important;
    }
    [data-ogsc] .ob-header,[data-ogsc] .ob-dm-header{
      background-color:#2b574d!important;
      background-image:linear-gradient(#2b574d,#2b574d)!important;
    }
    [data-ogsc] .ob-button,[data-ogsc] .ob-dm-action{
      background-color:#3b7061!important;
      background-image:linear-gradient(#3b7061,#3b7061)!important;
    }
    [data-ogsc] .ob-dm-surface,[data-ogsc] .ob-dm-surface *,
    [data-ogsc] .ob-dm-soft,[data-ogsc] .ob-dm-soft *,
    [data-ogsc] .ob-card,[data-ogsc] .ob-card *,
    [data-ogsc] .ob-note,[data-ogsc] .ob-note *,
    [data-ogsc] .ob-text,[data-ogsc] .ob-green,[data-ogsc] .ob-muted{
      color:#fafae7!important;
    }
    [data-ogsc] .ob-header,[data-ogsc] .ob-header *,
    [data-ogsc] .ob-dm-header,[data-ogsc] .ob-dm-header *,
    [data-ogsc] .ob-dm-action,[data-ogsc] .ob-dm-action *{
      color:#ffffff!important;
    }
  </style>`;

  if(/<head[^>]*>/i.test(out)){
    out=out.replace(/<head([^>]*)>/i,`<head$1>${protection}`);
  }else if(/<html[^>]*>/i.test(out)){
    out=out.replace(/<html([^>]*)>/i,`<html$1><head>${protection}</head>`);
  }else{
    out=`<!doctype html><html><head>${protection}</head><body>${out}</body></html>`;
  }

  // Stabilise aussi le mode clair.
  out=out.replace(
    /background:(#[0-9a-fA-F]{3,8})(?![^;"']*!important)/g,
    'background-color:$1!important;background-image:linear-gradient($1,$1)!important'
  );
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

module.exports={
  config,
  isConfigured,
  createMailer,
  darkModeSafeHtml,
  applyOscarPalette,
  decorateDarkModeRoles
};
