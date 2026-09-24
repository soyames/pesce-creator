import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodesFromArticle, telegraphContentFits } from '../lib/telegraph.js';
import { serializePost } from '../api/content.js';
import PESCE from '../lib/config.js';
import { writtenPublicationRoute } from '../api/studio.js';
import '../lib/reader-format.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

test('long untitled text becomes an article without truncation or required cover', () => {
  const body = `Première ligne de l'article\n\n${'paragraphe '.repeat(12000)}\n\nDernière phrase.`;
  assert.ok(body.length > 100000);
  assert.deepEqual(writtenPublicationRoute('publish', { text: body }), {
    action: 'article_publish', title: "Première ligne de l'article",
  });
  assert.deepEqual(writtenPublicationRoute('publish', { text: 'Brève dépêche' }), {
    action: 'publish', title: undefined,
  });
  assert.equal(writtenPublicationRoute('article_publish', { title: 'Titre original', text: body }).title, 'Titre original');
  const api = read('api/studio.js');
  const article = api.slice(api.indexOf("if (action === 'article_publish')"), api.indexOf("if (action === 'article_update')"));
  assert.match(article, /articleBody: text/);
  assert.match(article, /articleImageUrl: cover\?\.src \|\| null/);
  assert.doesNotMatch(article, /if \(!cover\)/);
  assert.doesNotMatch(read('studio/web-studio.js'), /if \(title && !images\.some/);
  assert.match(read('studio/web-studio.js'), /title \|\| text\.length > 4096 \? \{ images \}/);
});

test('long article: both editors accept it and publication, draft and update retain the body', () => {
  for (const editor of ['studio.js', 'studio/web-studio.js']) {
    assert.match(read(editor), /<textarea id="publishText"[^>]+required><\/textarea>/);
    assert.doesNotMatch(read(editor), /<textarea id="publishText"[^>]+maxlength=/);
  }
  const api = read('api/studio.js');
  for (const action of ['article_publish', 'article_update', 'draft']) {
    const start = api.indexOf(`if (action === '${action}')`);
    const next = api.indexOf("if (action === '", start + 1);
    const block = api.slice(start, next === -1 ? undefined : next);
    assert.ok(start !== -1, `${action} missing`);
    assert.doesNotMatch(block, /body\.text[^\n]*slice\(0, 4096\)/, `${action} truncates text`);
  }
  const longText = ['Éditorial '.repeat(700), 'Dernier paragraphe.'].join('\n\n');
  assert.ok(longText.length > 4096);
  const nodes = nodesFromArticle({ text: longText });
  assert.ok(telegraphContentFits(nodes));
  assert.ok(JSON.stringify(nodes).includes('Dernier paragraphe.'));
  assert.equal(serializePost({ articleBody: longText }).articleBody, longText);
});

test('Telegraph capacity is measured in UTF-8 bytes including page structure', () => {
  assert.equal(telegraphContentFits(nodesFromArticle({ text: 'É'.repeat(20000) })), true);
  assert.equal(telegraphContentFits(nodesFromArticle({ text: 'É'.repeat(40000) })), false);
});

test('native article: 100,000 characters and inline illustrations remain readable at its canonical link', () => {
  const body = `Début de l’enquête.\n\n${'Une analyse approfondie. '.repeat(5000)}\n\nFin de l’enquête.`;
  const articleImages = [
    { placement: 'cover', src: 'https://telegra.ph/file/cover.jpg' },
    { placement: 'inline', afterParagraph: 2, src: 'https://telegra.ph/file/photo.jpg', caption: '<Source>' },
  ];
  assert.ok(body.length > 100000);
  const post = serializePost({ id: 'studio_long', text: 'Longue enquête', articleBody: body, articleImages });
  assert.equal(post.articleBody, body);
  assert.deepEqual(post.articleImages, articleImages);
  assert.equal(PESCE.articleLink(post.id), `${PESCE.MINI_APP_URL}?post=studio_long`);
  const { readerBody, readerBodySource } = globalThis.PESCE_READER_FORMAT;
  const html = readerBody(readerBodySource(post), post.articleImages);
  assert.ok(html.includes('Début de l’enquête.'));
  assert.ok(html.includes('Fin de l’enquête.'));
  assert.ok(html.includes('file/photo.jpg'));
  assert.ok(html.includes('&lt;Source&gt;'));
  assert.ok(!html.includes('<Source>'));
});
