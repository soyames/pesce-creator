// Création d'un ticket de support depuis la Mini App. La réponse est envoyée par le bot @PesceStudioBot,
// qui reste le canal de conversation (avec /support et /paysupport).
import { createSupportTicket } from '../lib/firestore.js';
import { creatorTelegramUserIds, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';
import { newTicketId } from '../lib/tickets.js';
import { SUPPORT_TOPICS } from '../lib/config.js';

const TOPIC_VALUES = new Set(SUPPORT_TOPICS.map((topic) => topic.value));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Support Telegram non configuré.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const initData = typeof body.initData === 'string' ? body.initData : '';
    if (!validateTelegramInitData(initData, token)) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });

    const user = telegramUserFromInitData(initData);
    if (!user?.id) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });

    const message = String(body.message || '').trim().slice(0, 4000);
    if (!message) return res.status(400).json({ message: 'Décrivez votre problème avant d’envoyer la demande.' });
    const topic = TOPIC_VALUES.has(String(body.topic || '')) ? String(body.topic) : null;

    const ticketId = newTicketId();
    await createSupportTicket({
      id: ticketId,
      chatId: user.id,
      userId: String(user.id),
      username: user.username || null,
      firstName: user.first_name || null,
      message,
      topic,
      status: 'open',
      source: 'mini_app',
    });

    await telegram(token, 'sendMessage', { chat_id: user.id, text: `Votre demande de support ${ticketId} a bien été reçue.\n\nLe bot Pesce Studio vous répondra ici dès que possible.` });
    const topicLabel = SUPPORT_TOPICS.find((item) => item.value === topic)?.label;
    await notifyCreator(token, `Nouvelle demande de support 🛟\nTicket: ${ticketId}\nUtilisateur: ${user.username ? '@' + user.username : user.first_name || user.id}${topicLabel ? `\nSujet: ${topicLabel}` : ''}`);

    return res.status(200).json({ ok: true, ticketId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Impossible d’enregistrer votre demande pour le moment.' });
  }
}

async function notifyCreator(token, text) {
  for (const id of creatorTelegramUserIds()) {
    try { await telegram(token, 'sendMessage', { chat_id: id, text }); }
    catch (error) { console.error('creator notification failed', error); }
  }
}

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description || response.status}`);
  return data;
}
