// Intégration Telegraph (telegra.ph) : articles natifs Telegram, lus en Instant View.
// Les images d'article sont hébergées PAR TELEGRAPH (endpoint /upload → chemin /file/…) :
// c'est le stockage natif des articles, aucun binaire n'entre dans Neon. Les photos du canal
// (métadonnées/file_id dans Neon) peuvent être re-téléversées vers Telegraph à la demande.
const TELEGRAPH_API = 'https://api.telegra.ph';

// Limite pratique d'image pour un article : Telegraph accepte ≤ 5 Mo, mais l'image transite en
// base64 dans le corps JSON des fonctions serverless (limite Vercel ≈ 4,5 Mo) — 3 Mo d'image
// donnent ~4 Mo de corps encodé : la borne garantit que la requête atteint bien le serveur.
export const MAX_TELEGRAPH_IMAGE_BYTES = 3 * 1024 * 1024;

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

export const TELEGRAPH_UPLOAD_URL = 'https://telegra.ph/upload';

const IMAGE_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
const FORMAT_MIME = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };
const FORMAT_EXTENSION = { jpeg: 'jpg', png: 'png', gif: 'gif' };

// Format réel de l'image d'après ses octets (signature magique), jamais d'après le nom de
// fichier : Telegraph n'accepte que JPEG, PNG et GIF — le webp (et tout autre format) produit
// un refus 400 silencieux côté Telegraph, incompréhensible pour la créatrice.
export function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const gif = buffer.subarray(0, 6).toString('latin1');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  return null;
}

// Corps multipart/form-data construit octet par octet (aucune dépendance à FormData/Blob,
// comportement identique sur tous les runtimes) : une seule partie « file », sans access_token
// (l'endpoint /upload de Telegraph n'en attend pas).
export function buildTelegraphUploadBody({ buffer, filename, mimeType, boundary }) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return Buffer.concat([head, buffer, tail]);
}

// Analyse de la réponse de /upload : succès = [{ src: "/file/…" }] (ou objet { src }).
// Toute autre forme est un refus — le détail (sans secret) reste côté serveur.
export function parseTelegraphUploadResponse(text, status) {
  let data = null;
  try { data = JSON.parse(String(text || '')); } catch { data = null; }
  if (data === null) return { ok: false, error: `Réponse Telegraph illisible (${status || '?'}).` };
  const list = Array.isArray(data) ? data : [data];
  const item = list.find((entry) => entry && typeof entry === 'object' && typeof entry.src === 'string' && entry.src.trim());
  if (item) return { ok: true, src: item.src.trim() };
  const detail = list
    .map((entry) => (entry && (entry.error || entry.message)) || '')
    .filter(Boolean)
    .join(' ; ')
    .slice(0, 300);
  return { ok: false, error: `Telegraph a refusé l'image (${status || '?'})${detail ? ` — ${detail}` : ''}.` };
}

