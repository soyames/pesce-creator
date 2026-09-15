// Correction d'un écrit DÉJÀ PUBLIÉ + parcours du lecteur (l'article n'est jamais une impasse).
//
// Deux invariants sont gardés ici :
//   1. IDENTITÉ CANONIQUE — corriger une publication ne la recrée jamais : même ligne, même
//      identifiant, même URL publique, même date de publication, mêmes données rattachées.
//      Seul `updated_at` avance. Aucune dépublication, aucun second article.
//   2. PARCOURS DU LECTEUR — un lien d'article mène au journal complet (navigateur ordinaire
//      comme Telegram), propose d'autres publications réelles et laisse accéder au soutien ;
//      il n'expose jamais de brouillon ni de publication retirée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import studioHandler, { relinkedText } from '../api/studio.js';
import { serializePost } from '../api/content.js';
import { POST_UPDATABLE_COLUMNS } from '../lib/db.js';
import { articleFooterNodes, editTelegraphPage, nodesFromArticle, stripArticleFooter, telegraphPathFromUrl } from '../lib/telegraph.js';
import PESCE, { articleLink, articleLinkFromTelegraph, articleTelegramLink, telegraphPathOf, WEB_STUDIO_URL } from '../lib/config.js';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

function stubRes() {
  return {
    code: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function withEnv(env, fn) {
  const saved = process.env;
  const next = { ...saved };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  process.env = next;
  return Promise.resolve(fn()).finally(() => { process.env = saved; });
}

// ——————————————————————————————————————————————————————————————————————————
// A. Identité canonique : ce qu'une correction a le droit de toucher
// ——————————————————————————————————————————————————————————————————————————

test('mise à jour d’une publication : liste blanche stricte, identité intouchable', () => {
  // Ce qu'une correction éditoriale doit pouvoir écrire.
  assert.equal(POST_UPDATABLE_COLUMNS.text, 'text');
  assert.equal(POST_UPDATABLE_COLUMNS.articleBody, 'article_body');
  assert.equal(POST_UPDATABLE_COLUMNS.articleImageUrl, 'article_image_url');

  // Ce qu'elle ne doit JAMAIS pouvoir écrire : l'identité, la mise en ligne, les liens, la
  // distribution Telegram et l'origine. Une correction ne dépublie pas, ne renomme pas, ne
  // déplace pas l'article et ne réinitialise pas sa date de publication.
  const forbidden = [
    'id', 'published', 'published_at', 'received_at', 'article_url', 'publish_key',
    'message_id', 'chat_id', 'channel_id', 'channel_username', 'telegram_url',
    'origin', 'source', 'source_deleted_at', 'content_type',
  ];
  const writable = Object.values(POST_UPDATABLE_COLUMNS);
  for (const column of forbidden) {
    assert.ok(!writable.includes(column), `colonne « ${column} » modifiable par une correction`);
  }

  // La requête ne touche jamais published_at et fait toujours avancer updated_at.
  const source = read('lib/db.js');
  const updateBlock = source.slice(source.indexOf('export async function updatePost'), source.indexOf('export async function attachTelegramDistribution'));
  assert.ok(updateBlock.includes('updated_at = now()'), 'updated_at non mis à jour');
  assert.ok(!updateBlock.includes('published_at'), 'published_at réécrit par une correction');
});

test('retrait (Retirer) : la publication quitte les flux sans perdre sa ligne ni sa date', () => {
  const source = read('lib/db.js');
  const start = source.indexOf('export async function recallPost');
  const recallSql = source.slice(source.indexOf('UPDATE pesce_posts', start), source.indexOf('`,', start));
  assert.ok(recallSql.includes('published = false'), 'le retrait ne dépublie pas');
  assert.ok(recallSql.includes('updated_at = now()'), 'le retrait ne date pas la modification');
  assert.ok(!recallSql.includes('DELETE'), 'le retrait supprime la ligne (perte d’historique)');
  assert.ok(!recallSql.includes('published_at'), 'le retrait réinitialise la date de publication');
});

// ——————————————————————————————————————————————————————————————————————————
// B. Page Telegraph : éditée EN PLACE, l'URL publique ne change jamais
// ——————————————————————————————————————————————————————————————————————————

test('telegraphPathFromUrl : chemin d’une page telegra.ph, rien d’autre', () => {
  assert.equal(telegraphPathFromUrl('https://telegra.ph/Mon-Article-09-11'), 'Mon-Article-09-11');
  assert.equal(telegraphPathFromUrl('https://telegra.ph/Mon-Article-09-11/'), 'Mon-Article-09-11');
  assert.equal(telegraphPathFromUrl('https://telegra.ph/Mon-Article-09-11?x=1'), 'Mon-Article-09-11');
  assert.equal(telegraphPathFromUrl('https://exemple.test/Mon-Article'), null, 'hôte étranger accepté');
  assert.equal(telegraphPathFromUrl('https://telegra.ph/'), null);
  assert.equal(telegraphPathFromUrl(''), null);
  assert.equal(telegraphPathFromUrl(undefined), null);
});

test('editTelegraphPage : même chemin → même URL publique (aucun lien partagé ne casse)', async () => {
  const calls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: { path: 'Mon-Article-09-11', url: 'https://telegra.ph/Mon-Article-09-11' } }) };
  };
  try {
    const page = await editTelegraphPage({
      accessToken: 'jeton-de-test',
      path: 'Mon-Article-09-11',
      title: 'Titre corrigé',
      content: [{ tag: 'p', children: ['Corps corrigé.'] }],
      authorName: 'Pesce Hounyo',
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/editPage'), 'une nouvelle page est créée au lieu d’éditer');
    assert.equal(calls[0].body.path, 'Mon-Article-09-11', 'le chemin de la page a changé');
    assert.equal(calls[0].body.title, 'Titre corrigé');
    assert.equal(page.url, 'https://telegra.ph/Mon-Article-09-11', 'l’URL publique a changé');
  } finally { globalThis.fetch = savedFetch; }
});

