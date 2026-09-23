const {isConfigured}=require('./_mailer');
module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const gmailUserConfigured = Boolean(String(process.env.GMAIL_USER || '').trim());
  const gmailPasswordConfigured = Boolean(String(process.env.GMAIL_APP_PASSWORD || '').trim());
  const emailEnabled = isConfigured();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.status(200).json({
    supabaseUrl,
    supabasePublishableKey,
    emailEnabled,
    gmailUserConfigured,
    gmailPasswordConfigured
  });
};
