// YouTube est la couche d'hébergement vidéo de Pesce Studio (V1) : le studio ne stocke
// JAMAIS de fichier vidéo — uniquement l'URL validée/normalisée, l'identifiant et la
// miniature dérivée (i.ytimg.com). Neon ne garde que des références.
export function youtubeIdOf(value) {
  const source = String(value || '').trim();
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// URL canonique « watch » — le seul format publié sur le canal.
export function normalizeYouTubeUrl(value) {
  const id = youtubeIdOf(value);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

// Miniature dérivée de l'identifiant (aucun fichier dupliqué, aucun binaire dans Neon).
export function youtubeThumbnail(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
