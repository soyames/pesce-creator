// Synchronisation du canal Telegram — UNE seule architecture de synchronisation, partagée par
// /api/studio (actions créatrice) et /api/content (lecture publique). Règles immuables :
//   1. Seules les publications TÉLÉGRAM-ORIGINÉES peuvent être marquées supprimées — les
//      publications créées dans le Studio (origin='studio') survivent à la suppression de leur
//      copie Telegram : Telegram est de la distribution, jamais la source canonique.
//   2. Un échec de lecture (ou un aperçu vide) ne modifie JAMAIS l'état existant.
//   3. Aucun doublon : déduplication par identité Telegram (chat_id + message_id) PUIS par
//      article_url PUIS par titre.
// La Bot API ne pouvant ni lister l'historique ni détecter les suppressions, le signal autoritatif
// est l'aperçu public paginé du canal (t.me/s/<canal>), borné en pages — les lignes hors fenêtre
// restent intouchées. Au plus une exécution toutes les 5 minutes par instance (force pour l'action
// manuelle « Réconcilier maintenant »).
import { findPostByArticleUrl, findPostByTelegramIdentity, listReconcilablePosts, markPostSourceDeleted, mergeIntoExistingArticle, upsertChannelPost } from './db.js';
import { articleCoverFromPage, articleExcerptFromPage, getTelegraphPage } from './telegraph.js';
import { channelMessageExists, mtProtoConfigured } from './mtproto.js';
import { CHANNEL_HANDLE, CHANNEL_USERNAME } from './config.js';
import { computeRemovedMessageIds, extractMessageIdsFromPreview, fetchChannelPreview, fetchPreviewWindow, isReconcilableSourceRow } from './channel-reconcile.js';

let lastSyncAt = 0;

// Tests uniquement : remet à zéro la limitation de fréquence.
export function resetChannelSyncThrottle() {
  lastSyncAt = 0;
}

export function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

