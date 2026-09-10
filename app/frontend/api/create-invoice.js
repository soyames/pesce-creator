export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Méthode non autorisée.' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(503).json({ message: 'Le paiement en Étoiles n’est pas encore configuré côté serveur.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const requestedStars = Number(body.stars);
    const allowedStars = [50, 100, 250, 500, 1000];
    const stars = allowedStars.includes(requestedStars) ? requestedStars : 100;

    const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Soutien à Pesce',
        description: `Soutenir le travail journalistique de Pesce avec ${stars} Étoiles Telegram.`,
        payload: `pesce_support_${stars}_${Date.now()}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'Soutien à Pesce', amount: stars }]
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      return res.status(502).json({ message: data.description || 'Telegram n’a pas pu créer la facture.' });
    }

    return res.status(200).json({ invoiceLink: data.result, stars });
  } catch (error) {
    return res.status(500).json({ message: 'Impossible de préparer le paiement pour le moment.' });
  }
}
