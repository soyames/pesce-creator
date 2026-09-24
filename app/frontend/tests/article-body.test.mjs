// Corps d'article canonique (BUG de production : article publié illisible dans le Mini App).
// Garanties testées :
//   - la publication d'un article du Studio persiste son corps intégral dans Neon (article_body) ;
//   - /api/content sert ce corps (contrat de données public) ;
//   - le lecteur rend le corps intégral SANS aucune dépendance à la page Telegraph (morte ou absente) ;
//   - chaque paragraphe est échappé avant insertion (aucune injection HTML) ;
//   - les publications sans corps (anciennes, Telegram) conservent leur comportement historique ;
//   - aucun sync webhook/backfill ne peut écraser un corps déjà persisté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializePost } from '../api/content.js';
import { articleBodyFromPage } from '../lib/telegraph.js';

// — Fichiers de production lus tels quels (même garde-fou que les autres suites).
const PRODUCTION = {
  'api/studio.js': readFileSync(fileURLToPath(new URL('../api/studio.js', import.meta.url)), 'utf8'),
  'api/content.js': readFileSync(fileURLToPath(new URL('../api/content.js', import.meta.url)), 'utf8'),
  'lib/db.js': readFileSync(fileURLToPath(new URL('../lib/db.js', import.meta.url)), 'utf8'),
  'lib/schema.js': readFileSync(fileURLToPath(new URL('../lib/schema.js', import.meta.url)), 'utf8'),
  'lib/reader-format.js': readFileSync(fileURLToPath(new URL('../lib/reader-format.js', import.meta.url)), 'utf8'),
  'app.js': readFileSync(fileURLToPath(new URL('../app.js', import.meta.url)), 'utf8'),
  'index.html': readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8'),
};

// — Fonctions pures partagées du lecteur (script classique de production évalué tel quel).
function loadReaderFormat() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(PRODUCTION['lib/reader-format.js'], sandbox);
  return sandbox.PESCE_READER_FORMAT;
}
const { readerBody, readerBodySource } = loadReaderFormat();

// — Serveur : le corps survit au cycle publication → Neon → API publique.
test('serveur : le corps d’article est persisté dans Neon à la publication (article_publish)', () => {
  assert.ok(PRODUCTION['api/studio.js'].includes('articleBody: text'), 'corps non passé à la persistance canonique');
  assert.ok(PRODUCTION['lib/schema.js'].includes('009_article_body.sql'), 'migration du corps absente');
  assert.ok(PRODUCTION['lib/schema.js'].includes('ADD COLUMN IF NOT EXISTS article_body TEXT'), 'colonne article_body absente de la migration');
});

test('serveur : aucun sync webhook/backfill ne peut écraser un corps déjà persisté', () => {
  assert.ok(PRODUCTION['lib/db.js'].includes('articleBody: row.article_body'), 'corps non lu depuis Neon (mapPost)');
  assert.ok(
    PRODUCTION['lib/db.js'].includes("article_body = COALESCE(NULLIF(EXCLUDED.article_body, ''), pesce_posts.article_body)"),
    'corps écrasable par un sync sans corps'
  );
  // Course webhook gagnante : le corps du Studio est porté sur la ligne canonique.
  assert.ok(PRODUCTION['lib/db.js'].includes("add('article_body', provisional.articleBody)"), 'corps perdu quand la ligne webhook devient canonique');
});

