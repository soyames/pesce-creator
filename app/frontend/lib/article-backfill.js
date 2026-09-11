// Récupération des articles Telegraph publiés : réconciliation idempotente entre Telegraph
// (hébergeur des articles) et pesce_posts (métadonnées/références). Ce n'est PAS le pipeline
// normal (la publication écrit ses métadonnées immédiatement) — c'est un filet de sécurité qui
// s'exécute à la lecture de l'état de l'application (/api/studio ET /api/content), au plus une
// fois toutes les 5 minutes par instance, et ne crée jamais de doublon :
//   - identifiant stable telegraph_<path>,
//   - saut si l'article est déjà référencé par article_url.
import { findPostByArticleUrl, upsertChannelPost } from './db.js';
import { listTelegraphPages, telegraphBackfillPost } from './telegraph.js';

let lastArticleBackfill = 0;

export async function backfillTelegraphArticles({ channelUsername = null, now = Date.now } = {}) {
  const accessToken = process.env.TELEGRAPH_ACCESS_TOKEN;
  if (!accessToken) return;
  if (now() - lastArticleBackfill < 5 * 60 * 1000) return; // au plus toutes les 5 minutes par instance
  lastArticleBackfill = now();
  const pages = await listTelegraphPages(accessToken, { limit: 20 });
  for (const page of pages) {
    const post = telegraphBackfillPost(page);
    if (!post) continue;
    // Déduplication : si l'article est déjà référencé (publication normale ou webhook), on ne
    // crée pas de seconde ligne.
    if (await findPostByArticleUrl(post.articleUrl)) continue;
    post.channelUsername = channelUsername;
    await upsertChannelPost(post);
  }
}
