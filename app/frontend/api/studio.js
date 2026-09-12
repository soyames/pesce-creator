// Studio créatrice (privé). Toute action exige UNE des deux preuves d'identité côté serveur :
//   - une initData Telegram valide ET l'identifiant créatrice configuré (Mini App Telegram), ou
//   - une session web valide (cookie HttpOnly → Neon) issue de la connexion Google /studio,
//     réservée aux adresses PESCE_WEB_ADMIN_EMAILS.
//
// MODÈLE DE PUBLICATION (règle produit définitive) :
//   Studio → publication canonique dans Neon (immédiate, publiée) → Mini App la sert.
//   La diffusion Telegram est SECONDAIRE (distribution) : un échec de diffusion n'efface jamais
//   la publication canonique ; il est enregistré (distribution_error) et relançable depuis Écrits.
//   La persistance canonique précède TOUJOURS l'envoi Telegram : aucune dépendance au webhook,
//   à la synchronisation ou à la réouverture du Studio pour qu'une publication devienne publique.
//   Clé d'idempotence (publish_key) : une reprise après échec retrouve la même publication —
//   aucun doublon Telegraph ni Telegram.
import { attachTelegramDistribution, createDraft, createLiveSchedule, deleteDraft, findPostByMessageId, findPostByPublishKey, getPayment, getPostById, getStudioOverview, getSupportTicket, LIVE_STATUSES, listChannelPosts, listSupportTickets, markPaymentRefunded, mergeIntoExistingArticle, recallPost, updateLiveSchedule, updatePost, updateSupportTicket, upsertChannelPost } from '../lib/db.js';
import { backfillTelegraphArticles } from '../lib/article-backfill.js';
import { syncChannelOnce } from '../lib/channel-sync.js';
import { getChannelBroadcastStats, getChannelLiveState, getChannelRtmp } from '../lib/mtproto.js';
import { creatorTelegramUserIds, isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';
import { newDraftId, newLiveId } from '../lib/tickets.js';
import { signMedia, verifyMediaToken } from '../lib/media-token.js';
import { articleCoverFromPage, articleExcerptFromPage, createTelegraphAccount, createTelegraphPage, detectImageFormat, getTelegraphPage, MAX_TELEGRAPH_IMAGE_BYTES, nodesFromArticle, nodesFromPlainText, normalizeTelegraphImage, uploadTelegraphImage, validateArticleImages } from '../lib/telegraph.js';
import { webSessionEmailFromRequest } from '../lib/web-session.js';
import { isWebAdminEmail } from '../lib/google-auth.js';
import { normalizeYouTubeUrl } from '../lib/youtube.js';
import { CHANNEL_HANDLE, CHANNEL_USERNAME, CREATOR_NAME, MINI_APP_URL, SUPPORT_URL } from '../lib/config.js';

// Audio enregistré/importer depuis le navigateur : limite du corps JSON serverless (~4,5 Mo),
// soit ~3,3 Mo de données audio — plusieurs minutes de note vocale en Opus.
const MAX_STUDIO_AUDIO_BYTES = 3 * 1024 * 1024;

// Couvertures d'article hébergées par Pesce Studio (repli Telegram) : jeton média signé
// longue durée (1 an) — la couverture doit rester visible bien après sa publication.
const COVER_MEDIA_TTL_SECONDS = 365 * 24 * 3600;

function mediaSecret() {
  return process.env.PESCE_MEDIA_SIGNING_SECRET || process.env.TELEGRAM_PESCE_BOT_TOKEN;
}

// Source d'image d'article acceptée : chemin Telegraph natif (/file/… ou URL telegra.ph) OU
// URL signée de notre propre proxy média (/api/media) — liste blanche stricte, rien d'autre.
export function allowedArticleImageSrc(src, { secret = null, miniAppUrl = MINI_APP_URL } = {}) {
  const telegraph = normalizeTelegraphImage(src);
  if (telegraph) return telegraph;
  try {
    const url = new URL(String(src || ''));
    const appUrl = new URL(miniAppUrl);
    if (url.origin !== appUrl.origin || url.pathname !== '/api/media') return null;
    const fileId = url.searchParams.get('file_id') || '';
    const token = url.searchParams.get('token') || '';
    if (!fileId || !verifyMediaToken(fileId, token, { secret: secret || '' })) return null;
    return url.toString();
  } catch { return null; }
}

// Repli d'hébergement de couverture : l'endpoint non officiel telegra.ph/upload peut être
// indisponible (refus 400 « Unknown error »). La photo est alors hébergée par Telegram via le
// bot, dans la discussion privée de la créatrice — aucun binaire dans Neon, référence signée
// seulement. Renvoie { src, url, hosting, fileId }.
async function hostCoverOnTelegram(token, buffer) {
  const chatId = creatorTelegramUserIds()[0];
  if (!token || !chatId) {
    throw Object.assign(new Error('Aucun destinataire privé disponible pour héberger la couverture.'), { code: 'telegram_host' });
  }
  const format = detectImageFormat(buffer);
  if (!format) throw Object.assign(new Error('Format de couverture invalide.'), { code: 'telegram_host' });
  const extension = { jpeg: 'jpg', png: 'png', gif: 'gif' }[format];
  const mime = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' }[format];
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([buffer], { type: mime }), `pesce-couverture-${Date.now()}.${extension}`);
  form.append('caption', 'Couverture d’article Pesce Studio (hébergement privé).');
  const sent = await telegramMultipart('sendPhoto', form);
  const fileId = sent?.result?.photo?.slice(-1)[0]?.file_id;
  if (!fileId) throw Object.assign(new Error('Telegram n’a pas confirmé l’hébergement de la couverture.'), { code: 'telegram_host' });
  const secret = mediaSecret();
  if (!secret) throw Object.assign(new Error('Secret de signature média manquant.'), { code: 'telegram_host' });
  const mediaToken = signMedia(fileId, { secret, ttlSeconds: COVER_MEDIA_TTL_SECONDS });
  const url = new URL('./api/media', MINI_APP_URL);
  url.searchParams.set('file_id', fileId);
  url.searchParams.set('token', mediaToken);
  return { src: url.toString(), url: url.toString(), hosting: 'telegram', fileId };
}

