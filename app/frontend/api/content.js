// Flux public des publications du canal (lecture seule, aucune authentification requise).
// Chaque post média reçoit une URL signée vers /api/media (jeton HMAC, 12 h).
import { listChannelPosts } from '../lib/db.js';
import { signMedia } from '../lib/media-token.js';
import { CHANNEL_URL, CHANNEL_USERNAME } from '../lib/config.js';

const CONTENT_TYPES = new Set(['text', 'photo', 'audio', 'video', 'document', 'other']);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Méthode non autorisée.' });

  try {
    const requestedType = typeof req.query?.type === 'string' ? req.query.type : undefined;
    // Type inconnu ignoré (pas d'erreur) : un ancien client ne doit jamais casser le flux.
    const type = requestedType && CONTENT_TYPES.has(requestedType) ? requestedType : undefined;
    const limit = req.query?.limit;
    const posts = await listChannelPosts({ type, limit });

    return res.status(200).json({
      channel: { username: CHANNEL_USERNAME, url: CHANNEL_URL },
      posts: posts.map(serializePost),
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ message: 'Le flux Pesce Studio est momentanément indisponible.' });
  }
}

function mediaSecret() {
  return process.env.PESCE_MEDIA_SIGNING_SECRET || process.env.TELEGRAM_PESCE_BOT_TOKEN;
}

function serializePost(post) {
  const serialized = { ...post, publishedAt: toIso(post.publishedAt), updatedAt: toIso(post.updatedAt) };
  if (serialized.mediaFileId) {
    try {
      const token = signMedia(serialized.mediaFileId, { secret: mediaSecret() });
      serialized.mediaUrl = `./api/media?file_id=${encodeURIComponent(serialized.mediaFileId)}&token=${encodeURIComponent(token)}`;
    } catch (error) {
      console.error('media signing failed', error); // le client retombe sur l'URL non signée
    }
  }
  if (serialized.mediaThumbnailFileId) {
    try {
      const token = signMedia(serialized.mediaThumbnailFileId, { secret: mediaSecret() });
      serialized.mediaThumbnailUrl = `./api/media?file_id=${encodeURIComponent(serialized.mediaThumbnailFileId)}&token=${encodeURIComponent(token)}`;
    } catch (error) {
      console.error('media thumbnail signing failed', error);
    }
  }
  return serialized;
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}