test('correction sans nouvelle image : la couverture déjà en ligne reste dans l’article', () => {
  const cover = { src: '/file/couverture-existante.jpg', placement: 'cover', caption: '', credit: '' };
  const nodes = nodesFromArticle({ text: 'Paragraphe corrigé.\n\nSecond paragraphe.', images: [cover] });
  const figures = nodes.filter((node) => node.tag === 'figure');
  assert.equal(figures.length, 1, 'la couverture a disparu de l’article corrigé');
  // La source est normalisée en URL Telegraph absolue : c'est bien la MÊME image.
  assert.equal(figures[0].children[0].attrs.src, 'https://telegra.ph/file/couverture-existante.jpg');
  assert.equal(nodes[0].tag, 'figure', 'la couverture n’est plus en tête d’article');
  assert.equal(nodes.filter((node) => node.tag === 'p').length, 2, 'le corps corrigé n’est pas repris');
});

// ——————————————————————————————————————————————————————————————————————————
// B bis. Pied d'article Telegraph : la seule sortie possible depuis une page de Telegram
// ——————————————————————————————————————————————————————————————————————————

const footerText = (nodes) => JSON.stringify(nodes);

test('pied Telegraph : liens vers le journal et le soutien, après une ligne de séparation', () => {
  const footer = articleFooterNodes({ journalUrl: 'https://journal.test/', supportUrl: 'https://t.me/bot?startapp=support', creatorName: 'Pesce Hounyo' });
  assert.equal(footer[0].tag, 'hr', 'le pied ne se détache pas de l’article');
  const serialized = footerText(footer);
  assert.ok(serialized.includes('Pesce Studio'), 'le pied ne nomme pas le journal');
  assert.ok(serialized.includes('https://journal.test/'), 'aucun lien vers le journal');
  assert.ok(serialized.includes('https://t.me/bot?startapp=support'), 'aucun lien de soutien');
  // Telegraph ne rend que du contenu : uniquement des balises autorisées, jamais de bouton.
  const tags = JSON.stringify(footer).match(/"tag":"(\w+)"/g).map((match) => match.slice(7, -1));
  for (const tag of tags) {
    assert.ok(['hr', 'p', 'strong', 'a', 'em', 'br'].includes(tag), `balise « ${tag} » non rendue par Telegraph`);
  }
  assert.deepEqual(articleFooterNodes({}), [], 'un pied est produit sans aucune adresse');
});

