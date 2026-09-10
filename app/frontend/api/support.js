import { createSupportTicket } from '../lib/firestore.js';
import { telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Support Telegram non configuré.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!validateTelegramInitData(initData, token)) {
      return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });
    }

    const user = telegramUserFromInitData(initData);
    const message = String(body.message || '').trim().slice(0, 4000);
    if (!message) return res.status(400).json({ message: 'Décrivez votre problème avant d’envoyer la demande.' });

    const ticketId = createTicketId();
    await createSupportTicket({
      id: ticketId,
      chatId: user?.id || null,
      userId: String(user?.id || ''),
      username: user?.username || null,
      firstName: user?.first_name || null,
      message,
      status: 'open',
      source: 'mini_app'
    });

    await telegram(token, 'sendMessage', {
      chat_id: user.id,
      text: `Votre demande de support ${ticketId} a bien été reçue.\n\nNous vous répondrons ici dès que possible.`
    });

    return res.status(200).json({ ok: true, ticketId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Impossible d’enregistrer votre demande pour le moment.' });
  }
}

function createTicketId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PS-${date}-${suffix}`;
}

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} a échoué: ${data.description || response.status}`);
  return data;
}
