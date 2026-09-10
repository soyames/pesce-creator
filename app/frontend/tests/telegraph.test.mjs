// Tests de lib/telegraph.js (parties pures) : conversion texte simple → nœuds Telegraph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodesFromPlainText } from '../lib/telegraph.js';

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
