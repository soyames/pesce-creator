// Webhook Telegram du bot @PesceStudioBot : commandes, sessions de support, paiements en Étoiles
// et ingestion des publications du canal (channel_post) avec bouton de soutien.
import { createSupportTicket, deleteSupportSession, getSupportSession, markUpdateProcessed, pruneWebhookUpdates, setSupportSession, upsertChannelPost, upsertPayment } from '../lib/db.js';
import { creatorTelegramUserIds, isCreatorTelegramUser } from '../lib/telegram-auth.js';
import { newTicketId } from '../lib/tickets.js';
import { CHANNEL_USERNAME, MINI_APP_URL, STUDIO_URL, SUPPORT_URL } from '../lib/config.js';

let webhookSecretWarned = false;
function warnWebhookSecretOnce() {
  if (webhookSecretWarned) return;
  webhookSecretWarned = true;
  console.warn('TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET non configuré : le webhook accepte tout POST. Configurez le secret et déclarez-le via setWebhook (secret_token).');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  const secret = process.env.TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET;
  if (!token) return res.status(503).json({ message: 'Bot Telegram de Pesce Studio non configuré.' });
  // Fail-closed : sans secret configuré, le webhook refuse tout POST (et non l'inverse).
  if (!secret) {
    warnWebhookSecretOnce();
    return res.status(503).json({ message: 'Webhook non sécurisé : TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET manquant. Configurez le secret et déclarez-le via setWebhook (secret_token).' });
  }
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).json({ message: 'Secret du webhook invalide.' });

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    // Idempotence : Telegram peut rejouer une update — on ne la traite qu'une seule fois.
    const updateId = Number(update.update_id);
    if (Number.isFinite(updateId) && updateId > 0) {
      const isNew = await markUpdateProcessed(updateId);
      if (!isNew) return res.status(200).json({ ok: true, duplicate: true });
      if (updateId % 100 === 0) await pruneWebhookUpdates(); // nettoyage périodique, sans état séparé
    }
    const message = update.message;
    // Les publications modifiées (edited_channel_post) suivent le même chemin : l'upsert par id
    // (chatId_messageId) met à jour le post existant dans Neon — les éditions se propagent à l'app.
    const channelPost = update.channel_post || update.edited_channel_post;

    if (update.pre_checkout_query) {
      const query = update.pre_checkout_query;
      const ok = query.currency === 'XTR' && Number(query.total_amount) > 0;
      await telegram(token, 'answerPreCheckoutQuery', { pre_checkout_query_id: query.id, ok, ...(ok ? {} : { error_message: 'Cette facture n’est plus disponible.' }) });
    }

    if (message?.successful_payment) {
      const payment = message.successful_payment;
      await upsertPayment({
        id: payment.telegram_payment_charge_id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
        telegramProviderChargeId: payment.provider_payment_charge_id || null,
        userId: message.from?.id || null,
        username: message.from?.username || null,
        amount: payment.total_amount,
        currency: payment.currency,
        payload: payment.invoice_payload,
        paidAt: new Date(),
      });
      await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: `Merci beaucoup ⭐\n\nVotre soutien de ${payment.total_amount} Étoiles à Pesce a bien été reçu. Votre geste contribue directement à son travail journalistique.` });
      await notifyCreator(token, `Nouveau soutien ⭐\n${payment.total_amount} Étoiles reçues.`);
    }

    if (message?.text && message.from?.id) {
      const command = message.text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
      const userId = message.from.id;

      if (command === '/start') {
        await deleteSupportSession(userId);
        await telegram(token, 'sendMessage', {
          chat_id: message.chat.id,
          text: 'Bienvenue dans Pesce Studio ⭐\n\nRetrouvez les publications, vidéos, audios et contenus de Pesce Hounyo, et soutenez directement son travail journalistique.',
          reply_markup: { inline_keyboard: [[{ text: 'Ouvrir Pesce Studio', web_app: { url: MINI_APP_URL } }]] },
        });
      } else if (command === '/id') {
        await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: `Votre identifiant Telegram est : ${userId}` });
      } else if (command === '/studio') {
        // Commande discrète : l'espace studio n'est pas une affordance publique. Seule la créatrice reçoit le lien.
        if (userId && isCreatorTelegramUser(userId)) {
          await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: `Studio Pesce 🎛\n\nOuvrez votre espace créatrice ici :\n${STUDIO_URL}` });
        }
      } else if (command === '/paysupport' || command === '/support') {
        await setSupportSession(userId, { status: 'awaiting_message', chatId: message.chat.id });
        await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: 'Support Pesce Studio\n\nDécrivez votre problème dans votre prochain message. Pour un paiement, indiquez si possible la date et le montant en Étoiles.\n\nEnvoyez /cancel pour annuler.' });
      } else if (command === '/cancel') {
        await deleteSupportSession(userId);
        await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: 'Votre demande de support a été annulée.' });
      } else {
        const session = await getSupportSession(userId);
        if (session?.status === 'awaiting_message') {
          const ticketId = newTicketId();
          await createSupportTicket({
            id: ticketId,
            chatId: message.chat.id,
            userId: String(userId || ''),
            username: message.from?.username || null,
            firstName: message.from?.first_name || null,
            message: message.text.trim().slice(0, 4000),
            status: 'open',
            source: 'telegram',
          });
          await deleteSupportSession(userId);
          await telegram(token, 'sendMessage', { chat_id: message.chat.id, text: `Votre demande ${ticketId} a bien été enregistrée. Nous vous répondrons ici dès que possible.` });
          await notifyCreator(token, `Nouvelle demande de support 🛟\nTicket: ${ticketId}\nUtilisateur: ${message.from?.username ? '@' + message.from.username : message.from?.first_name || userId}`);
        }
      }
    }

    if (channelPost) {
      const post = normalize(channelPost);
      await upsertChannelPost(post);
      try {
        await telegram(token, 'editMessageReplyMarkup', { chat_id: channelPost.chat?.id || `@${CHANNEL_USERNAME}`, message_id: channelPost.message_id, reply_markup: supportMarkup() });
      } catch (error) {
        console.error('support button attachment failed', error);
      }
      console.log(JSON.stringify({ event: 'channel_post_received', ...post }));
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erreur du webhook Telegram de Pesce Studio.' });
  }
}

