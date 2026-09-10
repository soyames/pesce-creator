// Programmation publique des directs : renvoie les directs programmés ou en cours, à venir.
// Le direct lui-même reste hébergé par la plateforme externe (lien fourni) ; aucune donnée privée ici.
import { getUpcomingLive } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Méthode non autorisée.' });
  try {
    const lives = await getUpcomingLive();
    return res.status(200).json({ lives: lives.map(serialize) });
  } catch (error) {
    console.error(error);
    return res.status(503).json({ message: 'Les directs sont momentanément indisponibles.' });
  }
}

function serialize(live) {
  return {
    ...live,
    scheduledAt: toIso(live.scheduledAt),
    createdAt: toIso(live.createdAt),
    updatedAt: toIso(live.updatedAt),
  };
}

function toIso(value) {
  if (!value) return null;
  if (typeof value.toISOString === 'function') return value.toISOString();
  return typeof value === 'string' ? value : null;
}