export function telegraphLinksFromPreview(html) {
  const links = new Map(); // messageId → { path, url }
  const blocks = String(html || '').split(/data-post="/);
  for (const block of blocks.slice(1)) {
    const messageMatch = block.match(/^[^"]+\/(\d+)"/);
    if (!messageMatch) continue;
    const linkMatch = block.match(/https:\/\/telegra\.ph\/([A-Za-z0-9%-_.]+)/);
    if (!linkMatch) continue;
    const path = decodeURIComponent(linkMatch[1]);
    links.set(Number(messageMatch[1]), { path, url: `https://telegra.ph/${path}` });
  }
  return links;
}

// `telegram` : fonction (method, payload) → réponse Bot API, ou null quand l'appelant n'en a pas
// (l'ingestion est alors sautée ; la réconciliation des suppressions reste active — c'est le
// cas de /api/content, qui ne doit pas faire d'appels Telegram).
export async function syncChannelOnce({ telegram = null, force = false, now = Date.now, maxPages = 30 } = {}) {
  if (!force && now() - lastSyncAt < 5 * 60 * 1000) return { skipped: true, reason: 'throttle' };
  lastSyncAt = now();

  // Page la plus récente : ingestion des articles visibles + première fenêtre d'identifiants.
  // Échec de lecture → exception → l'appelant journalise et RIEN n'est modifié.
  // Garde d'identité : seuls les messages portant le nom du canal visé comptent — une page
  // parasite (mur de connexion, autre chaîne) équivaut à un aperçu vide : rien n'est modifié.
  const html = await fetchChannelPreview(CHANNEL_USERNAME);
  const firstPageIds = extractMessageIdsFromPreview(html, { username: CHANNEL_USERNAME });
  if (firstPageIds.length === 0) return { skipped: true, reason: 'empty' };

  const rows = (await listReconcilablePosts()).filter(isReconcilableSourceRow);
  const candidates = rows.filter((row) => Number.isFinite(Number(row.messageId)));

  // Fenêtre de couverture : si la ligne candidate la plus ancienne est antérieure à la première
  // page, on pagine l'aperçu (borné) pour couvrir les suppressions anciennes — sans cela, les
  // messages supprimés « il y a longtemps » resteraient visibles à jamais.
  const oldestCandidate = candidates.length ? Math.min(...candidates.map((row) => Number(row.messageId))) : null;
  let fetchedIds = firstPageIds;
  if (oldestCandidate !== null && oldestCandidate < Math.min(...firstPageIds)) {
    fetchedIds = await fetchPreviewWindow(CHANNEL_USERNAME, {
      startFrom: Math.min(...firstPageIds),
      untilMessageId: oldestCandidate,
      maxPages,
    });
  }

  // 1) Suppressions : messages couverts par la fenêtre ET absents de l'aperçu — jamais sur un
  // échec de lecture. Vérification autoritaire MTProto quand la session est configurée : un
  // message encore présent (ou une erreur de vérification) n'est JAMAIS marqué.
  let removed = 0;
  const useMtProto = mtProtoConfigured();
  for (const rowId of computeRemovedMessageIds(candidates, fetchedIds)) {
    const row = candidates.find((item) => item.id === rowId);
    if (useMtProto && row?.messageId) {
      try {
        const exists = await channelMessageExists({ channelUsername: CHANNEL_USERNAME, messageId: row.messageId });
        if (exists) continue;
      } catch (error) {
        console.error('mtproto existence check failed', error.message);
        continue; // règle de sécurité absolue : un échec ne supprime rien
      }
    }
    await markPostSourceDeleted(rowId);
    removed += 1;
  }

  // 2) Ingestion des articles Telegraph visibles absents de l'état (déduplication par identité
  // Telegram PUIS par article_url PUIS par titre — jamais de doublon).
  let ingested = 0;
  if (telegram) {
    const links = [...telegraphLinksFromPreview(html).entries()];
    if (links.length) {
      let chatId = null;
      try {
        const chat = await telegram('getChat', { chat_id: CHANNEL_HANDLE });
        chatId = Number(chat?.result?.id) || null;
      } catch (error) {
        console.error('channel getChat failed', error.message);
        chatId = null;
      }
      for (const [messageId, { path, url }] of links) {
        if (await findPostByArticleUrl(url)) continue;
        if (chatId && await findPostByTelegramIdentity(chatId, messageId)) continue;
        let page = null;
        try { page = await getTelegraphPage({ accessToken: process.env.TELEGRAPH_ACCESS_TOKEN, path }); } catch { page = null; }
        if (!page?.title) continue;
        const titleMatch = rows.find((row) => row.articleUrl && normalizeTitle((row.text || '').split('\n')[0]) === normalizeTitle(page.title));
        if (titleMatch) {
          await mergeIntoExistingArticle({ ...titleMatch, telegramUrl: chatId ? `https://t.me/${CHANNEL_USERNAME}/${messageId}` : null, messageId, channelId: chatId ?? null });
          continue;
        }
        if (!chatId) continue;
        await upsertChannelPost({
          id: `${chatId}_${messageId}`,
          source: 'telegram',
          origin: 'telegram',
          channelId: chatId,
          channelUsername: CHANNEL_USERNAME,
          messageId,
          contentType: 'text',
          text: `${page.title}\n\n${articleExcerptFromPage(page)}\n\n${url}`,
          telegramUrl: `https://t.me/${CHANNEL_USERNAME}/${messageId}`,
          articleUrl: url,
          articleImageUrl: articleCoverFromPage(page),
          published: true,
          publishedAt: new Date(),
          receivedAt: new Date(),
        });
        ingested += 1;
      }
    }
  }

  console.log(`channel sync: ${fetchedIds.length} messages lus, ${removed} marqués supprimés, ${ingested} articles ingérés`);
  return { skipped: false, fetched: fetchedIds.length, removed, ingested };
}