test('pied Telegraph : ajouté en fin d’article, après le corps et les images', () => {
  const cover = { src: '/file/c.jpg', placement: 'cover' };
  const nodes = nodesFromArticle({
    text: 'Premier paragraphe.\n\nSecond paragraphe.',
    images: [cover],
    footer: articleFooterNodes({ journalUrl: 'https://journal.test/', supportUrl: 'https://s.test/', creatorName: 'Pesce Hounyo' }),
  });
  assert.equal(nodes[0].tag, 'figure', 'la couverture n’ouvre plus l’article');
  assert.equal(nodes[nodes.length - 3].tag, 'hr', 'le pied n’est pas en fin d’article');
  assert.ok(footerText(nodes.slice(-2)).includes('https://journal.test/'));
  // Sans pied demandé, l'article est strictement inchangé (aucune régression).
  const bare = nodesFromArticle({ text: 'Premier paragraphe.\n\nSecond paragraphe.', images: [cover] });
  assert.equal(bare.filter((node) => node.tag === 'hr').length, 0, 'un pied s’ajoute sans être demandé');
});

test('reposer le pied ne l’empile jamais, et ne coupe jamais l’article', () => {
  const footer = articleFooterNodes({ journalUrl: 'https://journal.test/', supportUrl: 'https://s.test/', creatorName: 'Pesce Hounyo' });
  const body = [{ tag: 'p', children: ['Corps de l’article.'] }, { tag: 'figure', children: [{ tag: 'img', attrs: { src: '/file/a.jpg' } }] }];

  // Page déjà munie du pied : il est retiré puis reposé — un seul pied au final.
  const withFooter = [...body, ...footer];
  const stripped = stripArticleFooter(withFooter);
  assert.deepEqual(stripped, body, 'le retrait du pied abîme le corps de l’article');
  assert.equal([...stripped, ...footer].filter((node) => node.tag === 'hr').length, 1, 'pied empilé');

  // Page sans pied : rien n'est retiré.
  assert.deepEqual(stripArticleFooter(body), body);

  // Page contenant une ligne de séparation ÉDITORIALE : on n'y touche pas.
  const editorialRule = [...body, { tag: 'hr' }, { tag: 'p', children: ['Encadré de la rédaction.'] }];
  assert.deepEqual(stripArticleFooter(editorialRule), editorialRule, 'une séparation éditoriale a été prise pour un pied');
  assert.deepEqual(stripArticleFooter(null), []);
});

test('rattrapage : rien n’est effacé — le texte écrit est conservé, seul le lien change', () => {
  // Un article ancien porte souvent un chapô sous son titre : c'est de l'éditorial, et c'est
  // aussi ce qui alimente l'extrait des cartes du journal. Le rattrapage ne doit JAMAIS le perdre.
  const post = {
    text: 'LA SOUMISSION PEUT-ELLE ÊTRE UN HÉRITAGE ?\n\nUne enquête sur trois générations, de Cotonou à Porto-Novo.\n\nhttps://telegra.ph/La-soumission-09-12',
  };
  const relinked = relinkedText(post, 'https://t.me/PesceStudioBot?startapp=post_studio_abc');
  assert.ok(relinked.includes('LA SOUMISSION PEUT-ELLE ÊTRE UN HÉRITAGE ?'), 'le titre a été perdu');
  assert.ok(relinked.includes('Une enquête sur trois générations, de Cotonou à Porto-Novo.'), 'le chapô a été perdu');
  assert.ok(!relinked.includes('telegra.ph'), 'l’ancien lien d’hébergement subsiste');
  assert.ok(relinked.endsWith('https://t.me/PesceStudioBot?startapp=post_studio_abc'), 'le lien de lecture est absent');

  // Idempotent : relancer ne double pas le lien et ne grignote pas le texte.
  assert.equal(relinkedText({ text: relinked }, 'https://t.me/PesceStudioBot?startapp=post_studio_abc'), relinked, 'une seconde passe modifie le texte');

  // Publication sans texte : on ne fabrique rien, on pose le lien.
  assert.equal(relinkedText({ text: '' }, 'https://x.test/a'), 'https://x.test/a');
  assert.equal(relinkedText({}, 'https://x.test/a'), 'https://x.test/a');

  // Limite Telegram respectée sans jamais sacrifier le lien.
  const long = relinkedText({ text: 'A'.repeat(4200) }, 'https://x.test/a');
  assert.ok(long.length <= 4096, 'message trop long pour Telegram');
  assert.ok(long.endsWith('https://x.test/a'), 'le lien a été rogné');
});