// Identifiant stable d'une publication canonique créée dans le Studio (l'identité Telegram
// chat_id_message_id lui est attachée après distribution, sans changer d'identifiant canonique).
function newStudioPostId() {
  return `studio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Clé d'idempotence de publication : fournie par le client (conservée entre tentatives) ou
// dérivée du brouillon repris — une reprise retrouve la publication existante au lieu d'en
// créer une seconde (jamais de doublon Telegraph/Telegram).
export function publishKeyOf(body, draftId) {
  const provided = typeof body.publishKey === 'string' ? body.publishKey.trim().slice(0, 120) : '';
  if (provided) return provided;
  return draftId ? `draft:${draftId}` : null;
}

export default async function handler(req, res) {
  // Le jeton du bot est nécessaire aux actions de publication/diffusion, quel que soit le flux
  // d'authentification. Le flux web reste utilisable sans jeton (lecture seule + état).
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
      // Filets de sécurité (idempotents, non bloquants) : le pipeline normal n'en dépend jamais.
      // 1) Articles Telegraph publiés référencés même si le webhook n'a pas été reçu.
      try { await backfillTelegraphArticles({ channelUsername: CHANNEL_USERNAME }); } catch (error) { console.error('telegraph backfill failed', error); }
      // 2) Réconciliation du canal : les messages TÉLÉGRAM-ORIGINÉS supprimés quittent l'état
      //    actif ; les publications Studio restent (Telegram = distribution). Sécurisée : un
      //    échec de lecture ne modifie RIEN.
      try { await syncChannelOnce({ telegram: token ? (method, payload) => telegram(token, method, payload) : null }); } catch (error) { console.error('channel sync failed', error); }
      return res.status(200).json({ ...serialize(overview), telegraphConfigured: Boolean(process.env.TELEGRAPH_ACCESS_TOKEN) });
    }
    if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const action = String(body.action || '').trim();

    // — Cycle de vie PUBLICATION (règle produit) : la persistance canonique Neon PRÉCÈDE la
    // distribution Telegram. Une erreur de persistance signifie « rien n'a été publié » (reprise
    // sûre) ; une erreur de distribution signifie « publié, diffusion en attente » (relançable).
    async function persistCanonicalPost({ publishKey, contentType = 'text', text, articleUrl = null, articleImageUrl = null }) {
      if (publishKey) {
        const existing = await findPostByPublishKey(publishKey);
        if (existing) return existing; // reprise idempotente : la publication existe déjà
      }
      const id = newStudioPostId();
      await upsertChannelPost({
        id,
        source: 'studio',
        origin: 'studio',
        publishKey: publishKey || null,
        channelUsername: CHANNEL_USERNAME,
        contentType,
        text,
        articleUrl,
        articleImageUrl,
        published: true,
        publishedAt: new Date(),
        receivedAt: new Date(),
      });
      return getPostById(id);
    }

    // Diffusion Telegram : secondaire. Identité attachée à la ligne canonique (même message,
    // une seule publication) ; un échec est enregistré et n'efface rien.
    async function distributePost(canonical, { text }) {
      if (canonical.messageId) {
        // Déjà distribuée (ou le webhook a déjà porté l'identité) : jamais de second envoi.
        await updatePost(canonical.id, { distributionError: null }).catch(() => {});
        return { distributed: true, postId: canonical.id, messageId: Number(canonical.messageId) };
      }
      try {
        const sent = await telegram(token, 'sendMessage', { chat_id: CHANNEL_HANDLE, text, disable_web_page_preview: false, reply_markup: supportMarkup() });
        const messageId = Number(sent?.result?.message_id);
        const chatId = Number(sent?.result?.chat?.id);
        if (!messageId || !chatId) throw new Error('Réponse Telegram incomplète.');
        const postId = await attachTelegramDistribution(canonical.id, {
          chatId,
          messageId,
          telegramUrl: `https://t.me/${CHANNEL_USERNAME}/${messageId}`,
          distributedAt: new Date(),
        });
        await updatePost(postId, { distributionError: null });
        return { distributed: true, postId, messageId };
      } catch (error) {
        console.error('telegram distribution failed', canonical.id, error.message);
        const message = 'La publication est enregistrée dans Pesce Studio, mais la diffusion Telegram a échoué. Vous pouvez la relancer depuis « Écrits » sans créer de doublon.';
        await updatePost(canonical.id, { distributionError: message }).catch(() => {});
        return { distributed: false, postId: canonical.id, distributionError: message };
      }
    }

    // — Publication texte simple (dépêche).
    if (action === 'publish') {
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!text) return res.status(400).json({ message: 'Le texte de la publication est vide.' });
      const draftId = String(body.draftId || '') || null;
      const publishKey = publishKeyOf(body, draftId);
      let canonical;
      try {
        canonical = await persistCanonicalPost({ publishKey, contentType: 'text', text });
      } catch (error) {
        console.error('canonical persist failed', error);
        return res.status(502).json({ message: 'Impossible d’enregistrer la publication pour le moment. Rien n’a été publié — réessayez.' });
      }
      if (draftId) await deleteDraft(draftId).catch((error) => console.error('draft removal failed', draftId, error.message));
      const distribution = await distributePost(canonical, { text });
      return res.status(200).json({
        ok: true, published: true, postId: distribution.postId,
        distributed: distribution.distributed,
        ...(distribution.messageId ? { messageId: distribution.messageId } : {}),
        draftRemoved: Boolean(draftId),
        ...(distribution.distributionError ? { distributionError: distribution.distributionError } : {}),
      });
    }

    // — Article Telegraph (couverture obligatoire, hébergement Telegraph).
    if (action === 'article_publish') {
      const title = String(body.title || '').trim().slice(0, 256);
      const text = String(body.text || '').trim().slice(0, 4096);
      if (!title || !text) return res.status(400).json({ message: 'Le titre et le texte sont requis pour un article.' });
      // Sources d'image acceptées : chemins Telegraph natifs OU références signées de notre
      // propre proxy média (couvertures hébergées par Telegram en repli). Rien d'autre.
      const imageNormalizer = (src) => allowedArticleImageSrc(src, { secret: mediaSecret() });
      const images = validateArticleImages(body.images, { normalize: imageNormalizer });
      if (Array.isArray(body.images) && body.images.length > 0 && images.length === 0) {
        return res.status(400).json({ message: 'Images d’article invalides : seuls les chemins Telegraph (/file/…) et les images hébergées par Pesce Studio sont acceptés.' });
      }
      // Règle éditoriale : tout article publié a une image de couverture (hébergée par Telegraph).
      const cover = images.find((image) => image.placement === 'cover');
      if (!cover) {
        return res.status(400).json({ message: 'Une image de couverture est requise pour publier un article — ajoutez un média dans le pupitre (le Studio web le permet).' });
      }
      const draftId = String(body.draftId || '') || null;
      const publishKey = publishKeyOf(body, draftId);
      let canonical = publishKey ? await findPostByPublishKey(publishKey) : null;
      if (!canonical) {
        const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
        if (!accessToken) return res.status(503).json({ message: 'Telegraph n’est pas encore configuré. Utilisez « Configurer Telegraph » dans le studio, puis enregistrez le jeton dans TELEGRAPH_ACCESS_TOKEN.' });
        let page;
        try {
          page = await createTelegraphPage({ accessToken, title, content: nodesFromArticle({ text, images, normalize: imageNormalizer }), authorName: CREATOR_NAME });
        } catch (error) {
          console.error('telegraph page creation failed', error.message);
          return res.status(502).json({ message: 'Impossible de créer l’article Telegraph pour le moment. L’article n’a pas été publié — réessayez dans un instant.' });
        }
        if (!page?.url || !page?.path) {
          console.error('telegraph page creation returned no url', page);
          return res.status(502).json({ message: 'Telegraph n’a pas confirmé la création de l’article. L’article n’a pas été publié.' });
        }
        // Vérification : la page créée contient bien la figure de couverture — jamais de
        // publication d'article sans couverture, même si l'upload a réussi plus tôt.
        let pageCover = null;
        try {
          const pageWithContent = await getTelegraphPage({ accessToken, path: page.path });
          // La couverture peut être un chemin /file/ natif OU notre URL signée exacte.
          pageCover = articleCoverFromPage(pageWithContent, { allowedSrc: cover.src });
        } catch (error) {
          console.error('telegraph page verification failed', page.path, error.message);
        }
        if (!pageCover) {
          console.error('telegraph page created without cover figure', page.url);
          return res.status(502).json({ message: 'L’article a été créé sur Telegraph sans image de couverture. L’article n’a pas été publié — ajoutez une image et réessayez.' });
        }
        try {
          canonical = await persistCanonicalPost({
            publishKey,
            contentType: 'text',
            text: `${title}\n\n${page.url}`,
            articleUrl: page.url,
            articleImageUrl: cover.src,
          });
        } catch (error) {
          console.error('canonical persist failed', error);
          return res.status(502).json({ message: 'Impossible d’enregistrer l’article pour le moment. L’article n’a pas été publié — réessayez (aucun doublon ne sera créé).' });
        }
      }
      if (draftId) await deleteDraft(draftId).catch((error) => console.error('draft removal failed', draftId, error.message));
      const distribution = await distributePost(canonical, { text: `${title}\n\n${canonical.articleUrl || ''}` });
      return res.status(200).json({
        ok: true, published: true, postId: distribution.postId,
        distributed: distribution.distributed,
        ...(distribution.messageId ? { messageId: distribution.messageId } : {}),
        draftRemoved: Boolean(draftId),
        ...(distribution.distributionError ? { distributionError: distribution.distributionError } : {}),
      });
    }

    // — Régie des directs : contrôle RTMP via MTProto (utilisateur autorisé uniquement).
    // La clé de stream est un secret : elle ne sort JAMAIS de cette route authentifiée.
    if (action === 'live_rtmp') {
      const liveId = String(body.liveId || '').trim();
      if (!liveId) return res.status(400).json({ message: 'Direct manquant.' });
      try {
        const rtmp = await getChannelRtmp({ channelUsername: CHANNEL_USERNAME });
        if (!rtmp?.url || !rtmp?.key) return res.status(503).json({ message: 'Telegram n’a pas fourni de flux RTMP pour ce direct.' });
        return res.status(200).json({ ok: true, url: rtmp.url, key: rtmp.key });
      } catch (error) {
        console.error('live rtmp failed', error.message);
        return res.status(503).json({ message: mtProtoEditorialError(error) });
      }
    }

    // — Statistiques Telegram (MTProto, où Telegram les autorise) : jamais de chiffres inventés.
    if (action === 'telegram_stats') {
      try {
        const stats = await getChannelBroadcastStats({ channelUsername: CHANNEL_USERNAME });
        const counters = stats?.counters || {};
        return res.status(200).json({
          ok: true,
          followers: counters.followers || 0,
          views: counters.views || 0,
          shares: counters.shares || 0,
          reactions: counters.reactions || 0,
          notifications: counters.notifications || 0,
        });
      } catch (error) {
        console.error('telegram stats failed', error.message);
        return res.status(503).json({ message: mtProtoEditorialError(error) });
      }
    }

    // — Synchronisation d'état avec l'appel Telegram réel (MTProto) : autoritaire quand configuré.
    if (action === 'live_status_sync') {
      const liveId = String(body.liveId || '').trim();
      if (!liveId) return res.status(400).json({ message: 'Direct manquant.' });
      try {
        const state = await getChannelLiveState({ channelUsername: CHANNEL_USERNAME });
        if (!state) return res.status(200).json({ ok: true, live: false, message: 'Aucun appel de groupe actif connu.' });
        if (state.active) await updateLiveSchedule(liveId, { status: 'live' });
        return res.status(200).json({ ok: true, live: state.active, title: state.title });
      } catch (error) {
        console.error('live status sync failed', error.message);
        return res.status(503).json({ message: mtProtoEditorialError(error) });
      }
    }

    // Réconciliation explicite avec le canal : mêmes règles que la synchronisation automatique —
    // seules les publications TÉLÉGRAM-ORIGINÉES disparues du canal quittent l'état actif ; les
    // publications Studio restent. Un échec de lecture ne modifie jamais rien.
    if (action === 'reconcile_channel') {
      try {
        const result = await syncChannelOnce({ telegram: (method, payload) => telegram(token, method, payload), force: true });
        if (result.skipped && result.reason === 'empty') {
          return res.status(200).json({ ok: true, fetched: 0, removed: 0, ingested: 0, message: 'Aperçu vide — aucune modification (règle de sécurité).' });
        }
        return res.status(200).json({ ok: true, fetched: result.fetched, removed: result.removed, ingested: result.ingested });
      } catch (error) {
        console.error('channel reconcile failed', error);
        return res.status(502).json({ message: 'Réconciliation impossible : lecture du canal échouée — aucune modification appliquée.' });
      }
    }

    // Ressynchronisation d'un article déjà publié sur le canal (posté avant la synchronisation
    // des métadonnées) : récupère la page Telegraph et met à jour Neon par le mécanisme normal.
    if (action === 'resync_message') {
      const messageId = Number(body.messageId);
      if (!messageId) return res.status(400).json({ message: 'Identifiant du message requis.' });
      const path = (String(body.telegraphUrl || '').match(/telegra\.ph\/([\w\-./]+)/i) || [])[1] || '';
      if (!path) return res.status(400).json({ message: 'Lien Telegraph de l’article requis.' });
      // Lecture publique de la page (sans jeton) : la resynchronisation fonctionne même si le
      // compte Telegraph propriétaire ne correspond plus au jeton configuré.
      const page = await getTelegraphPage({ accessToken: process.env.TELEGRAPH_ACCESS_TOKEN, path });
      if (!page?.title) return res.status(404).json({ message: 'Article Telegraph introuvable.' });
      const chat = await telegram(token, 'getChat', { chat_id: CHANNEL_HANDLE });
      const chatId = Number(chat.result?.id);
      if (!chatId) return res.status(502).json({ message: 'Canal Telegram introuvable.' });
      const cover = articleCoverFromPage(page);
      const post = {
        id: `${chatId}_${messageId}`,
        source: 'studio',
        origin: 'studio',
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
      };
      // Même déduplication que le webhook : si l'article est déjà référencé (backfill ou autre
      // message), on complète la référence canonique au lieu de créer une seconde publication.
      const mergedId = await mergeIntoExistingArticle(post);
      if (!mergedId) await upsertChannelPost(post);
      return res.status(200).json({ ok: true, cover, id: mergedId || post.id });
    }

    // Image neuve → hébergée par Telegraph (stockage natif des articles) avec REPLI automatique
    // vers l'hébergement Telegram (photo envoyée par le bot à la créatrice, référence signée) :
    // l'endpoint non officiel telegra.ph/upload peut être indisponible sans préavis. Un échec des
    // DEUX hébergeurs renvoie un message éditorial français ; les détails techniques restent dans
    // les journaux serveur. Aucun article n'est publié tant que la couverture n'est pas hébergée.
    if (action === 'article_image_upload') {
      const data = String(body.data || '');
      const match = data.match(/^data:image\/(jpe?g|png|gif|webp);base64,(.+)$/i);
      if (!match) return res.status(400).json({ message: 'Image encodée invalide : choisissez une image JPEG, PNG ou GIF.' });
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length === 0 || buffer.length > MAX_TELEGRAPH_IMAGE_BYTES) {
        return res.status(400).json({ message: 'Image trop volumineuse (3 Mo maximum).' });
      }
      // Format réel (signature magique) vérifié avant tout hébergeur : un webp/heic refusé
      // ici évite un échec incompréhensible plus loin.
      if (!detectImageFormat(buffer)) {
        return res.status(400).json({ message: 'Ce format d’image n’est pas accepté : utilisez une image JPEG, PNG ou GIF. L’article n’a pas été publié.' });
      }
      const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
      if (accessToken) {
        try {
          const uploaded = await uploadTelegraphImage({ accessToken, buffer });
          return res.status(200).json({ ok: true, hosting: 'telegraph', ...uploaded });
        } catch (error) {
          console.error('telegraph image upload failed — repli hébergement Telegram', error.code || error.message);
        }
      }
      try {
        const hosted = await hostCoverOnTelegram(token, buffer);
        return res.status(200).json({ ok: true, ...hosted });
      } catch (error) {
        console.error('cover hosting failed (telegraph + telegram)', error.code || error.message);
        return res.status(502).json({ message: editorialImageUploadError(error) });
      }
    }

    // Photo existante du canal : elle est DÉJÀ hébergée par Telegram (file_id dans Neon) —
    // référence signée longue durée, aucun re-téléversement, aucune dépendance à Telegraph.
    if (action === 'article_image_from_channel') {
      const fileId = String(body.fileId || '').trim().slice(0, 512);
      if (!fileId) return res.status(400).json({ message: 'Photo du canal manquante.' });
      try {
        const secret = mediaSecret();
        if (!secret) return res.status(503).json({ message: 'Hébergement des images indisponible pour le moment : le secret de signature média est manquant.' });
        const mediaToken = signMedia(fileId, { secret, ttlSeconds: COVER_MEDIA_TTL_SECONDS });
        const url = new URL('./api/media', MINI_APP_URL);
        url.searchParams.set('file_id', fileId);
        url.searchParams.set('token', mediaToken);
        return res.status(200).json({ ok: true, src: url.toString(), url: url.toString(), hosting: 'telegram', fileId });
      } catch (error) {
        console.error('article image from channel failed', error.message);
        return res.status(502).json({ message: 'Impossible de référencer la photo du canal pour le moment. L’article n’a pas été publié.' });
      }
    }

    // — Vidéo : YouTube reste l'hébergeur (V1). Le studio publie la référence canonique d'abord,
    // puis diffuse la dépêche sur le canal — la carte vidéo du Mini App ne dépend que de Neon.
    if (action === 'video_publish') {
      const title = String(body.title || '').trim().slice(0, 256);
      const description = String(body.description || '').trim().slice(0, 4000);
      const youtubeUrl = normalizeYouTubeUrl(body.youtubeUrl);
      if (!title || !youtubeUrl) return res.status(400).json({ message: 'Le titre et un lien YouTube valide sont requis.' });
      const text = [title, description, youtubeUrl].filter(Boolean).join('\n\n');
      const draftId = String(body.draftId || '') || null;
      const publishKey = publishKeyOf(body, draftId);
      let canonical;
      try {
        canonical = await persistCanonicalPost({ publishKey, contentType: 'video', text });
      } catch (error) {
        console.error('canonical persist failed', error);
        return res.status(502).json({ message: 'Impossible d’enregistrer la vidéo pour le moment. Rien n’a été publié — réessayez.' });
      }
      if (draftId) await deleteDraft(draftId).catch((error) => console.error('draft removal failed', draftId, error.message));
      const distribution = await distributePost(canonical, { text });
      return res.status(200).json({
        ok: true, published: true, postId: distribution.postId,
        distributed: distribution.distributed,
        ...(distribution.messageId ? { messageId: distribution.messageId } : {}),
        draftRemoved: Boolean(draftId),
        ...(distribution.distributionError ? { distributionError: distribution.distributionError } : {}),
      });
    }

    // Modification d'une vidéo déjà publiée : le texte canonique Neon est mis à jour directement
    // (aucune dépendance au webhook), puis la copie Telegram est éditée. Idempotent : une reprise
    // re-édite le même texte.
    if (action === 'video_update') {
      const title = String(body.title || '').trim().slice(0, 256);
      const description = String(body.description || '').trim().slice(0, 4000);
      const youtubeUrl = normalizeYouTubeUrl(body.youtubeUrl);
      if (!title || !youtubeUrl) return res.status(400).json({ message: 'Le titre et un lien YouTube valide sont requis.' });
      const messageId = Number(body.messageId);
      if (!messageId) return res.status(400).json({ message: 'Publication d’origine manquante.' });
      const text = [title, description, youtubeUrl].filter(Boolean).join('\n\n');
      try {
        await telegram(token, 'editMessageText', { chat_id: CHANNEL_HANDLE, message_id: messageId, text, disable_web_page_preview: false });
      } catch (error) {
        console.error('video edit on telegram failed', messageId, error.message);
        return res.status(502).json({ message: 'Impossible de mettre à jour la copie Telegram de la vidéo pour le moment. Aucune modification n’a été enregistrée — réessayez.' });
      }
      const canonical = await findPostByMessageId(messageId);
      if (canonical) await updatePost(canonical.id, { text }).catch((error) => console.error('video canonical update failed', error.message));
      return res.status(200).json({ ok: true });
    }

    // — Audio : le fichier est hébergé par Telegram (canon du média), Neon ne garde que la
    // référence. La référence canonique est écrite AVANT l'envoi du fichier (clé d'idempotence) ;
    // si l'envoi échoue, la référence reste, le brouillon est conservé et la reprise (même clé)
    // renvoie le fichier sans jamais créer de seconde référence.
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
      const caption = [title, description, author ? `— ${author}` : ''].filter(Boolean).join('\n\n');
      const draftId = String(body.draftId || '') || null;
      const publishKey = publishKeyOf(body, draftId);
      let canonical = publishKey ? await findPostByPublishKey(publishKey) : null;
      if (!canonical) {
        try {
          canonical = await persistCanonicalPost({ publishKey, contentType: 'audio', text: caption });
        } catch (error) {
          console.error('canonical persist failed', error);
          return res.status(502).json({ message: 'Impossible d’enregistrer l’audio pour le moment. Rien n’a été publié — réessayez.' });
        }
      }
      if (canonical.messageId) {
        // Déjà hébergé et distribué (reprise après une réponse perdue) : aucun nouvel envoi.
        if (draftId) await deleteDraft(draftId).catch(() => {});
        return res.status(200).json({ ok: true, published: true, postId: canonical.id, distributed: true, draftRemoved: Boolean(draftId) });
      }
      let sent;
      try {
        const form = new FormData();
        form.append('chat_id', CHANNEL_HANDLE);
        form.append('document', new Blob([buffer], { type: `audio/${mimeType}` }), `pesce-audio-${Date.now()}.${extension}`);
        form.append('caption', caption);
        form.append('reply_markup', JSON.stringify(supportMarkup()));
        sent = await telegramMultipart('sendDocument', form);
      } catch (error) {
        console.error('audio telegram send failed', canonical.id, error.message);
        const message = 'L’audio n’a pas pu être envoyé sur Telegram (son hébergeur). La référence a été enregistrée et le brouillon est conservé — réessayez (aucun doublon ne sera créé).';
        await updatePost(canonical.id, { distributionError: message }).catch(() => {});
        return res.status(502).json({ ok: false, published: true, postId: canonical.id, distributed: false, draftRemoved: false, message });
      }
      const messageId = Number(sent?.result?.message_id);
      const chatId = Number(sent?.result?.chat?.id);
      if (!messageId || !chatId) {
        console.error('audio telegram response incomplete', canonical.id);
        const message = 'Telegram n’a pas confirmé l’hébergement de l’audio. Le brouillon est conservé — réessayez (aucun doublon ne sera créé).';
        await updatePost(canonical.id, { distributionError: message }).catch(() => {});
        return res.status(502).json({ ok: false, published: true, postId: canonical.id, distributed: false, draftRemoved: false, message });
      }
      const document = sent?.result?.document || {};
      const postId = await attachTelegramDistribution(canonical.id, {
        chatId,
        messageId,
        telegramUrl: `https://t.me/${CHANNEL_USERNAME}/${messageId}`,
        distributedAt: new Date(),
        mediaFields: {
          mediaFileId: document.file_id || null,
          mediaMimeType: document.mime_type || `audio/${mimeType}`,
          mediaFileName: document.file_name || null,
          mediaDuration: document.duration || null,
        },
      });
      await updatePost(postId, { distributionError: null }).catch(() => {});
      if (draftId) await deleteDraft(draftId).catch((error) => console.error('draft removal failed', draftId, error.message));
      return res.status(200).json({ ok: true, published: true, postId, distributed: true, messageId, draftRemoved: Boolean(draftId) });
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

    // Relance de la diffusion Telegram d'une publication déjà canonique (échec de distribution
    // précédent) : même message, même ligne — jamais de doublon.
    if (action === 'distribute_post') {
      const postId = String(body.postId || '').trim();
      if (!postId) return res.status(400).json({ message: 'Publication manquante.' });
      const post = await getPostById(postId);
      if (!post) return res.status(404).json({ message: 'Publication introuvable.' });
      if (!['text', 'video', 'document', 'other'].includes(post.contentType)) {
        return res.status(400).json({ message: 'Seules les publications texte et vidéo peuvent être rediffusées depuis le studio.' });
      }
      const text = String(post.text || '').trim();
      if (!text) return res.status(400).json({ message: 'Le texte de la publication est vide.' });
      const distribution = await distributePost(post, { text });
      return res.status(200).json({
        ok: true,
        distributed: distribution.distributed,
        postId: distribution.postId,
        ...(distribution.distributionError ? { distributionError: distribution.distributionError } : {}),
      });
    }

    // Retrait (rappel) d'une publication : elle quitte immédiatement le Mini App, Écrits et les
    // compteurs (ligne conservée pour l'audit). La copie Telegram est supprimée quand l'identité
    // du message est connue (meilleur effort — le retrait de l'application ne dépend JAMAIS de
    // Telegram). Action créatrice authentifiée uniquement.
    if (action === 'recall_post') {
      const postId = String(body.postId || '').trim();
      if (!postId) return res.status(400).json({ message: 'Publication manquante.' });
      const post = await getPostById(postId);
      if (!post) return res.status(404).json({ message: 'Publication introuvable.' });
      let telegramDeleted = false;
      if (post.messageId && token) {
        try {
          await telegram(token, 'deleteMessage', { chat_id: post.channelId || CHANNEL_HANDLE, message_id: Number(post.messageId) });
          telegramDeleted = true;
        } catch (error) {
          console.error('recall telegram delete failed', post.id, error.message);
        }
      }
      await recallPost(postId);
      return res.status(200).json({ ok: true, recalled: true, telegramDeleted });
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
      const ticket = await getSupportTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: 'Ticket introuvable.' });
      await updateSupportTicket(ticketId, { status: 'resolved', resolvedAt: new Date(), resolvedBy: actorId });
      return res.status(200).json({ ok: true, status: 'resolved' });
    }

    // Réponse à un lecteur : l'envoi Telegram est la preuve, l'état Neon la trace.
    // open → replied → resolved. Si l'envoi échoue, AUCUN état n'est marqué « répondue » —
    // le ticket original est préservé et la reprise est sûre.
    if (action === 'reply') {
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!text) return res.status(400).json({ message: 'Réponse vide.' });
      const ticket = await getSupportTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: 'Ticket introuvable.' });
      if (!ticket.chatId) return res.status(400).json({ message: 'Ce ticket ne peut pas recevoir de réponse directe (discussion Telegram manquante).' });
      let sent;
      try {
        sent = await telegram(token, 'sendMessage', { chat_id: ticket.chatId, text: `Réponse de Pesce Studio\n\n${text}` });
      } catch (error) {
        console.error('support reply send failed', ticketId, error.message);
        return res.status(502).json({ message: 'La réponse n’a pas pu être envoyée dans Telegram. Aucun changement n’a été enregistré — réessayez.' });
      }
      const replyMessageId = Number(sent?.result?.message_id) || null;
      await updateSupportTicket(ticketId, {
        status: 'replied',
        lastReply: text,
        lastReplyAt: new Date(),
        lastReplyBy: actorId,
        lastReplyMessageId: replyMessageId,
        replyCount: Number(ticket.replyCount || 0) + 1,
      });
      return res.status(200).json({ ok: true, replied: true, telegramMessageId: replyMessageId });
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
    // Détails techniques dans les journaux serveur uniquement — jamais d'erreur brute côté créatrice.
    console.error(error);
    return res.status(500).json({ message: 'Le studio ne peut pas traiter cette action pour le moment. Réessayez dans un instant.' });
  }
}

