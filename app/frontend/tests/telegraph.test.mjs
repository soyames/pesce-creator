// Tests de lib/telegraph.js (parties pures) : conversion texte simple → nœuds Telegraph,
// et images d'article (hébergement Telegraph : chemins /file/…, couverture, insertion, légende/crédit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleCoverFromPage, articleExcerptFromPage, nodesFromArticle, nodesFromPlainText, normalizeTelegraphImage, telegraphBackfillPost, telegraphImageUrl, validateArticleImages } from '../lib/telegraph.js';

test('nodesFromPlainText : un paragraphe par bloc séparé par une ligne vide', () => {
  const nodes = nodesFromPlainText('Premier paragraphe.\n\nDeuxième paragraphe.\n\nTroisième.');
  assert.deepEqual(nodes, [
    { tag: 'p', children: ['Premier paragraphe.'] },
    { tag: 'p', children: ['Deuxième paragraphe.'] },
    { tag: 'p', children: ['Troisième.'] },
  ]);
});

test('nodesFromPlainText : sauts de ligne simples repliés en espaces', () => {
  const nodes = nodesFromPlainText('Ligne une\nligne deux');
  assert.deepEqual(nodes, [{ tag: 'p', children: ['Ligne une ligne deux'] }]);
});

test('nodesFromPlainText : blocs vides et espaces ignorés', () => {
  assert.deepEqual(nodesFromPlainText('  \n\n  Texte  \n\n\n\nAutre'), [
    { tag: 'p', children: ['Texte'] },
    { tag: 'p', children: ['Autre'] },
  ]);
});

test('nodesFromPlainText : entrées vides → []', () => {
  assert.deepEqual(nodesFromPlainText(''), []);
  assert.deepEqual(nodesFromPlainText('   \n\n  '), []);
  assert.deepEqual(nodesFromPlainText(null), []);
});

// — Images d'article hébergées par Telegraph.
test('normalizeTelegraphImage : liste blanche stricte des chemins /file/…', () => {
  assert.equal(normalizeTelegraphImage('/file/abc123.jpg'), 'https://telegra.ph/file/abc123.jpg');
  assert.equal(normalizeTelegraphImage('file/abc123.PNG'), 'https://telegra.ph/file/abc123.PNG');
  assert.equal(normalizeTelegraphImage('/file/a-b_c9.gif'), 'https://telegra.ph/file/a-b_c9.gif');
  assert.equal(normalizeTelegraphImage('https://telegra.ph/file/abc.jpg'), 'https://telegra.ph/file/abc.jpg', 'URL telegra.ph légitime refusée');
  assert.equal(normalizeTelegraphImage('https://evil.example/file/abc.jpg'), null, 'hôte étranger accepté');
  assert.equal(normalizeTelegraphImage('/file/../../etc/passwd'), null, 'traversée de chemin acceptée');
  assert.equal(normalizeTelegraphImage('/file/abc.svg'), null, 'extension non image acceptée');
  assert.equal(normalizeTelegraphImage(''), null);
  assert.equal(telegraphImageUrl('/file/x.jpg'), 'https://telegra.ph/file/x.jpg');
  assert.equal(telegraphImageUrl('file/x.jpg'), 'https://telegra.ph/file/x.jpg');
});

test('validateArticleImages : normalisation, troncatures, invalides écartés', () => {
  const images = validateArticleImages([
    { src: '/file/ok.jpg', caption: 'Légende', credit: 'Pesce Hounyo', placement: 'cover', afterParagraph: 1 },
    { src: 'https://evil.example/x.jpg', caption: 'Hors liste blanche' },
    { src: '/file/long.png', caption: 'a'.repeat(1500), credit: 'b'.repeat(500), placement: 'inline', afterParagraph: 3 },
  ]);
  assert.equal(images.length, 2);
  assert.deepEqual(images[0], { src: 'https://telegra.ph/file/ok.jpg', caption: 'Légende', credit: 'Pesce Hounyo', placement: 'cover', afterParagraph: 1 });
  assert.equal(images[1].caption.length, 1000, 'légende non tronquée');
  assert.equal(images[1].credit.length, 300, 'crédit non tronqué');
  assert.equal(images[1].afterParagraph, 3);
  assert.equal(validateArticleImages('pas-un-tableau').length, 0);
  assert.ok(validateArticleImages(Array.from({ length: 12 }, (_, index) => ({ src: `/file/${index}.jpg` }))).length <= 8, 'plus de 8 images acceptées');
});

test('nodesFromArticle : couverture en tête, images insérées après le paragraphe choisi', () => {
  const nodes = nodesFromArticle({
    text: 'Premier paragraphe.\n\nDeuxième paragraphe.\n\nTroisième.',
    images: [
      { src: 'https://telegra.ph/file/couverture.jpg', caption: 'La couverture', credit: 'Pesce Hounyo', placement: 'cover', afterParagraph: 1 },
      { src: 'https://telegra.ph/file/dans.jpg', caption: 'Dans l\'article', credit: '', placement: 'inline', afterParagraph: 2 },
    ],
  });
  assert.equal(nodes[0].tag, 'figure', 'la couverture n\'est pas en tête');
  assert.equal(nodes[0].children[0].attrs.src, 'https://telegra.ph/file/couverture.jpg');
  assert.equal(nodes[0].children[1].tag, 'figcaption');
  assert.deepEqual(nodes[0].children[1].children, ['La couverture — Pesce Hounyo']);
  const paragraphIndex = nodes.findIndex((node) => node.tag === 'p' && node.children[0] === 'Deuxième paragraphe.');
  assert.equal(nodes[paragraphIndex + 1].tag, 'figure', 'image insérée au mauvais endroit');
  assert.equal(nodes[paragraphIndex + 1].children[0].attrs.src, 'https://telegra.ph/file/dans.jpg');
  assert.deepEqual(nodes[paragraphIndex + 1].children[1].children, ['Dans l\'article']);
});