test('rattrapage : aucune publication n’est retirée, dépubliée ni supprimée', () => {
  const source = read('api/studio.js');
  const block = source.slice(source.indexOf("action === 'relink_articles'"), source.indexOf("action === 'backfill_support'"));
  for (const destructive of ['recallPost', 'deleteDraft', 'DELETE', 'published: false', 'deleteMessage', 'upsertChannelPost']) {
    assert.ok(!block.includes(destructive), `le rattrapage exécute « ${destructive} »`);
  }
  // Les seules écritures possibles sont la liste blanche de updatePost.
  const writes = block.match(/updatePost\(post\.id, ([^)]*)\)/g) || [];
  assert.ok(writes.length > 0, 'le rattrapage n’écrit rien');
  for (const write of writes) {
    assert.ok(/recovered|text: distributionText/.test(write), `écriture inattendue : ${write}`);
  }
});

test('rattrapage : le texte d’un ancien article est rapatrié, sans recopier le pied', () => {
  const source = read('api/studio.js');
  const start = source.indexOf("action === 'relink_articles'");
  assert.ok(start > 0, 'action de rattrapage absente');
  const block = source.slice(start, source.indexOf("action === 'backfill_support'"));

  // Le corps canonique est rapatrié quand il manque : c'est CE qui rend l'ancien article
  // lisible dans le Mini App (sans lui, le lecteur n'aurait que le titre).
  assert.ok(block.includes('if (!post.articleBody)'), 'le texte des anciens articles n’est pas rapatrié');
  assert.ok(block.includes('articleBodyFromPage('), 'le texte n’est pas relu depuis la page');
  assert.ok(block.includes('if (!post.articleImageUrl)'), 'la couverture manquante n’est pas rapatriée');
  // Un corps déjà présent n'est jamais écrasé par la page externe.
  assert.ok(!/articleBody: articleBodyFromPage/.test(block), 'le corps canonique peut être écrasé');

  // Le pied posé par Pesce Studio est retiré AVANT extraction, sinon il finirait dans le corps.
  assert.ok(block.includes('stripArticleFooter(page.content)'), 'le pied serait recopié dans le corps de l’article');
  const stripIndex = block.indexOf('stripArticleFooter(page.content)');
  assert.ok(stripIndex < block.indexOf('articleBodyFromPage('), 'le corps est extrait avant le retrait du pied');

  // Même précaution dans la resynchronisation manuelle d'un article.
  const resync = source.slice(source.indexOf("action === 'resync_message'"), source.indexOf("action === 'article_image_upload'"));
  assert.ok(resync.includes('stripArticleFooter(page.content)'), 'la resynchronisation recopierait le pied dans le corps');
});

// ——————————————————————————————————————————————————————————————————————————
// C. Autorisation : personne ne corrige une publication sans preuve d'identité serveur
// ——————————————————————————————————————————————————————————————————————————

test('article_update : fail-closed sans session (aucune correction par un visiteur)', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: '123456:ABC-TEST_TOKEN', PESCE_CREATOR_TELEGRAM_USER_IDS: undefined }, async () => {
    for (const body of [
      { action: 'article_update', postId: 'studio_x', title: 'T', text: 'Corps' },
      { action: 'article_update', postId: 'studio_x', text: 'Corps' },
    ]) {
      const res = stubRes();
      await studioHandler({ method: 'POST', headers: {}, body }, res);
      assert.equal(res.code, 401, 'correction acceptée sans session');
    }
    // initData falsifiée : toujours refusé.
    const forged = stubRes();
    await studioHandler({ method: 'POST', headers: {}, body: { action: 'article_update', postId: 'x', text: 'y', initData: 'auth_date=1&hash=abcd' } }, forged);
    assert.equal(forged.code, 401, 'initData falsifiée acceptée');
  });
});

