// Studio créatrice (privé). Toute action exige une initData valide ET l'identifiant créatrice configuré.
// Actions : publish (texte), article_publish (article Telegraph), draft, backfill_support, telegraph_setup,
// tickets, resolve, reply. Le GET renvoie la vue d'ensemble + l'état de la configuration Telegraph.
import { createDraft, createLiveSchedule, getStudioOverview, LIVE_STATUSES, listChannelPosts, listSupportTickets, updateLiveSchedule, updateSupportTicket } from '../lib/db.js';
import { isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';
import { newDraftId, newLiveId } from '../lib/tickets.js';
import { createTelegraphAccount, createTelegraphPage, nodesFromPlainText } from '../lib/telegraph.js';
import { CHANNEL_HANDLE, CREATOR_NAME, SUPPORT_URL } from '../lib/config.js';

export default async function handler(req, res) {
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ message: 'Bot Telegram non configuré.' });

  const initData = typeof req.headers['x-telegram-init-data'] === 'string' ? req.headers['x-telegram-init-data'] : (typeof req.body?.initData === 'string' ? req.body.initData : '');
  if (!validateTelegramInitData(initData, token)) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });

  const user = telegramUserFromInitData(initData);
  if (!user?.id || !isCreatorTelegramUser(user.id)) return res.status(403).json({ message: 'Accès réservé au studio de Pesce.' });

  try {
    if (req.method === 'GET') {
      const overview = await getStudioOverview();
      return res.status(200).json({ ...serialize(overview), telegraphConfigured: Boolean(process.env.TELEGRAPH_ACCESS_TOKEN) });
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '').trim();

    if (action === 'publish') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le texte de la publication est vide.' });
      const sent = await telegram(token, 'sendMessage', { chat_id: CHANNEL_HANDLE, text, disable_web_page_preview: false, reply_markup: supportMarkup() });
      return res.status(200).json({ ok: true, messageId: sent.result?.message_id || null });
    }

    if (action === 'article_publish') {
      const title = String(body.title || '').trim().slice(0, 256);
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!title || !text) return res.status(400).json({ message: 'Le titre et le texte sont requis pour un article.' });
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré. Utilisez « Configurer Telegraph » dans le studio, puis enregistrez le jeton dans TELEGRAPH_ACCESS_TOKEN.' });
      const page = await createTelegraphPage({ accessToken, title, content: nodesFromPlainText(text), authorName: CREATOR_NAME });
      await telegram(token, 'sendMessage', { chat_id: CHANNEL_HANDLE, text: `${title}\n\n${page.url}`, disable_web_page_preview: false, reply_markup: supportMarkup() });
      return res.status(200).json({ ok: true, url: page.url });
    }

    if (action === 'draft') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le brouillon est vide.' });
      const id = newDraftId();
      await createDraft({ id, text, status: 'draft', authorTelegramUserId: String(user.id) });
      return res.status(200).json({ ok: true, draftId: id });
    }

    if (action === 'backfill_support') {
      const posts = await listChannelPosts({ limit: 50 });
      let updated = 0;
      for (const post of posts) {
        if (!post.messageId) continue;
        try {
          await telegram(token, 'editMessageReplyMarkup', { chat_id: post.channelId || CHANNEL_HANDLE, message_id: Number(post.messageId), reply_markup: supportMarkup() });
          updated += 1;
        } catch (error) {
          console.error('support backfill failed', post.id, error);
        }
      }
      return res.status(200).json({ ok: true, updated, checked: posts.length });
    }

    if (action === 'live_create') {
      const title = String(body.title || '').trim().slice(0, 256);
      const scheduledAt = new Date(body.scheduledAt);
      if (!title || !body.scheduledAt || isNaN(scheduledAt.getTime())) return res.status(400).json({ message: 'Le titre et la date/heure du direct sont requis.' });
      const status = LIVE_STATUSES.includes(body.status) ? body.status : 'scheduled';
      const id = newLiveId();
      await createLiveSchedule({
        id,
        title,
        description: String(body.description || '').trim().slice(0, 4000),
        scheduledAt,
        link: String(body.link || '').trim().slice(0, 512) || null,
        status,
      });
      return res.status(200).json({ ok: true, liveId: id });
    }

    if (action === 'live_update' || action === 'live_cancel') {
      const liveId = String(body.liveId || '').trim();
      if (!liveId) return res.status(400).json({ message: 'Direct manquant.' });
      if (action === 'live_cancel') {
        await updateLiveSchedule(liveId, { status: 'cancelled' });
        return res.status(200).json({ ok: true });
      }
      const fields = {};
      if (body.title !== undefined) fields.title = String(body.title).trim().slice(0, 256);
      if (body.description !== undefined) fields.description = String(body.description).trim().slice(0, 4000);
      if (body.link !== undefined) fields.link = String(body.link).trim().slice(0, 512) || null;
      if (body.scheduledAt !== undefined) {
        const date = new Date(body.scheduledAt);
        if (isNaN(date.getTime())) return res.status(400).json({ message: 'Date/heure du direct invalide.' });
        fields.scheduledAt = date;
      }
      if (body.status !== undefined) {
        if (!LIVE_STATUSES.includes(body.status)) return res.status(400).json({ message: 'Statut de direct invalide.' });
        fields.status = body.status;
      }
      if (Object.keys(fields).length === 0) return res.status(400).json({ message: 'Aucune modification.' });
      await updateLiveSchedule(liveId, fields);
      return res.status(200).json({ ok: true });
    }

    if (action === 'telegraph_setup') {
      if (process.env.TELEGRAPH_ACCESS_TOKEN) return res.status(400).json({ message: 'Telegraph est déjà configuré.' });
      const account = await createTelegraphAccount('PesceHounyo', CREATOR_NAME);
      console.log('TELEGRAPH_ACCESS_TOKEN à sauvegarder :', account.access_token);
      return res.status(200).json({ ok: true, accessToken: account.access_token, authUrl: account.auth_url, hint: 'Sauvegardez ce jeton dans la variable d’environnement TELEGRAPH_ACCESS_TOKEN (Vercel), puis redéployez.' });
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

function supportMarkup() {
  return { inline_keyboard: [[{ text: '⭐ Soutenir le travail de Pesce', url: SUPPORT_URL }]] };
}

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} a échoué: ${data.description || response.status}`);
  return data;
}

function serialize(value) {
  if (Array.isArray(value)) return value.map(serialize);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
}
