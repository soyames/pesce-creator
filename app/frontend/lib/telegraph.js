// Intégration Telegraph (telegra.ph) : articles natifs Telegram, lus en Instant View.
// Les images d'article sont hébergées PAR TELEGRAPH (endpoint /upload → chemin /file/…) :
// c'est le stockage natif des articles, aucun binaire n'entre dans Neon. Les photos du canal
// (métadonnées/file_id dans Neon) peuvent être re-téléversées vers Telegraph à la demande.
const TELEGRAPH_API = 'https://api.telegra.ph';

// Limite pratique d'image pour un article : Telegraph accepte ≤ 5 Mo ; on borne à 4 Mo
// (compatible avec la limite de corps JSON des fonctions serverless).
export const MAX_TELEGRAPH_IMAGE_BYTES = 4 * 1024 * 1024;

export async function telegraphCall(method, params) {
  const response = await fetch(`${TELEGRAPH_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegraph ${method} a échoué : ${data.error || response.status}`);
  return data.result;
}

// Crée le compte Telegraph de la créatrice (une seule fois ; renvoie l'access_token à sauvegarder en env).
export function createTelegraphAccount(shortName, authorName) {
  return telegraphCall('createAccount', { short_name: shortName, author_name: authorName });
}

// Crée une page d'article et renvoie { path, url }.
export function createTelegraphPage({ accessToken, title, content, authorName }) {
  return telegraphCall('createPage', {
    access_token: accessToken,
    title,
    author_name: authorName,
    content,
    return_content: false,
  });
}

// Convertit un texte simple en nœuds Telegraph : un paragraphe <p> par bloc séparé par une ligne vide.
export function nodesFromPlainText(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ tag: 'p', children: [block.replace(/\n/g, ' ')] }));
}

// — Images d'article hébergées par Telegraph.

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

function mimeFromFilename(filename) {
  const extension = String(filename || '').split('.').pop()?.toLowerCase();
  return IMAGE_MIME[extension] || 'image/jpeg';
}

// Téléverse une image vers Telegraph (hébergement natif des articles) et renvoie { src, url }.
export async function uploadTelegraphImage({ accessToken, buffer, filename = 'image.jpg' }) {
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('file', new Blob([buffer], { type: mimeFromFilename(filename) }), filename);
  const response = await fetch('https://telegra.ph/upload', { method: 'POST', body: form });
  const data = await response.json();
  // Telegraph renvoie [{ src: "/file/xxxx.jpg" }] (ou un objet d'erreur).
  const src = Array.isArray(data) ? data[0]?.src : data?.src;
  if (!response.ok || !src) throw new Error(`Upload Telegraph impossible (${response.status}).`);
  return { src, url: telegraphImageUrl(src) };
}

// Chemin /file/… → URL absolue telegra.ph.
export function telegraphImageUrl(src) {
  const path = String(src || '').startsWith('/') ? src : `/${src}`;
  return `https://telegra.ph${path}`;
}

// Valide une image Telegraph (liste blanche stricte : uniquement telegra.ph/file/…) et renvoie
// l'URL absolue, ou null. Accepte le chemin relatif (/file/…) et l'URL absolue telegra.ph.
export function normalizeTelegraphImage(src) {
  if (typeof src !== 'string') return null;
  const value = src.trim();
  const pathMatch = value.match(/^\/?file\/([A-Za-z0-9_-]+\.(?:jpe?g|png|gif))$/i);
  if (pathMatch) return telegraphImageUrl(`/file/${pathMatch[1]}`);
  const urlMatch = value.match(/^https:\/\/telegra\.ph\/file\/([A-Za-z0-9_-]+\.(?:jpe?g|png|gif))$/i);
  if (urlMatch) return value;
  return null;
}

// Normalise la liste d'images d'un article : uniquement des chemins Telegraph valides,
// légende ≤ 1000 caractères, crédit ≤ 300, 8 images au plus, couverture unique.
export function validateArticleImages(images) {
  if (!Array.isArray(images)) return [];
  const result = [];
  for (const image of images.slice(0, 8)) {
    const url = normalizeTelegraphImage(image?.src);
    if (!url) continue;
    result.push({
      src: url,
      caption: String(image?.caption || '').trim().slice(0, 1000),
      credit: String(image?.credit || '').trim().slice(0,300),
      placement: image?.placement === 'cover' ? 'cover' : 'inline',
      afterParagraph: Math.max(0, Math.min(Number(image?.afterParagraph) || 1, 99)),
    });
  }
  return result;
}

function figureNode(image) {
  if (!image?.src) return null;
  const caption = [image.caption, image.credit].filter((part) => String(part || '').trim()).map((part) => String(part).trim()).join(' — ');
  const children = [{ tag: 'img', attrs: { src: image.src } }];
  if (caption) children.push({ tag: 'figcaption', children: [caption] });
  return { tag: 'figure', children };
}

// Nœuds d'article avec images : paragraphes du texte + figures Telegraph.
// La couverture (placement cover) vient en tête ; les images « dans l'article » s'insèrent
// après le paragraphe choisi (afterParagraph, 1 = après le premier paragraphe).
export function nodesFromArticle({ text, images = [] } = {}) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const nodes = paragraphs.map((block) => ({ tag: 'p', children: [block.replace(/\n/g, ' ')] }));
  const cover = validateArticleImages(images).find((image) => image.placement === 'cover');
  const inline = validateArticleImages(images).filter((image) => image.placement !== 'cover');
  const inlineByAfter = new Map();
  for (const image of inline) {
    const after = Math.max(1, Math.min(Number(image.afterParagraph) || 1, Math.max(nodes.length, 1)));
    if (!inlineByAfter.has(after)) inlineByAfter.set(after, []);
    inlineByAfter.get(after).push(figureNode(image));
  }
  const result = [];
  if (cover) result.push(figureNode(cover));
  nodes.forEach((node, index) => {
    result.push(node);
    for (const figure of inlineByAfter.get(index + 1) || []) result.push(figure);
  });
  for (const [after, figures] of inlineByAfter) {
    if (after > nodes.length) result.push(...figures);
  }
  return result.filter(Boolean);
}