// Téléverse une image vers Telegraph (hébergement natif des articles) et renvoie { src, url }.
// Les échecs lèvent une erreur en français, avec code stable pour la traduction éditoriale côté
// API ; une seule nouvelle tentative sur indisponibilité (5xx/réseau), jamais sur refus (4xx).
export async function uploadTelegraphImage({ accessToken, buffer, filename = 'image.jpg', now = Date.now, fetchImpl = fetch }) {
  // accessToken conservé dans la signature pour la compatibilité des appelants : l'endpoint
  // public /upload de Telegraph n'utilise pas de jeton.
  const format = detectImageFormat(buffer);
  if (!format) {
    throw Object.assign(new Error('Ce format d’image n’est pas accepté par Telegraph : utilisez une image JPEG, PNG ou GIF.'), { code: 'telegraph_format' });
  }
  const boundary = `----pesce${now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const safeFilename = filename && /^[\w.-]+$/.test(String(filename)) ? String(filename) : `pesce.${FORMAT_EXTENSION[format]}`;
  const body = buildTelegraphUploadBody({ buffer, filename: safeFilename, mimeType: FORMAT_MIME[format], boundary });

  const attempt = async () => {
    let response;
    try {
      response = await fetchImpl(TELEGRAPH_UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw Object.assign(new Error('Telegraph est injoignable pour le moment.'), { code: 'telegraph_network', status: 0 });
    }
    const text = await response.text().catch(() => '');
    const parsed = parseTelegraphUploadResponse(text, response.status);
    if (!parsed.ok) throw Object.assign(new Error(parsed.error), { code: 'telegraph_upload', status: response.status });
    return { src: parsed.src, url: telegraphImageUrl(parsed.src) };
  };

  try {
    return await attempt();
  } catch (error) {
    if (error?.code !== 'telegraph_network' && !(error?.status >= 500)) throw error;
    return attempt();
  }
}

// Lit une page Telegraph (retour_complet) et en extrait la première image <figure><img> —
// c'est la couverture de l'article. Renvoie l'URL absolue, ou null. `allowedSrc` : une URL
// externe acceptée telle quelle (couverture hébergée par Pesce Studio via Telegram) — la
// vérification de publication reste stricte, mais jamais limitée aux seuls chemins /file/.
export function articleCoverFromPage(page, { allowedSrc = null } = {}) {
  if (!page || !Array.isArray(page.content)) return null;
  for (const node of page.content) {
    if (node?.tag === 'figure') {
      const image = (node.children || []).find((child) => child?.tag === 'img');
      const src = image?.attrs?.src;
      const url = normalizeTelegraphImage(src) || (allowedSrc && src === allowedSrc ? allowedSrc : null);
      if (url) return url;
    }
  }
  return null;
}

// Extrait le chapeau d'une page Telegraph (premier paragraphe après d'éventuelles figures).
export function articleExcerptFromPage(page) {
  if (!page || !Array.isArray(page.content)) return '';
  for (const node of page.content) {
    if (node?.tag === 'p' && node.children?.[0]) return String(node.children[0]).slice(0, 300);
  }
  return '';
}

// Liste les pages Telegraph publiées par le compte (synchronisation automatique des articles).
export function listTelegraphPages(accessToken, { limit = 20 } = {}) {
  return telegraphCall('getPageList', { access_token: accessToken, limit });
}

// Construit la ligne pesce_posts correspondant à une page Telegraph listée : identifiant stable
// (telegraph_<path>), référence d'article + couverture hébergée par Telegraph, aucun binaire.
export function telegraphBackfillPost(page) {
  if (!page || !page.path || !page.url) return null;
  return {
    id: `telegraph_${page.path}`,
    source: 'studio',
    channelUsername: null,
    messageId: null,
    contentType: 'text',
    text: `${page.title || 'Article'}\n\n${page.description || ''}\n\n${page.url}`,
    telegramUrl: null,
    articleUrl: page.url,
    articleImageUrl: normalizeTelegraphImage(page.image_url || ''),
    published: true,
    publishedAt: new Date(),
    receivedAt: new Date(),
  };
}

// Récupère une page Telegraph publiée (retour du contenu) pour resynchronisation.
// Les pages publiques se lisent SANS jeton d'accès : on le tente d'abord, puis avec le jeton
// configuré — la resynchronisation fonctionne même si le compte propriétaire a changé.
export async function getTelegraphPage({ accessToken, path, returnContent = true }) {
  try {
    return await telegraphCall('getPage', { path, return_content: returnContent });
  } catch (error) {
    if (!accessToken) throw error;
    return telegraphCall('getPage', { access_token: accessToken, path, return_content: returnContent });
  }
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

// Normalise la liste d'images d'un article : chemins Telegraph valides (ou URL acceptée par le
// normaliseur injecté — ex. couverture hébergée par Pesce Studio via Telegram), légende ≤ 1000
// caractères, crédit ≤ 300, 8 images au plus, couverture unique.
export function validateArticleImages(images, { normalize = normalizeTelegraphImage } = {}) {
  if (!Array.isArray(images)) return [];
  const result = [];
  for (const image of images.slice(0, 8)) {
    const url = normalize(image?.src);
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
// `normalize` injectable : mêmes règles d'acceptation que validateArticleImages.
export function nodesFromArticle({ text, images = [], normalize } = {}) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const nodes = paragraphs.map((block) => ({ tag: 'p', children: [block.replace(/\n/g, ' ')] }));
  const validated = validateArticleImages(images, { normalize });
  const cover = validated.find((image) => image.placement === 'cover');
  const inline = validated.filter((image) => image.placement !== 'cover');
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