test('article_update : sans jeton de bot ni session → 503, jamais d’ouverture par défaut', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: undefined, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined }, async () => {
    const res = stubRes();
    await studioHandler({ method: 'POST', headers: {}, body: { action: 'article_update', postId: 'x', text: 'y' } }, res);
    assert.equal(res.code, 503);
  });
});

// ——————————————————————————————————————————————————————————————————————————
// D. Flux public : jamais de brouillon, jamais de publication retirée
// ——————————————————————————————————————————————————————————————————————————

test('flux public : seules les publications en ligne sont servies (SQL de listChannelPosts)', () => {
  const source = read('lib/db.js');
  const listBlock = source.slice(source.indexOf('export async function listChannelPosts'), source.indexOf('// — Paiements'));
  assert.ok(listBlock.includes('published = true'), 'le flux public pourrait servir une publication non publiée');
  assert.ok(listBlock.includes('source_deleted_at IS NULL'), 'le flux public pourrait servir une publication retirée');
  assert.ok(!/pesce_drafts/.test(listBlock), 'le flux public touche la table des brouillons');
});

test('sérialisation publique : le corps canonique est servi, aucun champ privé ne fuit', () => {
  const serialized = serializePost({
    id: 'studio_abc', contentType: 'text', text: 'Titre\n\nhttps://telegra.ph/T-09-11',
    articleUrl: 'https://telegra.ph/T-09-11', articleBody: 'Corps canonique.',
    articleImageUrl: '/file/cover.jpg', published: true,
    publishedAt: new Date('2026-09-01T10:00:00Z'), updatedAt: new Date('2026-09-05T08:00:00Z'),
  });
  assert.equal(serialized.articleBody, 'Corps canonique.', 'le corps canonique n’est pas servi');
  assert.equal(serialized.publishedAt, '2026-09-01T10:00:00.000Z');
  assert.equal(serialized.updatedAt, '2026-09-05T08:00:00.000Z', 'la date de correction n’est pas servie');
  for (const secret of ['initData', 'token', 'accessToken', 'authorTelegramUserId', 'email']) {
    assert.ok(!(secret in serialized), `champ privé « ${secret} » sérialisé publiquement`);
  }
});

// ——————————————————————————————————————————————————————————————————————————
// E. Liens : un article mène au journal, jamais à une impasse
// ——————————————————————————————————————————————————————————————————————————

test('lien canonique d’article : ouvre le journal sur la publication, partout', () => {
  const link = articleLink('studio_abc_123');
  assert.equal(link, `${PESCE.MINI_APP_URL}?post=studio_abc_123`);
  assert.ok(link.startsWith('https://'), 'lien non absolu : impartageable');
  // Un identifiant à caractères spéciaux reste un lien valide (encodage).
  assert.equal(articleLink('a b/c'), `${PESCE.MINI_APP_URL}?post=a%20b%2Fc`);
  // Ce n'est jamais un lien Telegraph : l'article appartient au journal, pas à son hébergeur.
  assert.ok(!link.includes('telegra.ph'));
});

test('lien profond Telegram : jeu de caractères respecté, repli honnête sinon', () => {
  assert.equal(articleTelegramLink('studio_abc_123'), `${PESCE.BOT_URL}?startapp=post_studio_abc_123`);
  assert.equal(articleTelegramLink('-1001234567890_92'), `${PESCE.BOT_URL}?startapp=post_-1001234567890_92`);
  // Hors du jeu autorisé par Telegram → null (l'appelant retombe sur le lien web).
  assert.equal(articleTelegramLink('a b'), null);
  assert.equal(articleTelegramLink('a/b'), null);
  assert.equal(articleTelegramLink(''), null);
  assert.equal(articleTelegramLink('x'.repeat(60)), null, 'identifiant trop long accepté');
});