function normalize(message) {
  const mediaInfo = media(message);
  const type = mediaInfo?.contentType || (message.text ? 'text' : 'other');
  const id = message.message_id;
  return {
    id: `${message.chat?.id || 'channel'}_${id}`,
    source: 'telegram',
    channelId: message.chat?.id ?? null,
    channelUsername: message.chat?.username || CHANNEL_USERNAME,
    messageId: id,
    contentType: type,
    text: message.text || message.caption || '',
    telegramUrl: message.chat?.username ? `https://t.me/${message.chat.username}/${id}` : null,
    mediaFileId: mediaInfo?.fileId || null,
    mediaMimeType: mediaInfo?.mimeType || null,
    mediaFileName: mediaInfo?.fileName || null,
    mediaDuration: mediaInfo?.duration || null,
    mediaWidth: mediaInfo?.width || null,
    mediaHeight: mediaInfo?.height || null,
    mediaThumbnailFileId: mediaInfo?.thumbnailFileId || null,
    published: true,
    publishedAt: new Date((message.date || Math.floor(Date.now() / 1000)) * 1000),
    receivedAt: new Date(),
  };
}

function media(message) {
  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    return { contentType: 'photo', fileId: photo.file_id, width: photo.width, height: photo.height, mimeType: 'image/jpeg' };
  }
  if (message.audio) return { contentType: 'audio', fileId: message.audio.file_id, duration: message.audio.duration, mimeType: message.audio.mime_type || 'audio/mpeg', fileName: message.audio.file_name || null };
  if (message.voice) return { contentType: 'audio', fileId: message.voice.file_id, duration: message.voice.duration, mimeType: message.voice.mime_type || 'audio/ogg' };
  if (message.video) return { contentType: 'video', fileId: message.video.file_id, duration: message.video.duration, width: message.video.width, height: message.video.height, mimeType: message.video.mime_type || 'video/mp4', thumbnailFileId: message.video.thumbnail?.file_id || null };
  if (message.document) return { contentType: 'document', fileId: message.document.file_id, mimeType: message.document.mime_type || null, fileName: message.document.file_name || null };
  return null;
}

function supportMarkup() {
  return { inline_keyboard: [[{ text: '⭐ Soutenir le travail de Pesce', url: SUPPORT_URL }]] };
}

// Exportés pour les tests (tests/webhook-helpers.test.mjs) : fonctions pures, sans effet de bord.
export { media, normalize, supportMarkup };

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