test('contrat /api/content : une publication Studio servie contient son corps intégral', () => {
  const serialized = serializePost({
    id: 'studio_x',
    contentType: 'text',
    text: 'Titre\n\nhttps://telegra.ph/Titre-01-01',
    articleUrl: 'https://telegra.ph/Titre-01-01',
    articleBody: 'Premier paragraphe du corps.\n\nSecond paragraphe du corps.',
    publishedAt: new Date('2026-09-12T10:00:00Z'),
    updatedAt: new Date('2026-09-12T11:00:00Z'),
  });
  assert.equal(serialized.articleBody, 'Premier paragraphe du corps.\n\nSecond paragraphe du corps.');
  assert.equal(serialized.publishedAt, '2026-09-12T10:00:00.000Z');
  assert.equal(serialized.updatedAt, '2026-09-12T11:00:00.000Z');
  assert.equal(serialized.mediaUrl, undefined, 'jeton média inventé sans fichier');
  // Publication sans corps (ancienne, ou Telegram) : champ null servi — jamais d'invention.
  const legacy = serializePost({ id: '1_2', contentType: 'text', text: 'Message du canal' });
  assert.equal(legacy.articleBody, null);
});

// — Récupération d'un article ancien : le corps manquant est complété depuis SA page Telegraph
// (jamais d'un autre site) par la resynchronisation authentifiée du Studio.
test('articleBodyFromPage : corps reconstruit depuis la page Telegraph de l’article (aucune invention)', () => {
  assert.equal(articleBodyFromPage(null), '');
  assert.equal(articleBodyFromPage({}), '');
  assert.equal(articleBodyFromPage({ content: 'pas-un-tableau' }), '');
  const page = {
    content: [
      { tag: 'figure', children: [{ tag: 'img', attrs: { src: '/file/cover.jpg' } }] },
      { tag: 'p', children: ['Premier paragraphe.'] },
      { tag: 'p', children: ['Deuxième paragraphe.'] },
      { tag: 'p', children: ['   '] },
    ],
  };
  assert.equal(articleBodyFromPage(page), 'Premier paragraphe.\n\nDeuxième paragraphe.');
  // Le corps reconstruit se lit tel quel dans le lecteur du Mini App.
  const html = readerBody(articleBodyFromPage(page));
  assert.ok(html.includes('Premier paragraphe.'), 'paragraphe reconstruit absent');
  assert.ok(html.includes('Deuxième paragraphe.'), 'paragraphe reconstruit absent');
});

test('serveur : la resynchronisation complète le corps manquant (jamais d’écrasement)', () => {
  // Le corps est lu sur la page Telegraph, après retrait du pied ajouté par Pesce Studio —
  // sans ce retrait, le pied serait recopié dans le corps canonique de l'article.
  assert.ok(PRODUCTION['api/studio.js'].includes('articleBodyFromPage(sourcePage)'), 'resync : corps non lu sur la page Telegraph');
  assert.ok(PRODUCTION['api/studio.js'].includes('const sourcePage = { ...page, content: stripArticleFooter(page.content) }'), 'resync : le pied serait recopié dans le corps');
  assert.ok(PRODUCTION['api/studio.js'].includes('bodyRecovered: Boolean(bodyRecovered)'), 'resync : récupération non signalée à la créatrice');
  assert.ok(
    PRODUCTION['lib/db.js'].includes("if (!existing.articleBody && post.articleBody) add('article_body', post.articleBody)"),
    'fusion : corps manquant jamais complété'
  );
});

// — Lecteur : le corps intégral s'affiche dans le Mini App, Telegraph n'est jamais requis.
test('lecture : corps intégral rendu sans aucune dépendance à l’URL Telegraph (morte ou absente)', () => {
  const post = {
    articleBody: 'Paragraphe un.\n\nParagraphe deux.\n\nParagraphe trois.',
    text: 'Titre\n\nhttps://telegra.ph/page-morte-404',
    articleUrl: 'https://telegra.ph/page-morte-404',
  };
  assert.equal(readerBodySource(post), 'Paragraphe un.\n\nParagraphe deux.\n\nParagraphe trois.');
  const html = readerBody(readerBodySource(post));
  assert.ok(html.includes('Paragraphe un.'), 'premier paragraphe absent');
  assert.ok(html.includes('Paragraphe deux.'), 'deuxième paragraphe absent');
  assert.ok(html.includes('Paragraphe trois.'), 'dernier paragraphe absent');
  assert.ok(!html.includes('telegra.ph'), 'l’URL Telegraph influence encore le corps');
  assert.equal(html.split('<p ').length - 1, 3, 'nombre de paragraphes rendus incorrect');
  // Même article SANS URL Telegraph du tout : toujours lisible.
  const withoutUrl = readerBodySource({ articleBody: 'Corps seul.' });
  assert.equal(withoutUrl, 'Corps seul.');
});