test('un article distribué envoie le lecteur DANS le journal, pas sur la page d’hébergement', () => {
  const source = read('api/studio.js');
  // Le texte distribué sur le canal est construit par une seule fonction, à partir du lien de
  // lecture — jamais à partir de l'URL Telegraph.
  const helper = source.slice(source.indexOf('function readLink('), source.indexOf('// Pied des pages Telegraph'));
  assert.ok(helper.includes('articleTelegramLink(postId) || articleLink(postId)'), 'le lien de lecture n’ouvre pas le Mini App');
  assert.ok(helper.includes('function articleDistributionText('), 'aucun texte de distribution dédié');
  assert.ok(!helper.includes('articleUrl'), 'le texte distribué repart de l’URL Telegraph');

  // Les deux chemins (publication et correction) utilisent ce même texte.
  const publish = source.slice(source.indexOf("action === 'article_publish'"), source.indexOf("action === 'article_update'"));
  assert.ok(publish.includes('articleDistributionText(title, id)'), 'la publication distribue encore le lien Telegraph');
  assert.ok(!/text: `\$\{title\}\\n\\n\$\{canonical\.articleUrl/.test(publish), 'lien Telegraph distribué');
  const update = source.slice(source.indexOf("action === 'article_update'"), source.indexOf("action === 'live_rtmp'"));
  assert.ok(update.includes('articleDistributionText(title, post.id)'), 'la correction distribue encore le lien Telegraph');

  // La page Telegraph reste référencée dans Neon : elle héberge toujours l'article et reste
  // proposée en lecture secondaire, elle n'est simplement plus la destination du canal.
  assert.ok(source.includes('articleUrl: page.url'), 'la référence Telegraph a été perdue');
});

test('lecture : le lien de distribution n’apparaît jamais dans le corps lu', async () => {
  await import('../lib/reader-format.js');
  const { readerBody, readerBodySource } = globalThis.PESCE_READER_FORMAT;
  // Forme distribuée désormais : titre + lien profond vers le Mini App.
  const post = {
    text: 'Titre de l’article\n\nhttps://t.me/PesceStudioBot?startapp=post_studio_abc',
    articleBody: 'Premier paragraphe du dossier.\n\nSecond paragraphe du dossier.',
    articleUrl: 'https://telegra.ph/Titre-09-15',
  };
  const html = readerBody(readerBodySource(post));
  assert.ok(html.includes('Premier paragraphe du dossier.'), 'le corps canonique n’est pas lu');
  assert.ok(!html.includes('t.me'), 'le lien de distribution apparaît dans le corps lu');
  assert.ok(!html.includes('telegra.ph'), 'l’URL d’hébergement apparaît dans le corps lu');
  // Ancienne forme (lien Telegraph dans le texte) : toujours filtrée de la même façon.
  const legacy = readerBody(readerBodySource({ text: 'Titre\n\nhttps://telegra.ph/Titre-01-01' }));
  assert.ok(!legacy.includes('telegra.ph'));
});

test('le journal distribue le lien de LECTURE en plus du soutien (clavier de publication)', () => {
  const source = read('api/studio.js');
  assert.ok(source.includes('function postMarkup('), 'aucun clavier de publication dédié');
  const markupBlock = source.slice(source.indexOf('function postMarkup('), source.indexOf('async function telegram('));
  assert.ok(markupBlock.includes('Lire dans Pesce Studio'), 'aucune entrée de lecture dans le journal');
  assert.ok(markupBlock.includes('articleTelegramLink'), 'le lien de lecture n’est pas le lien canonique');
  assert.ok(markupBlock.includes('Soutenir le travail de Pesce'), 'le bouton de soutien a disparu');
  assert.ok(markupBlock.includes('return supportMarkup()'), 'aucun repli quand le lien profond est impossible');
});

test('correction Telegram : le bouton ⭐ Soutenir survit à l’édition du message', () => {
  // editMessageText SANS reply_markup efface le clavier : une correction retirerait le bouton
  // de soutien de la publication (perte d'une relation existante).
  const source = read('api/studio.js');
  for (const marker of ['article_update', 'video_update']) {
    const start = source.indexOf(`action === '${marker}'`);
    assert.ok(start > 0, `action ${marker} absente`);
    const next = source.indexOf("if (action === '", start + 20);
    const block = source.slice(start, next > start ? next : start + 8000);
    const editIndex = block.indexOf("'editMessageText'");
    assert.ok(editIndex > 0, `${marker} n'édite pas la copie Telegram`);
    const call = block.slice(editIndex, editIndex + 500);
    assert.ok(/reply_markup/.test(call), `${marker} : l'édition Telegram efface le clavier de soutien`);
  }
});

