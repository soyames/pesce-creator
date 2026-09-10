// Intégration Telegraph (telegra.ph) : articles natifs Telegram, lus en Instant View.
// Limites connues (2026) : contenu pratique ≲ 20 Ko, titres h3/h4 uniquement, upload d'images instable.
// Les articles du studio restent donc du texte simple (titre + paragraphes) ; les médias passent par le canal Telegram.
const TELEGRAPH_API = 'https://api.telegra.ph';

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
