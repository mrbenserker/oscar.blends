function esc(value=''){
  return String(value).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[c]));
}

function button(href,label){
  if(!href) return '';
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">
    <tr>
      <td bgcolor="#3b7061" class="ob-button" style="border-radius:999px;background-color:#3b7061!important;background-image:linear-gradient(#3b7061,#3b7061)!important">
        <a href="${esc(href)}" style="display:inline-block;color:#ffffff!important;text-decoration:none;padding:13px 20px;font-size:15px;font-weight:700;border-radius:999px">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

function panel(content){
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 22px">
    <tr>
      <td bgcolor="#efe3d2" class="ob-note ob-muted" style="background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important;border-radius:14px;padding:18px;color:#665f56!important">
        ${content}
      </td>
    </tr>
  </table>`;
}

function renderEmail({title,eyebrow='Oscar Blends',content='',footer='À bientôt,<br><strong>Oscar Blends</strong>'}={}){
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(title||'Oscar Blends')}</title>
  <style>
    :root{color-scheme:light only;supported-color-schemes:light}
    body,table,td,p,a,span,div,h1,h2,strong{color-scheme:light only!important}
    .ob-page{background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important}
    .ob-header{background-color:#2b574d!important;background-image:linear-gradient(#2b574d,#2b574d)!important}
    .ob-card{background-color:#fbf5ec!important;background-image:linear-gradient(#fbf5ec,#fbf5ec)!important}
    .ob-note{background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important}
    .ob-button{background-color:#3b7061!important;background-image:linear-gradient(#3b7061,#3b7061)!important}
    .ob-text{color:#1d2925!important}
    .ob-green{color:#2b574d!important}
    .ob-muted{color:#665f56!important}
    .ob-white{color:#ffffff!important}
    [data-ogsc] .ob-page{background:#efe3d2!important}
    [data-ogsc] .ob-header{background:#2b574d!important}
    [data-ogsc] .ob-card{background:#fbf5ec!important}
    [data-ogsc] .ob-note{background:#efe3d2!important}
    [data-ogsc] .ob-button{background:#3b7061!important}
    [data-ogsc] .ob-text{color:#1d2925!important}
    [data-ogsc] .ob-green{color:#2b574d!important}
    [data-ogsc] .ob-muted{color:#665f56!important}
    [data-ogsc] .ob-white{color:#ffffff!important}
  </style>
</head>
<body class="ob-page" bgcolor="#efe3d2" style="margin:0;padding:0;background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important;font-family:Arial,Helvetica,sans-serif;color:#1d2925!important">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#efe3d2" class="ob-page" style="width:100%;background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important">
    <tr>
      <td align="center" bgcolor="#efe3d2" class="ob-page" style="padding:30px 16px;background-color:#efe3d2!important;background-image:linear-gradient(#efe3d2,#efe3d2)!important">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px">
          <tr>
            <td bgcolor="#2b574d" class="ob-header ob-white" style="padding:25px 27px;border-radius:20px 20px 0 0;background-color:#2b574d!important;background-image:linear-gradient(#2b574d,#2b574d)!important;color:#ffffff!important">
              <div class="ob-white" style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#ffffff!important;opacity:.82">${esc(eyebrow)}</div>
              <h1 class="ob-white" style="font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.15;font-weight:500;margin:9px 0 0;color:#ffffff!important">${esc(title||'Oscar Blends')}</h1>
            </td>
          </tr>
          <tr>
            <td bgcolor="#fbf5ec" class="ob-card ob-text" style="padding:27px;border:1px solid #e3d7c7;border-top:0;border-radius:0 0 20px 20px;background-color:#fbf5ec!important;background-image:linear-gradient(#fbf5ec,#fbf5ec)!important;color:#1d2925!important">
              ${content}
              <p class="ob-muted" style="font-size:13px;line-height:1.6;color:#665f56!important;margin:22px 0 0">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports={esc,button,panel,renderEmail};