test('telegraphBackfillPost : référence stable et complète pour la synchronisation automatique', () => {
  const page = {
    path: 'Le-numerique-africain-09-11-2',
    url: 'https://telegra.ph/Le-numerique-africain-09-11-2',
    title: 'Le numérique africain a besoin de confiance',
    description: 'Chapeau de l’article.',
    image_url: '/file/cover-123.jpg',
  };
  const post = telegraphBackfillPost(page);
  assert.equal(post.id, 'telegraph_Le-numerique-africain-09-11-2');
  assert.equal(post.source, 'studio');
  assert.equal(post.contentType, 'text');
  assert.equal(post.articleUrl, page.url);
  assert.equal(post.articleImageUrl, 'https://telegra.ph/file/cover-123.jpg');
  assert.ok(post.text.includes('Le numérique africain a besoin de confiance'));
  assert.ok(post.text.includes(page.url));
  assert.equal(post.mediaFileId, undefined, 'aucun binaire : la couverture est une référence Telegraph');
  assert.equal(telegraphBackfillPost(null), null);
  assert.equal(telegraphBackfillPost({ path: 'x' }), null, 'page sans URL refusée');
});

test('articleCoverFromPage / articleExcerptFromPage : couverture et chapeau d’une page Telegraph', () => {
  const page = {
    title: 'Titre',
    content: [
      { tag: 'figure', children: [{ tag: 'img', attrs: { src: '/file/cover-abc.jpg' } }, { tag: 'figcaption', children: ['Légende'] }] },
      { tag: 'p', children: ['Chapeau de l’article.'] },
      { tag: 'p', children: ['Suite.'] },
    ],
  };
  assert.equal(articleCoverFromPage(page), 'https://telegra.ph/file/cover-abc.jpg');
  assert.equal(articleExcerptFromPage(page), 'Chapeau de l’article.');
  assert.equal(articleCoverFromPage({ content: [{ tag: 'p', children: ['Texte seul'] }] }), null);
  assert.equal(articleCoverFromPage(null), null);
  assert.equal(articleExcerptFromPage(null), '');
});

test('articleCoverFromPage : couverture externe acceptée uniquement si URL attendue exacte', () => {
  const signedCover = 'https://pesce-creator-nine.vercel.app/api/media?file_id=cover&token=signe';
  const page = {
    title: 'Titre',
    content: [
      { tag: 'figure', children: [{ tag: 'img', attrs: { src: signedCover } }] },
      { tag: 'p', children: ['Chapeau.'] },
    ],
  };
  assert.equal(articleCoverFromPage(page, { allowedSrc: signedCover }), signedCover, 'couverture hébergée refusée');
  assert.equal(articleCoverFromPage(page), null, 'URL externe acceptée sans liste blanche');
  assert.equal(articleCoverFromPage(page, { allowedSrc: 'https://pesce-creator-nine.vercel.app/api/media?file_id=autre&token=signe' }), null, 'URL externe différente acceptée');
});

test('validateArticleImages / nodesFromArticle : normaliseur injectable (hébergement Pesce Studio)', () => {
  const signedCover = 'https://pesce-creator-nine.vercel.app/api/media?file_id=cover&token=signe';
  const acceptSigned = (src) => (src === signedCover ? src : src === '/file/natif.jpg' ? 'https://telegra.ph/file/natif.jpg' : null);
  const images = validateArticleImages([{ src: signedCover, placement: 'cover' }, { src: '/file/natif.jpg', placement: 'inline', afterParagraph: 1 }], { normalize: acceptSigned });
  assert.equal(images.length, 2, 'normaliseur injectable ignoré');
  assert.equal(images[0].src, signedCover);
  assert.equal(images[1].src, 'https://telegra.ph/file/natif.jpg');
  const nodes = nodesFromArticle({ text: 'Paragraphe.', images: [{ src: signedCover, placement: 'cover' }], normalize: acceptSigned });
  assert.equal(nodes[0].tag, 'figure');
  assert.equal(nodes[0].children[0].attrs.src, signedCover, 'couverture hébergée absente des nœuds');
});

test('nodesFromArticle : image au-delà du dernier paragraphe → ajoutée en fin ; sans image = texte seul', () => {
  const nodes = nodesFromArticle({
    text: 'Seul paragraphe.',
    images: [{ src: 'https://telegra.ph/file/fin.jpg', caption: '', credit: '', placement: 'inline', afterParagraph: 9 }],
  });
  assert.equal(nodes[0].tag, 'p');
  assert.equal(nodes[1].tag, 'figure');
  assert.equal(nodes[1].children[0].attrs.src, 'https://telegra.ph/file/fin.jpg');
  assert.deepEqual(nodesFromArticle({ text: 'A.\n\nB.' }), nodesFromPlainText('A.\n\nB.'), 'article sans image ≠ texte simple');
  assert.deepEqual(nodesFromArticle({ text: '', images: [{ src: 'https://telegra.ph/file/c.jpg', placement: 'cover' }] }), [
    { tag: 'figure', children: [{ tag: 'img', attrs: { src: 'https://telegra.ph/file/c.jpg' } }] },
  ]);
});