// ——————————————————————————————————————————————————————————————————————————
// F. Frontière public / privé et parcours de lecture
// ——————————————————————————————————————————————————————————————————————————

test('le journal public se lit hors Telegram (aucune porte bloquante)', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.ok(!html.includes('id="telegramGate"'), 'la porte bloquante hors Telegram est de retour');
  // Aucun bandeau ajouté en tête : l'onglet « Soutenir » existe déjà dans la navigation et
  // chaque publication du canal porte son bouton de soutien.
  assert.ok(!html.includes('id="webBanner"'), 'bandeau redondant en tête de journal');
  assert.ok(html.includes('data-section="soutenir"'), 'onglet Soutenir absent de la navigation');
  // Les chargeurs de contenu public ne dépendent plus de Telegram.
  for (const loader of ['loadHome', 'loadDirects', 'loadPublications', 'loadPhotos', 'openReader']) {
    const start = app.indexOf(`function ${loader}(`);
    assert.ok(start > 0, `${loader} introuvable`);
    const head = app.slice(start, start + 200);
    assert.ok(!/if \(!inTelegram[^)]*\) return;/.test(head), `${loader} reste conditionné à Telegram`);
  }
  // Les capacités PROPRES à Telegram restent, elles, conditionnées.
  assert.ok(/function trackOpen\(\)[\s\S]{0,120}if \(!inTelegram/.test(app), 'la mesure d’audience n’est plus réservée à Telegram');
  assert.ok(/async function supportWithStars\(\)[\s\S]{0,260}if \(!inTelegram\)/.test(app), 'les Étoiles ne sont plus réservées à Telegram');
});