test('lecture : corps d’article échappé — aucune injection HTML possible', () => {
  const html = readerBody('<script>alert("x")</script> & <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'), 'balise script injectée');
  assert.ok(html.includes('&lt;script&gt;'), 'chevrons non échappés');
  assert.ok(html.includes('&amp;'), 'esperluette non échappée');
  assert.ok(!html.includes('<img'), 'balise img injectée');
  assert.ok(!html.includes('<img src='), 'balise img injectée avec attribut');
  assert.ok(html.includes('&quot;'), 'guillemets non échappés');
  const apostrophes = readerBody("L'indépendance d'abord");
  assert.ok(!apostrophes.includes("'"), 'apostrophe non échappée');
});

test('lecture : publications sans corps — comportement historique conservé (dépêches, Telegram)', () => {
  // Dépêche texte simple : le texte EST le corps.
  assert.equal(readerBodySource({ text: 'Dépêche du canal.' }), 'Dépêche du canal.');
  assert.ok(readerBody('Dépêche du canal.').includes('Dépêche du canal.'));
  // Ancien article (titre + URL Telegraph seulement) : l'URL n'est jamais rendue comme corps.
  const legacy = readerBody('Titre ancien\n\nhttps://telegra.ph/ancien');
  assert.ok(legacy.includes('Titre ancien'));
  assert.ok(!legacy.includes('telegra.ph'), 'paragraphe URL non filtré');
  // Corps absent / vide : le texte de la publication reste la source (jamais de contenu inventé).
  assert.equal(readerBodySource({ articleBody: '   ', text: 'Dépêche' }), 'Dépêche', 'corps vide ignoré');
  assert.equal(readerBodySource({ articleBody: null, text: 'Texte du canal' }), 'Texte du canal');
  // Aucun corps du tout : libellé d'archive honnête, pas de fabrication.
  assert.ok(readerBody('').includes('Publication du canal Pesce Studio.'));
});

// — Interface : le lecteur du Mini App consomme le corps intégral.
test('interface : openReader/renderReader rendent le corps intégral (articleBody) dans le Mini App', () => {
  const app = PRODUCTION['app.js'];
  assert.ok(app.includes('readerBody(readerBodySource(post), post.articleImages)'), 'corps et illustrations non rendus dans le lecteur');
  assert.ok(app.includes('readingLabel(readerBodySource(post))'), 'temps de lecture basé sur le résumé au lieu du corps');
  assert.ok(app.includes('Boolean(post.articleBody && String(post.articleBody).trim())'), 'détection du corps intégral absente');
  assert.ok(app.includes('post.articleUrl || (articleUrlOf(post)'), 'référence Telegraph préférée au champ canonique');
});

test('interface : Telegraph reste secondaire — copie adaptée, état externe honnête conservé', () => {
  const app = PRODUCTION['app.js'];
  assert.ok(app.includes('Version également disponible sur Telegraph'), 'copie secondaire absente quand le corps est intégral');
  assert.ok(app.includes('Version intégrale sur Telegraph'), 'état externe honnête des anciens articles supprimé');
  assert.ok(PRODUCTION['index.html'].includes('./lib/reader-format.js'), 'module de format partagé non chargé');
  const order = PRODUCTION['index.html'].indexOf('./lib/reader-format.js');
  assert.ok(order !== -1 && order < PRODUCTION['index.html'].indexOf('./app.js'), 'reader-format.js doit précéder app.js');
});
