import { createDraft, getStudioOverview, listChannelPosts, listSupportTickets, updateSupportTicket } from '../lib/firestore.js';
import { isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';

const CHANNEL = '@PesceHounyoOfficiel';
const SUPPORT_URL = 'https://t.me/PesceStudioBot?startapp=support';

export default async function handler(req, res) {
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Bot Telegram non configuré.' });
  const initData = typeof req.headers['x-telegram-init-data'] === 'string' ? req.headers['x-telegram-init-data'] : (typeof req.body?.initData === 'string' ? req.body.initData : '');
  if (!validateTelegramInitData(initData, token)) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });
  const user = telegramUserFromInitData(initData);
  if (!user?.id || !isCreatorTelegramUser(user.id)) return res.status(403).json({ message: 'Accès réservé au studio de Pesce.' });
  try {
    if (req.method === 'GET') return res.status(200).json(serialize(await getStudioOverview()));
    if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '').trim();
    if (action === 'publish') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le texte de la publication est vide.' });
      const sent = await telegram(token, 'sendMessage', { chat_id: CHANNEL, text, disable_web_page_preview: false, reply_markup: supportMarkup() });
      return res.status(200).json({ ok: true, messageId: sent.result?.message_id || null });
    }
    if (action === 'draft') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le brouillon est vide.' });
      const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await createDraft({ id, text, status: 'draft', authorTelegramUserId: String(user.id) });
      return res.status(200).json({ ok: true, draftId: id });
    }
    if (action === 'backfill_support') {
      const posts = await listChannelPosts({ limit: 50 });
      let updated = 0;
      for (const post of posts) {
        if (!post.messageId) continue;
        try { await telegram(token, 'editMessageReplyMarkup', { chat_id: post.channelId || CHANNEL, message_id: Number(post.messageId), reply_markup: supportMarkup() }); updated += 1; } catch (error) { console.error('support backfill failed', post.id, error); }
      }
      return res.status(200).json({ ok: true, updated, checked: posts.length });
    }
    if (action === 'tickets') {
      const tickets = await listSupportTickets({ limit: 100 });
      return res.status(200).json({ tickets: tickets.map(serialize) });
    }
    const ticketId = String(body.ticketId || '').trim();
    if (!ticketId) return res.status(400).json({ message: 'Ticket manquant.' });
    if (action === 'resolve') {
      await updateSupportTicket(ticketId, { status: 'resolved', resolvedAt: new Date(), resolvedBy: String(user.id) });
      return res.status(200).json({ ok: true });
    }
    if (action === 'reply') {
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!text) return res.status(400).json({ message: 'Réponse vide.' });
      const tickets = await listSupportTickets({ limit: 100 });
      const ticket = tickets.find((item) => item.id === ticketId);
      if (!ticket?.chatId) return res.status(404).json({ message: 'Ticket introuvable.' });
      await telegram(token, 'sendMessage', { chat_id: ticket.chatId, text: `Réponse de Pesce Studio\n\n${text}` });
      await updateSupportTicket(ticketId, { status: 'open', lastReply: text, lastReplyAt: new Date(), lastReplyBy: String(user.id) });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ message: 'Action inconnue.' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.message || 'Le studio ne peut pas traiter cette action.' });
  }
}

function supportMarkup() { return { inline_keyboard: [[{ text: '⭐ Soutenir le travail de Pesce', url: SUPPORT_URL }]] }; }
async function telegram(token, method, payload) { const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(`Telegram ${method} a échoué: ${data.description || response.status}`); return data; }
function serialize(value) { if (Array.isArray(value)) return value.map(serialize); if (!value || typeof value !== 'object') return value; if (typeof value.toDate === 'function') return value.toDate().toISOString(); if (value instanceof Date) return value.toISOString(); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)])); }
