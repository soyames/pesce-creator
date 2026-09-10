// Mesure d'audience V1 : événement « open » du Mini App (liste blanche dans lib/db.js).
// initData validée côté serveur ; seule l'identité Telegram de l'utilisateur est conservée, sans autre donnée.
import { AUDIENCE_EVENTS, trackAudienceEvent } from '../lib/db.js';
import { telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Bot Telegram non configuré.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!validateTelegramInitData(initData, token)) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });
    const user = telegramUserFromInitData(initData);
    const event = String(body.event || 'open');
    if (!AUDIENCE_EVENTS.includes(event)) return res.status(400).json({ message: 'Événement inconnu.' });
    await trackAudienceEvent({ userId: user?.id ?? null, event });
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Impossible d’enregistrer l’événement.' });
  }
}
