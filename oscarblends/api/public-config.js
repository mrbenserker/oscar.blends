module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const emailEnabled = Boolean((process.env.GMAIL_USER || '').trim() && (process.env.GMAIL_APP_PASSWORD || '').trim());
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.status(200).json({ supabaseUrl, supabasePublishableKey, emailEnabled });
};
