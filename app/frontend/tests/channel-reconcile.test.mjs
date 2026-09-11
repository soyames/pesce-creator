// Tests de la réconciliation avec le canal (source éditoriale de vérité) : seuls les messages
// couverts par la fenêtre lue ET absents de l'aperçu sont marqués supprimés ; un échec ou un
// aperçu vide ne modifie jamais l'état existant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRemovedMessageIds, extractMessageIdsFromPreview } from '../lib/channel-reconcile.js';

const rows = (ids) => ids.map((id) => ({ id: `chat_${id}`, messageId: id }));

test('extractMessageIdsFromPreview : data-post du canal, dédupliqués', () => {
  const html = '<div data-post="PesceHounyoOfficiel/8">…</div><div data-post="PesceHounyoOfficiel/9">…</div><div data-post="PesceHounyoOfficiel/8">…</div>';
  assert.deepEqual(extractMessageIdsFromPreview(html), [8, 9]);
  assert.deepEqual(extractMessageIdsFromPreview('rien'), []);
});

test('extractMessageIdsFromPreview : garde d’identité — une page parasite ne forme pas de fenêtre', () => {
  // Sans filtre d'identité, une page d'une AUTRE chaîne (mur de connexion, recommandations)
  // fournirait des identifiants qui pourraient couvrir — et donc marquer — nos lignes.
  const foreign = '<div data-post="AutreChaine/3">…</div><div data-post="AutreChaine/4">…</div>';
  assert.deepEqual(extractMessageIdsFromPreview(foreign, { username: 'PesceHounyoOfficiel' }), [], 'page parasite comptée comme fenêtre');
  const mixed = '<div data-post="AutreChaine/3">…</div><div data-post="PesceHounyoOfficiel/8">…</div>';
  assert.deepEqual(extractMessageIdsFromPreview(mixed, { username: 'PesceHounyoOfficiel' }), [8], 'filtrage par canal absent');
  // Sans nom de canal fourni, l'ancien comportement (compatibilité des appels hérités) demeure.
  assert.deepEqual(extractMessageIdsFromPreview(foreign), [3, 4]);
});

test('computeRemovedMessageIds : seuls les messages couverts et absents sont supprimés', () => {
  const fetched = [6, 8, 9, 10, 11];
  // 3,4,5 sont HORS fenêtre [6,11] : intouchés (on ne peut rien affirmer hors fenêtre).
  // 7 est DANS la fenêtre et absent de l'aperçu : marqué (supprimé — l'aperçu n'a pas de trous pour des posts).
  // 6 est présent dans la fenêtre : conservé.
  const removed = computeRemovedMessageIds(rows([3, 4, 5, 6, 7, 8, 11]), fetched);
  assert.deepEqual(removed, ['chat_7']);
});

test('computeRemovedMessageIds : sécurité — aucun état modifié sans données fiables', () => {
  assert.deepEqual(computeRemovedMessageIds(rows([3, 4, 5]), []), [], 'aperçu vide interprété comme suppression totale');
  assert.deepEqual(computeRemovedMessageIds([], [8, 9]), []);
  assert.deepEqual(computeRemovedMessageIds(rows([3]), null), []);
  // Présents dans l'aperçu → jamais supprimés.
  assert.deepEqual(computeRemovedMessageIds(rows([8, 9, 11]), [8, 9, 11]), []);
});
