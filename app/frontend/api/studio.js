// Studio créatrice (privé). Toute action exige UNE des deux preuves d'identité côté serveur :
//   - une initData Telegram valide ET l'identifiant créatrice configuré (Mini App Telegram), ou
//   - une session web valide (cookie HttpOnly → Neon) issue de la connexion Google /studio,
//     réservée aux adresses PESCE_WEB_ADMIN_EMAILS.
// Actions : publish (texte), article_publish (article Telegraph), draft, backfill_support, telegraph_setup,
// tickets, resolve, reply. Le GET renvoie la vue d'ensemble + l'état de la configuration Telegraph.
import { createDraft, createLiveSchedule, deleteDraft, getPayment, getStudioOverview, LIVE_STATUSES, listChannelPosts, listSupportTickets, markPaymentRefunded, updateLiveSchedule, updateSupportTicket, upsertChannelPost } from '../lib/db.js';
import { isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';
import { newDraftId, newLiveId } from '../lib/tickets.js';
import { articleCoverFromPage, articleExcerptFromPage, createTelegraphAccount, createTelegraphPage, getTelegraphPage, listTelegraphPages, MAX_TELEGRAPH_IMAGE_BYTES, nodesFromArticle, nodesFromPlainText, normalizeTelegraphImage, telegraphBackfillPost, uploadTelegraphImage, validateArticleImages } from '../lib/telegraph.js';
import { webSessionEmailFromRequest } from '../lib/web-session.js';
import { isWebAdminEmail } from '../lib/google-auth.js';
import { normalizeYouTubeUrl } from '../lib/youtube.js';
import { CHANNEL_HANDLE, CREATOR_NAME, SUPPORT_URL } from '../lib/config.js';

// Audio enregistré/importer depuis le navigateur : limite du corps JSON serverless (~4,5 Mo),
// soit ~3,3 Mo de données audio — plusieurs minutes de note vocale en Opus.
const MAX_STUDIO_AUDIO_BYTES = 3 * 1024 * 1024;

export default async function handler(req, res) {
  // Le jeton du bot reste nécessaire aux actions de publication, quel que soit le flux d'authentification.
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;

  // 1) Session web (Studio /studio) : la requête porte le cookie de session autorisé ?
  //    En cas de base indisponible, la session est refusée (fail-closed) et le flux Telegram reste.
  let webEmail = null;
  try { webEmail = await webSessionEmailFromRequest(req); } catch (error) { console.error('web session check failed', error); }
  const webAuthorized = Boolean(webEmail && isWebAdminEmail(webEmail));

  let actorId = null;
  if (!webAuthorized) {
    // 2) Flux Telegram (Mini App) : inchangé.
    if (!token) return res.status(503).json({ message: 'Bot Telegram non configuré.' });
    const initData = typeof req.headers['x-telegram-init-data'] === 'string' ? req.headers['x-telegram-init-data'] : (typeof req.body?.initData === 'string' ? req.body.initData : '');
    if (!validateTelegramInitData(initData, token)) return res.status(401).json({ message: 'Session Telegram invalide ou expirée.' });
    const user = telegramUserFromInitData(initData);
    if (!user?.id || !isCreatorTelegramUser(user.id)) return res.status(403).json({ message: 'Accès réservé au studio de Pesce.' });
    actorId = String(user.id);
  } else {
    // Identité web pour les colonnes d'audit (texte libre) : préfixe « web: » + adresse.
    actorId = `web:${webEmail}`;
  }

  try {
    if (req.method === 'GET') {
      const overview = await getStudioOverview();
      // Synchronisation automatique des articles Telegraph (idempotente, non bloquante) :
      // tout article publié sur Telegraph est référencé dans pesce_posts même si le webhook
      // n'a pas été reçu — la couverture vient de Telegraph, jamais d'un binaire local.
      try { await backfillTelegraphArticles(); } catch (error) { console.error('telegraph backfill failed', error); }
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
      // Images d'article : hébergées par Telegraph uniquement (liste blanche de chemins /file/…).
      const images = validateArticleImages(body.images);
      if (Array.isArray(body.images) && body.images.length > 0 && images.length === 0) {
        return res.status(400).json({ message: 'Images d’article invalides : seuls les chemins Telegraph (/file/…) sont acceptés.' });
      }
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré. Utilisez « Configurer Telegraph » dans le studio, puis enregistrez le jeton dans TELEGRAPH_ACCESS_TOKEN.' });
      const page = await createTelegraphPage({ accessToken, title, content: images.length ? nodesFromArticle({ text, images }) : nodesFromPlainText(text), authorName: CREATOR_NAME });
      const cover = images.find((image) => image.placement === 'cover');
      const sent = await telegram(token, 'sendMessage', { chat_id: CHANNEL_HANDLE, text: `${title}\n\n${page.url}`, disable_web_page_preview: false, reply_markup: supportMarkup() });
      // Métadonnées d'article écrites immédiatement dans Neon (même table, même upsert que le
      // webhook — identifiant identique chatId_messageId, donc aucun doublon) : l'article et sa
      // couverture Telegraph sont visibles dans le Mini App sans dépendre du round-trip webhook.
      try {
        const messageId = Number(sent.result?.message_id);
        const chatId = Number(sent.result?.chat?.id);
        if (messageId && chatId) {
          await upsertChannelPost({
            id: `${chatId}_${messageId}`,
            source: 'studio',
            channelId: chatId,
            channelUsername: CHANNEL_USERNAME,
            messageId,
            contentType: 'text',
            text: `${title}\n\n${page.url}`,
            telegramUrl: `https://t.me/${CHANNEL_USERNAME}/${messageId}`,
            articleUrl: page.url,
            articleImageUrl: cover ? cover.src : null,
            published: true,
            publishedAt: new Date((sent.result?.date || Math.floor(Date.now() / 1000)) * 1000),
            receivedAt: new Date(),
          });
        }
      } catch (error) {
        console.error('article metadata pre-insert failed (le webhook synchronisera le texte)', error);
      }
      return res.status(200).json({ ok: true, url: page.url });
    }

    // Ressynchronisation d'un article déjà publié sur le canal (posté avant la synchronisation
    // des métadonnées) : récupère la page Telegraph et met à jour Neon par le mécanisme normal.
    if (action === 'resync_message') {
      const messageId = Number(body.messageId);
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (!messageId) return res.status(400).json({ message: 'Identifiant du message requis.' });
      if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré : TELEGRAPH_ACCESS_TOKEN est requis.' });
      const path = (String(body.telegraphUrl || '').match(/telegra\.ph\/([\w\-./]+)/i) || [])[1] || '';
      if (!path) return res.status(400).json({ message: 'Lien Telegraph de l’article requis.' });
      const page = await getTelegraphPage({ accessToken, path });
      if (!page?.title) return res.status(404).json({ message: 'Article Telegraph introuvable.' });
      const chat = await telegram(token, 'getChat', { chat_id: CHANNEL_HANDLE });
      const chatId = Number(chat.result?.id);
      if (!chatId) return res.status(502).json({ message: 'Canal Telegram introuvable.' });
      const cover = articleCoverFromPage(page);
      await upsertChannelPost({
        id: `${chatId}_${messageId}`,
        source: 'studio',
        channelId: chatId,
        channelUsername: CHANNEL_USERNAME,
        messageId,
        contentType: 'text',
        text: `${page.title}\n\n${articleExcerptFromPage(page)}\n\nhttps://telegra.ph/${path}`,
        telegramUrl: `https://t.me/${CHANNEL_USERNAME}/${messageId}`,
        articleUrl: `https://telegra.ph/${path}`,
        articleImageUrl: cover,
        published: true,
        publishedAt: new Date(),
        receivedAt: new Date(),
      });
      return res.status(200).json({ ok: true, cover });
    }

    // Image neuve → hébergée par Telegraph (stockage natif des articles, aucun binaire dans Neon).
    if (action === 'article_image_upload') {
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré : TELEGRAPH_ACCESS_TOKEN est requis.' });
      const data = String(body.data || '');
      const match = data.match(/^data:image\/(jpeg|png|gif|webp);base64,(.+)$/i);
      if (!match) return res.status(400).json({ message: 'Image encodée invalide.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length === 0 || buffer.length > MAX_TELEGRAPH_IMAGE_BYTES) {
        return res.status(400).json({ message: 'Image trop volumineuse (4 Mo maximum).' });
      }
      const uploaded = await uploadTelegraphImage({ accessToken, buffer, filename: `pesce-${Date.now()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}` });
      return res.status(200).json({ ok: true, ...uploaded });
    }

    // Vidéo : YouTube reste l'hébergeur (V1) — le studio publie la référence, jamais un fichier.
    if (action === 'video_publish' || action === 'video_update') {
      const title = String(body.title || '').trim().slice(0, 256);
      const description = String(body.description || '').trim().slice(0, 4000);
      const youtubeUrl = normalizeYouTubeUrl(body.youtubeUrl);
      if (!title || !youtubeUrl) return res.status(400).json({ message: 'Le titre et un lien YouTube valide sont requis.' });
      const text = [title, description, youtubeUrl].filter(Boolean).join('\n\n');
      if (action === 'video_update') {
        const messageId = Number(body.messageId);
        if (!messageId) return res.status(400).json({ message: 'Publication d’origine manquante.' });
        await telegram(token, 'editMessageText', { chat_id: CHANNEL_HANDLE, message_id: messageId, text, disable_web_page_preview: false });
        return res.status(200).json({ ok: true });
      }
      const sent = await telegram(token, 'sendMessage', { chat_id: CHANNEL_HANDLE, text, disable_web_page_preview: false, reply_markup: supportMarkup() });
      return res.status(200).json({ ok: true, messageId: sent.result?.message_id || null });
    }

    // Audio : le fichier est hébergé par Telegram (canon), Neon ne garde que la référence.
    // Le webhook classe les documents audio en « audio » — le Mini App les joue via /api/media.
    if (action === 'audio_publish') {
      const title = String(body.title || '').trim().slice(0, 256);
      const description = String(body.description || '').trim().slice(0, 4000);
      const author = String(body.author || '').trim().slice(0, 256);
      if (!title) return res.status(400).json({ message: 'Le titre de l’audio est requis.' });
      const data = String(body.data || '');
      const match = data.match(/^data:audio\/([a-z0-9.+-]+);base64,(.+)$/i);
      if (!match) return res.status(400).json({ message: 'Audio encodé invalide.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length === 0 || buffer.length > MAX_STUDIO_AUDIO_BYTES) {
        return res.status(400).json({ message: 'Audio trop volumineux (3 Mo maximum, ~6 minutes).' });
      }
      const mimeType = match[1].replace(/;.*$/, '');
      const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp3') ? 'mp3' : mimeType.includes('m4a') ? 'm4a' : mimeType.includes('mp4') ? 'm4a' : 'webm';
      const form = new FormData();
      form.append('chat_id', CHANNEL_HANDLE);
      form.append('document', new Blob([buffer], { type: `audio/${mimeType}` }), `pesce-audio-${Date.now()}.${extension}`);
      form.append('caption', [title, description, author ? `— ${author}` : ''].filter(Boolean).join('\n\n'));
      form.append('reply_markup', JSON.stringify(supportMarkup()));
      const sent = await telegramMultipart('sendDocument', form);
      return res.status(200).json({ ok: true, messageId: sent.result?.message_id || null });
    }

    // Photo existante du canal (métadonnées/file_id dans Neon) → re-téléversée vers Telegraph.
    if (action === 'article_image_from_channel') {
      const fileId = String(body.fileId || '').trim().slice(0, 512);
      if (!fileId) return res.status(400).json({ message: 'Photo du canal manquante.' });
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré : TELEGRAPH_ACCESS_TOKEN est requis.' });
      const file = await telegram(token, 'getFile', { file_id: fileId });
      const filePath = file.result?.file_path;
      if (!filePath) return res.status(404).json({ message: 'Photo Telegram introuvable.' });
      const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (!fileResponse.ok) return res.status(502).json({ message: 'Photo Telegram indisponible.' });
      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_TELEGRAPH_IMAGE_BYTES) {
        return res.status(400).json({ message: 'Photo trop volumineuse (4 Mo maximum).' });
      }
      const uploaded = await uploadTelegraphImage({ accessToken, buffer, filename: `pesce-canal-${Date.now()}.jpg` });
      return res.status(200).json({ ok: true, ...uploaded });
    }

    if (action === 'draft') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le brouillon est vide.' });
      const id = newDraftId();
      await createDraft({ id, text, status: 'draft', authorTelegramUserId: actorId });
      return res.status(200).json({ ok: true, draftId: id });
    }

    if (action === 'draft_delete') {
      const draftId = String(body.draftId || '').trim();
      if (!draftId) return res.status(400).json({ message: 'Brouillon manquant.' });
      await deleteDraft(draftId);
      return res.status(200).json({ ok: true });
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
      await updateSupportTicket(ticketId, { status: 'resolved', resolvedAt: new Date(), resolvedBy: actorId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'reply') {
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!text) return res.status(400).json({ message: 'Réponse vide.' });
      const tickets = await listSupportTickets({ limit: 100 });
      const ticket = tickets.find((item) => item.id === ticketId);
      if (!ticket?.chatId) return res.status(404).json({ message: 'Ticket introuvable.' });
      await telegram(token, 'sendMessage', { chat_id: ticket.chatId, text: `Réponse de Pesce Studio\n\n${text}` });
      await updateSupportTicket(ticketId, { status: 'open', lastReply: text, lastReplyAt: new Date(), lastReplyBy: actorId });
      return res.status(200).json({ ok: true });
    }

    if (action === 'refund') {
      const paymentId = String(body.paymentId || '').trim();
      if (!paymentId) return res.status(400).json({ message: 'Paiement manquant.' });
      const payment = await getPayment(paymentId);
      if (!payment) return res.status(404).json({ message: 'Paiement introuvable.' });
      if (payment.refundedAt) return res.status(400).json({ message: 'Ce paiement a déjà été remboursé.' });
      if (!payment.userId) return res.status(400).json({ message: 'Ce paiement ne peut pas être remboursé.' });
      await telegram(token, 'refundStarPayment', { user_id: payment.userId, telegram_payment_charge_id: paymentId });
      await markPaymentRefunded(paymentId);
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

let lastArticleBackfill = 0;

async function backfillTelegraphArticles() {
  const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
  if (!accessToken) return;
  if (Date.now() - lastArticleBackfill < 5 * 60 * 1000) return; // au plus toutes les 5 minutes par instance
  lastArticleBackfill = Date.now();
  const pages = await listTelegraphPages(accessToken, { limit: 20 });
  for (const page of pages) {
    const post = telegraphBackfillPost(page);
    if (!post) continue;
    post.channelUsername = CHANNEL_USERNAME;
    await upsertChannelPost(post);
  }
}

// Envoi multipart (audio enregistré, etc.) — le corps est un FormData, pas du JSON.
async function telegramMultipart(method, formData) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: formData });
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