test('lecteur : découverte d’autres publications, sans l’article courant ni les retraits', () => {
  const app = read('app.js');
  const start = app.indexOf('function readerDiscoveryPosts(');
  assert.ok(start > 0, 'aucune découverte depuis un article');
  const block = app.slice(start, app.indexOf('function readerMedia('));
  assert.ok(block.includes('item.id !== post.id'), 'l’article courant peut se proposer lui-même');
  assert.ok(block.includes('!item.sourceDeletedAt'), 'une publication retirée peut être proposée');
  assert.ok(block.includes('lastFeed'), 'la découverte n’utilise pas le flux public existant');
  assert.ok(!/fetch\(/.test(block), 'la découverte ouvre une source de données parallèle');
  assert.ok(block.includes('Découvrir plus de Pesce'), 'section de découverte absente');
  assert.ok(block.includes('data-reader-home') && block.includes('data-reader-section="ecrits"'), 'aucune sortie explicite vers le journal');
});

test('lecteur : la navigation referme l’article — une surcouche ne bloque jamais les onglets', () => {
  const app = read('app.js');
  const block = app.slice(app.indexOf('function openSection(id) {'), app.indexOf('// — Routage par délégation'));
  // Le lecteur est posé AU-DESSUS des sections : sans fermeture, appuyer sur un onglet
  // changeait bien la section, mais l'article restait à l'écran et rien ne semblait se passer.
  assert.ok(block.includes('if (readerOpen) closeReader();'), 'la navigation laisse le lecteur ouvert par-dessus la section');
  const closeIndex = block.indexOf('closeReader()');
  const sectionIndex = block.indexOf('sections.forEach(');
  assert.ok(closeIndex > 0 && closeIndex < sectionIndex, 'le lecteur est fermé après le changement de section');
});

test('partage : le lien partagé est le lien canonique, jamais l’URL de session Telegram', () => {
  const app = read('app.js');
  const block = app.slice(app.indexOf('function shareArticle('), app.indexOf('function getCachedRole('));
  assert.ok(block.includes('PESCE.articleLink(post.id)'), 'le partage diffuse encore location.href');
  assert.ok(!/const url = window\.location\.href/.test(block), 'URL de session partagée');
});

test('routage : ?post=, ?article=, #post- historique et startapp Telegram mènent tous à l’article', () => {
  const app = read('app.js');
  assert.ok(app.includes('function routeFromQuery('), 'lien ?post= non pris en charge');
  assert.ok(app.includes("query.get('post')"), 'paramètre ?post= non lu');
  assert.ok(app.includes("query.get('article')"), 'lien de retour depuis Telegraph (?article=) non lu');
  assert.ok(app.includes("hash.startsWith('post-')"), 'les ancres #post- déjà partagées ne fonctionnent plus');
  assert.ok(app.includes("startParam.startsWith('post_')"), 'lien profond Telegram vers un article non pris en charge');
  // Un lien venu de Telegraph se résout par le CHEMIN de la page, clé stable dans le temps.
  const resolver = app.slice(app.indexOf('async function openReaderByArticle('), app.indexOf('function routeFromStartParam('));
  assert.ok(resolver.includes('PESCE.telegraphPathOf(post.articleUrl)'), 'la résolution ne passe pas par le chemin Telegraph');
  assert.ok(resolver.includes("fetchJson('./api/content"), 'la résolution n’utilise pas le flux public existant');
});

test('lien de retour depuis Telegraph : chemin stable, jamais l’identifiant de ligne', () => {
  assert.equal(telegraphPathOf('https://telegra.ph/Mon-Article-09-15'), 'Mon-Article-09-15');
  assert.equal(telegraphPathOf('Mon-Article-09-15'), 'Mon-Article-09-15');
  assert.equal(telegraphPathOf('https://telegra.ph/Mon-Article-09-15?x=1#y'), 'Mon-Article-09-15');
  assert.equal(telegraphPathOf(''), '');
  assert.equal(articleLinkFromTelegraph('https://telegra.ph/Mon-Article-09-15'), `${PESCE.MINI_APP_URL}?article=Mon-Article-09-15`);
  // Sans chemin exploitable, on renvoie au journal plutôt qu'à un lien cassé.
  assert.equal(articleLinkFromTelegraph(''), PESCE.MINI_APP_URL);
});

test('frontière : le Studio reste privé, son adresse n’est visible que côté autorisé', () => {
  const publicHtml = read('index.html');
  const publicApp = read('app.js');
  const telegramStudio = read('studio.js');
  // L'adresse du bureau privé n'est PAS annoncée dans l'interface publique…
  assert.ok(!publicHtml.includes('WEB_STUDIO_URL'), 'adresse du bureau privé dans le HTML public');
  assert.ok(!publicApp.includes('WEB_STUDIO_URL'), 'adresse du bureau privé dans le script public');
  // …mais elle l'est dans l'espace créatrice, qui n'est rendu qu'après autorisation serveur.
  assert.ok(telegramStudio.includes('WEB_STUDIO_URL'), 'aucun accès au bureau web depuis l’espace créatrice');
  assert.ok(telegramStudio.includes('Bureau privé sur le web'), 'l’accès au bureau web n’est pas nommé');
  // Le lien « Connexion » public reste un simple lien vers l'écran de connexion.
  assert.ok(publicHtml.includes('href="/studio"'), 'lien Connexion absent');
  assert.equal(WEB_STUDIO_URL, `${PESCE.MINI_APP_URL}studio`, 'adresse canonique du bureau web inattendue');
});

test('studio : « Modifier » est proposé sur les écrits publiés, et met à jour en place', () => {
  const studio = read('studio/web-studio.js');
  assert.ok(studio.includes('function renderEditButton('), 'aucune action de correction dans Écrits');
  assert.ok(studio.includes("action: 'article_update'"), 'la correction ne passe pas par la mise à jour en place');
  assert.ok(studio.includes('Mettre à jour la publication'), 'l’action finale n’est pas nommée « Mettre à jour la publication »');
  // Corriger ne passe jamais par un retrait ni par un brouillon.
  const updateBlock = studio.slice(studio.indexOf('async function updatePublishedPost('), studio.indexOf('async function publishFromStudio('));
  assert.ok(!updateBlock.includes('recall_post'), 'la correction retire la publication');
  assert.ok(!updateBlock.includes("action: 'draft'"), 'la correction repasse par un brouillon');
  assert.ok(!updateBlock.includes("action: 'article_publish'"), 'la correction republie un second article');
  assert.ok(updateBlock.includes('postId: editingPost.id'), 'la correction ne vise pas la publication d’origine');
});