// Traduction des erreurs MTProto en messages éditoriaux français — les détails techniques
// (code, classe d'API) restent dans les journaux serveur, jamais dans l'interface.
export function mtProtoEditorialError(error) {
  const raw = String(error?.message || '');
  if (/CHAT_ADMIN_REQUIRED/i.test(raw)) {
    return 'Cette opération nécessite une session MTProto d’un administrateur du canal. La session configurée n’a pas les droits d’administration sur le canal — régénérez-la avec un compte administrateur (procédure scripts/mtproto-setup.mjs), puis redéployez.';
  }
  if (/MTProto non configuré/i.test(raw)) return raw;
  return 'Telegram a refusé cette opération pour le moment. Réessayez dans un instant.';
}

// Message éditorial français pour tout échec d'image de couverture — les détails techniques
// (statut HTTP, corps de réponse) restent dans les journaux serveur.
function editorialImageUploadError(error) {
  if (error?.code === 'telegraph_format') {
    return 'Ce format d’image n’est pas accepté : utilisez une image JPEG, PNG ou GIF. L’article n’a pas été publié.';
  }
  if (error?.code === 'telegram_host') {
    return 'Impossible d’héberger l’image de couverture pour le moment (Telegraph et Telegram ont échoué). L’article n’a pas été publié — réessayez dans un instant.';
  }
  return 'Impossible d’héberger l’image de couverture pour le moment. L’article n’a pas été publié — réessayez dans un instant.';
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

// Envoi multipart (audio enregistré, etc.) — le corps est un FormData, pas du JSON.
async function telegramMultipart(method, formData) {
  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
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
