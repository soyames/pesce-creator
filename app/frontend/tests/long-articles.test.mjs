import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodesFromArticle, telegraphContentFits } from '../lib/telegraph.js';
import { serializePost } from '../api/content.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

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
