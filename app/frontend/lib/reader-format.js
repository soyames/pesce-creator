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
  function readerBody(text) {
    const paragraphs = String(text || '')
      .split('\n\n')
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .filter((paragraph) => !/^https?:\/\//.test(paragraph));
    if (!paragraphs.length) return '<p class="font-body-lg text-body-lg text-on-surface leading-relaxed">Publication du canal Pesce Studio.</p>';
    return paragraphs.map((paragraph, index) => {
      const dropCap = index === 0 && paragraph.length > 60
        ? ' first-letter:float-left first-letter:text-5xl first-letter:pr-3 first-letter:font-editorial-standfirst first-letter:text-primary first-letter:font-bold first-letter:leading-none'
        : '';
      return `<p class="font-body-lg text-body-lg text-on-surface leading-relaxed${dropCap}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }

  global.PESCE_READER_FORMAT = { escapeHtml, readerBody, readerBodySource };
})(globalThis);
