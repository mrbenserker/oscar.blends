function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
}

function formatAppointment(startsAt, durationMinutes) {
  const date = new Date(startsAt);
  const dateFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const dateLabel = dateFmt.format(date);
  const capitalizedDate = dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1);
  return {
    dateLabel: capitalizedDate,
    timeLabel: timeFmt.format(date),
    durationLabel: `${durationMinutes} min`
  };
}

function serverSupabaseConfig() {
  const base = process.env.SUPABASE_URL;
  const apiKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !apiKey) throw new Error('Configuration Supabase serveur manquante');
  return { base, apiKey };
}

async function supabaseRequest(path, accessToken, options = {}) {
  const { base, apiKey } = serverSupabaseConfig();
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.hint || data?.details || `Supabase HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function getAuthenticatedUser(accessToken) {
  const { base, apiKey } = serverSupabaseConfig();
  const response = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  return response.json();
}

async function requireAdmin(req) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const accessToken = match[1];
  const user = await getAuthenticatedUser(accessToken);
  if (!user?.id) return null;
  const admins = await supabaseRequest(
    `/rest/v1/admins?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`,
    accessToken
  );
  return Array.isArray(admins) && admins.length ? { user, accessToken } : null;
}

async function getAppointment(id, accessToken) {
  const rows = await supabaseRequest(
    `/rest/v1/appointments?id=eq.${encodeURIComponent(id)}&select=id,status,customer_name,email,phone,starts_at,ends_at,expires_at,confirmation_email_sent_at,confirmation_email_id,confirmation_email_error,management_token,services(slug,name,price_cents,duration_minutes)&limit=1`,
    accessToken
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function patchAppointment(id, patch, accessToken) {
  const rows = await supabaseRequest(`/rest/v1/appointments?id=eq.${encodeURIComponent(id)}&select=*`, accessToken, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function buildConfirmationEmail(appointment) {
  const service = appointment.services || {};
  const { dateLabel, timeLabel, durationLabel } = formatAppointment(appointment.starts_at, service.duration_minutes || 0);
  const price = ((service.price_cents || 0) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  const customer = escapeHtml(appointment.customer_name || '');
  const serviceName = escapeHtml(service.name || 'Prestation');
  const safeDate = escapeHtml(dateLabel);
  const safeTime = escapeHtml(timeLabel);
  const safeDuration = escapeHtml(durationLabel);
  const safePrice = escapeHtml(price);

  const siteBase=(process.env.SITE_URL||process.env.VERCEL_PROJECT_PRODUCTION_URL||'').replace(/\/$/,'');
  const manageUrl=siteBase&&appointment.management_token?`${siteBase.startsWith('http')?siteBase:'https://'+siteBase}/manage.html?t=${appointment.management_token}`:'';

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f1e8;font-family:Arial,Helvetica,sans-serif;color:#1f2b27">
  <div style="max-width:620px;margin:0 auto;padding:28px 18px">
    <div style="background:#18352d;border-radius:18px 18px 0 0;padding:24px 26px;color:#fff">
      <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;opacity:.75">Oscar Blends</div>
      <h1 style="font-size:25px;line-height:1.2;margin:10px 0 0">Ton rendez-vous est confirmé ✓</h1>
    </div>
    <div style="background:#fff;border:1px solid #e6e0d4;border-top:0;border-radius:0 0 18px 18px;padding:26px">
      <p style="font-size:16px;line-height:1.6;margin:0 0 20px">Bonjour ${customer},<br>ton rendez-vous chez <strong>Oscar Blends</strong> est bien confirmé.</p>
      <div style="background:#f7f4ec;border-radius:14px;padding:18px;margin:0 0 22px">
        <div style="font-size:13px;color:#6b756f;margin-bottom:8px">Récapitulatif</div>
        <div style="font-size:20px;font-weight:700;margin-bottom:12px">${safeDate} à ${safeTime}</div>
        <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:6px 0;color:#6b756f">Prestation</td><td style="padding:6px 0;text-align:right;font-weight:700">${serviceName}</td></tr>
          <tr><td style="padding:6px 0;color:#6b756f">Durée</td><td style="padding:6px 0;text-align:right">${safeDuration}</td></tr>
          <tr><td style="padding:6px 0;color:#6b756f">Tarif</td><td style="padding:6px 0;text-align:right">${safePrice}</td></tr>
        </table>
      </div>
      ${manageUrl?`<p style="margin:0 0 20px"><a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:#3b7061;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Gérer mon rendez-vous</a></p>`:''}
      <p style="font-size:14px;line-height:1.6;color:#58635e;margin:0">À bientôt,<br><strong>Oscar Blends</strong></p>
    </div>
  </div>
</body></html>`;

  const text = `Bonjour ${appointment.customer_name || ''},\n\nTon rendez-vous Oscar Blends est confirmé.\n\n${dateLabel} à ${timeLabel}\nPrestation : ${service.name || 'Prestation'}\nDurée : ${durationLabel}\nTarif : ${price}${manageUrl?`\n\nGérer le rendez-vous : ${manageUrl}`:''}\n\nÀ bientôt,\nOscar Blends`;

  return {
    subject: `Rendez-vous Oscar Blends confirmé — ${dateLabel} à ${timeLabel}`,
    html,
    text
  };
}

async function sendConfirmationEmail(appointment) {
  const gmailUser = String(process.env.GMAIL_USER || '').trim();
  const gmailAppPassword = String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!gmailUser) throw new Error('GMAIL_USER manquante dans Vercel');
  if (!gmailAppPassword) throw new Error('GMAIL_APP_PASSWORD manquante dans Vercel');
  if (!appointment.email) throw new Error('Le client n’a pas d’adresse e-mail');

  // Chargé uniquement côté serveur. La dépendance est installée par Vercel via package.json.
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });

  const mail = buildConfirmationEmail(appointment);
  const info = await transporter.sendMail({
    from: `Oscar Blends <${gmailUser}>`,
    replyTo: gmailUser,
    to: appointment.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  });

  return { id: info.messageId || null };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée' });

  try {
    const admin = await requireAdmin(req);
    if (!admin) return json(res, 401, { error: 'Connexion administrateur requise' });
    const accessToken = admin.accessToken;

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!id) return json(res, 400, { error: 'Rendez-vous manquant' });
    if (!['confirm', 'reject', 'cancel', 'resend_confirmation', 'complete', 'no_show'].includes(action)) {
      return json(res, 400, { error: 'Action inconnue' });
    }

    let appointment = await getAppointment(id, accessToken);
    if (!appointment) return json(res, 404, { error: 'Rendez-vous introuvable' });

    if (action === 'complete' || action === 'no_show') {
      if (appointment.status !== 'confirmed') {
        return json(res, 409, { error: 'Seul un rendez-vous confirmé peut être clôturé' });
      }
      const nextStatus=action==='complete'?'completed':'no_show';
      await patchAppointment(id, { status: nextStatus, expires_at: null }, accessToken);
      return json(res, 200, { ok: true, status: nextStatus });
    }

    if (action === 'reject') {
      await patchAppointment(id, { status: 'rejected', expires_at: null, confirmation_email_error: null }, accessToken);
      return json(res, 200, { ok: true, status: 'rejected' });
    }

    if (action === 'cancel') {
      if (!['pending', 'confirmed'].includes(appointment.status)) {
        return json(res, 409, { error: 'Ce rendez-vous ne peut plus être annulé' });
      }
      await patchAppointment(id, { status: 'cancelled', expires_at: null, cancellation_reason: 'Annulé depuis l’espace pro' }, accessToken);
      return json(res, 200, { ok: true, status: 'cancelled' });
    }

    if (action === 'confirm') {
      if (!['pending', 'confirmed'].includes(appointment.status)) {
        return json(res, 409, { error: 'Ce rendez-vous ne peut plus être confirmé' });
      }
      if (appointment.status === 'pending' && appointment.expires_at && new Date(appointment.expires_at).getTime() <= Date.now()) {
        await patchAppointment(id, { status: 'cancelled', expires_at: null, cancellation_reason: 'Délai de confirmation dépassé' }, accessToken);
        return json(res, 409, { error: 'Cette demande a expiré et le créneau a été libéré.' });
      }
      if (appointment.status !== 'confirmed') {
        await patchAppointment(id, { status: 'confirmed', confirmed_at: new Date().toISOString(), expires_at: null }, accessToken);
      }
      appointment = await getAppointment(id, accessToken);
    } else if (appointment.status !== 'confirmed') {
      return json(res, 409, { error: 'Le rendez-vous doit être confirmé avant de renvoyer le mail' });
    }

    const gmailConfigured = Boolean(String(process.env.GMAIL_USER || '').trim() && String(process.env.GMAIL_APP_PASSWORD || '').trim());
    if (!gmailConfigured) {
      return json(res, 200, {
        ok: true,
        status: 'confirmed',
        emailSent: false,
        emailSkipped: true,
        warning: 'Rendez-vous confirmé. L’envoi automatique d’e-mail n’est pas encore configuré.'
      });
    }

    try {
      const sent = await sendConfirmationEmail(appointment);
      const sentAt = new Date().toISOString();
      await patchAppointment(id, {
        confirmation_email_sent_at: sentAt,
        confirmation_email_id: sent.id || null,
        confirmation_email_error: null
      }, accessToken);
      return json(res, 200, { ok: true, status: 'confirmed', emailSent: true, emailSkipped: false, emailId: sent.id || null });
    } catch (mailError) {
      const message = mailError instanceof Error ? mailError.message : 'Erreur inconnue';
      await patchAppointment(id, { confirmation_email_error: message.slice(0, 500) }, accessToken);
      return json(res, 200, {
        ok: true,
        status: 'confirmed',
        emailSent: false,
        emailSkipped: false,
        warning: `Rendez-vous confirmé, mais l’e-mail n’a pas pu être envoyé : ${message}`
      });
    }
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error instanceof Error ? error.message : 'Erreur serveur' });
  }
};
