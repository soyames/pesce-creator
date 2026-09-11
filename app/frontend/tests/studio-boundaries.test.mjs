// Garde-fous de séparation public/privé : l'espace Studio créatrice ne doit JAMAIS être
// exposé dans l'interface publique, et le Studio privé ne doit contenir ni fonctionnalités
// inventées ni données fictives en dur. Les fichiers de développement (scripts/, tests/,
// fixtures) sont exclus par conception.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const frontendDir = fileURLToPath(new URL('..', import.meta.url));

const PRODUCTION_FILES = ['index.html', 'app.js', 'studio.js', 'styles.css', 'studio.css', 'constants.js'];
const production = Object.fromEntries(PRODUCTION_FILES.map((name) => [name, readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8')]));

test('aucune affordance Studio dans la navigation publique', () => {
  // L'interface publique ne propose ni bouton, ni onglet, ni section « Studio ».
  assert.ok(!/data-section="studio"/.test(production['index.html']), 'aucun onglet Studio public');
  assert.ok(!production['index.html'].includes('>Studio<'), 'aucun libellé « Studio » dans la nav publique');
  assert.ok(!production['index.html'].includes('Studio Privé'), 'aucune bascule « Studio Privé » publique');
  const sectionsList = production['app.js'].match(/const SECTIONS = \[([^\]]*)\]/);
  assert.ok(sectionsList && !sectionsList[1].includes("'studio'"), '« studio » absent de la liste des sections publiques (app.js)');
});

test('la navigation publique conserve les parcours publics', () => {
  for (const label of ['À la une', 'Écrits', 'Directs', 'Photos', 'Soutenir']) {
    assert.ok(production['index.html'].includes(`>${label}<`), `nav publique : « ${label} » présent`);
  }
});

test('l’accès « Connexion » est un simple lien discret, jamais un onglet Studio public', () => {
  assert.ok(production['index.html'].includes('href="/studio"'), 'lien Connexion absent');
  assert.ok(production['index.html'].includes('>Connexion<'), 'libellé Connexion absent');
  assert.ok(!/data-section="studio"/.test(production['index.html']), 'aucun onglet Studio ajouté');
});

test('le Studio reste une surcouche privée, ouverte par le mécanisme créatrice existant', () => {
  assert.ok(production['index.html'].includes('id="studioScreen"'), 'surcouche studio dans la coquille');
  assert.ok(production['index.html'].includes('Bureau Privé'), 'badge privé du studio');
  assert.ok(production['index.html'].includes('data-studio-tab="bureau"'), 'onglet Bureau du studio');
  assert.ok(production['index.html'].includes('studioBackToJournal'), 'retour « Journal » du studio');
  assert.ok(production['app.js'].includes("startParam === 'studio'"), 'entrée via le deep link ?startapp=studio');
  assert.ok(production['studio.js'].includes("fetch('./api/studio'"), 'le studio sonde /api/studio avant toute ouverture (serveur = frontière)');
});

test('aucun concept inventé dans l’interface de production', () => {
  const banned = [/coffre sécurisé/i, /informateur/i, /whistleblower/i, /\bPGP\b/, /pièces? de preuves?/i, /Gestionnaire de dépêches/i, /Sauvegardé auto/i, /vault/i];
  const offenders = [];
  for (const [file, content] of Object.entries(production)) {
    for (const pattern of banned) {
      if (pattern.test(content)) offenders.push(`${file} → ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('aucune donnée fictive codée en dur dans l’interface de production', () => {
  const banned = ['14 850', '14 200', '1 840', '480 publications', '480 archives', '4 210', '2 890', '74 %', 'Édition N°', '24 Questions', '3 informateurs', '1 240', '+1 250', '+320 ce mois'];
  const offenders = [];
  for (const [file, content] of Object.entries(production)) {
    for (const literal of banned) {
      if (content.includes(literal)) offenders.push(`${file} → ${literal}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('les onglets du Studio privé correspondent à la navigation prescrite', () => {
  for (const tab of ['bureau', 'rediger', 'brouillons', 'pistes', 'audience']) {
    assert.ok(production['index.html'].includes(`data-studio-tab="${tab}"`), `onglet studio « ${tab} » présent`);
  }
  for (const term of ['Messages &amp; demandes', 'Messages des lecteurs', 'Articles Telegraph', 'Médiathèque']) {
    assert.ok(production['studio.js'].includes(term), `terminologie corrigée : « ${term} »`);
  }
});

test('le studio publicitaire n’expose pas de fausses capacités d’upload ou de preuves', () => {
  assert.ok(!production['studio.js'].includes('Verser une nouvelle pièce'), 'aucun upload inventé');
  assert.ok(!production['studio.js'].includes('AES'), 'aucune allégation de chiffrement inventée');
});
