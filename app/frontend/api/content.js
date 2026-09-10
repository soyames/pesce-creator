import { listChannelPosts } from '../lib/firestore.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Méthode non autorisée.' });
  }

  try {
    const type = typeof req.query?.type === 'string' ? req.query.type : undefined;
    const limit = req.query?.limit;
    const posts = await listChannelPosts({ type, limit });

    return res.status(200).json({
      channel: {
        username: 'PesceHounyoOfficiel',
        url: 'https://t.me/PesceHounyoOfficiel'
      },
      posts: posts.map(serializePost)
    });
  } catch (error) {
    console.error(error);
    return res.status(503).json({
      message: 'Le flux Pesce Studio est momentanément indisponible.'
    });
  }
}

function serializePost(post) {
  return {
    ...post,
    publishedAt: toIso(post.publishedAt),
    updatedAt: toIso(post.updatedAt)
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}
