import crypto from 'node:crypto';

const ALLOWED_STARS = [50, 100, 250, 500, 1000];
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Méthode non autorisée.' });
  }

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) {
    return res.status(503).json({ message: 'Le paiement en Étoiles n’est pas encore configuré côté serveur.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!validateTelegramInitData(initData, token)) {
      return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });
    }

    const requestedStars = Number(body.stars);
    const stars = ALLOWED_STARS.includes(requestedStars) ? requestedStars : 100;

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
    console.error(error);
    return res.status(500).json({ message: 'Impossible de préparer le paiement pour le moment.' });
  }
}

function validateTelegramInitData(initData, botToken) {
  if (!initData) return false;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!receivedHash || !Number.isFinite(authDate)) return false;

  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > MAX_AUTH_AGE_SECONDS) return false;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'hex'),
      Buffer.from(receivedHash, 'hex')
    );
  } catch {
    return false;
  }
}
