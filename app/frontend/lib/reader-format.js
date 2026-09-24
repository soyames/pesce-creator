// Mise en forme du corps de lecture — script classique chargé AVANT app.js (index.html), et lu
// tel quel par les tests (aucune dépendance au DOM). Fonctions pures uniquement :
//   - le corps d'article canonique (articleBody, persisté dans Neon à la publication) est rendu
//     directement dans le Mini App — la lecture ne dépend JAMAIS de la page Telegraph ;
//   - les publications sans corps d'article retombent sur leur texte de dépêche (comportement
//     historique des dépêches et des publications Telegram) ;
//   - chaque paragraphe est échappé avant insertion dans le HTML : aucune injection possible.
(function attachReaderFormat(global) {
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  // Source du corps affiché : le corps d'article canonique quand il existe (même si l'URL
  // Telegraph est morte ou absente), sinon le texte de la publication.
  function readerBodySource(post) {
    const body = post && typeof post.articleBody === 'string' ? post.articleBody.trim() : '';
    return body || String((post && post.text) || '');
  }

  // Corps de lecture : paragraphes séparés par des lignes vides, lettrine éditoriale sur le
  // premier. Les paragraphes qui ne sont que des URL sont ignorés.
  function readerBody(text, images = []) {
    const paragraphs = String(text || '')
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .filter((paragraph) => !/^https?:\/\//.test(paragraph));
    if (!paragraphs.length) return '<p class="font-body-lg text-body-lg text-on-surface leading-relaxed">Publication du canal Pesce Studio.</p>';
    const inline = Array.isArray(images) ? images.filter((image) => image && image.placement !== 'cover' && typeof image.src === 'string' && /^https:\/\//i.test(image.src)) : [];
    const figure = (image) => `<figure class="my-space-md"><img class="w-full rounded-lg" src="${escapeHtml(image.src)}" alt="${escapeHtml(image.caption || 'Illustration de l’article')}" loading="lazy">${image.caption || image.credit ? `<figcaption class="font-meta-detail text-meta-detail text-on-surface-variant mt-1 text-center">${escapeHtml([image.caption, image.credit].filter(Boolean).join(' — '))}</figcaption>` : ''}</figure>`;
    const body = paragraphs.map((paragraph, index) => {
      const dropCap = index === 0 && paragraph.length > 60
        ? ' first-letter:float-left first-letter:text-5xl first-letter:pr-3 first-letter:font-editorial-standfirst first-letter:text-primary first-letter:font-bold first-letter:leading-none'
        : '';
      return `<p class="font-body-lg text-body-lg text-on-surface leading-relaxed${dropCap}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>${inline.filter((image) => Math.max(1, Number(image.afterParagraph) || 1) === index + 1).map(figure).join('')}`;
    }).join('');
    return body + inline.filter((image) => Math.max(1, Number(image.afterParagraph) || 1) > paragraphs.length).map(figure).join('');
  }

  global.PESCE_READER_FORMAT = { escapeHtml, readerBody, readerBodySource };
})(globalThis);
