// Type éditorial « Citations » : une phrase courte + son auteur, sans image ni titre.
//
// Le projet teste la SOURCE de production (contrats et invariants d'identité), pas seulement les
// fonctions pures — ces tests sont donc volontairement des assertions de texte sur les fichiers
// réels, dans le style des autres tests du dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { POST_UPDATABLE_COLUMNS } from '../lib/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(join(here, '..', relative), 'utf8');

const schema = read('lib/schema.js');
const db = read('lib/db.js');
const studio = read('api/studio.js');
const content = read('api/content.js');
const readerFormat = read('lib/reader-format.js');
const app = read('app.js');
const indexHtml = read('index.html');
const webStudio = read('studio/web-studio.js');
const miniStudio = read('studio.js');

// Tranche d'une action : de son marqueur jusqu'au marqueur d'action suivant (ou la fin).
function actionBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `marqueur introuvable : ${marker}`);
  const next = source.indexOf('    if (action === ', start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

// — Schéma et couche de données

test('la migration ajoute la colonne d’attribution, de façon idempotente', () => {
  assert.match(schema, /012_citation_attribution\.sql/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS quote_attribution TEXT/);
  // Aucune migration ne doit contenir de mot de passe (garde-fou projet, dupliqué ici par type).
  assert.doesNotMatch(schema, /password_hash|mot_de_passe/i);
});

test('l’attribution est servie publiquement (sans quoi elle n’existe pour personne)', () => {
  assert.match(db, /quoteAttribution: row\.quote_attribution/);
});

// Le point le plus fragile : ajouter une colonne décale les $n de l'INSERT. Une erreur ici ne
// lève AUCUNE erreur SQL (colonnes nullables) — elle corrompt en silence. On vérifie donc
// mécaniquement que les colonnes et les marqueurs de liaison se correspondent.
test('l’INSERT canonique garde ses colonnes et ses marqueurs alignés', () => {
  const start = db.indexOf('INSERT INTO pesce_posts (');
  assert.notEqual(start, -1, 'INSERT canonique introuvable');
  const end = db.indexOf(') VALUES', start);
  assert.notEqual(end, -1, 'clause VALUES introuvable');
  const columns = db.slice(start, end).split('(')[1].split(',').map((column) => column.trim()).filter(Boolean);
  const valuesLine = db.slice(end + ') VALUES'.length).split('\n')[0];
  const placeholders = [...valuesLine.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));

  assert.ok(columns.includes('quote_attribution'), 'quote_attribution absente des colonnes');
  assert.equal(placeholders.length, columns.length - 1, 'autant de marqueurs que de colonnes (hors updated_at)');
  assert.deepEqual(placeholders, placeholders.map((_, index) => index + 1), 'les marqueurs doivent être contigus');
  // L'ordre des colonnes et l'ordre des paramètres doivent décrire la même liste.
  assert.equal(db.slice(start, end).split('(')[1].trim().startsWith('id,'), true);
});

test('l’attribution n’est jamais effacée par une relecture du canal', () => {
  assert.match(
    db,
    /quote_attribution = COALESCE\(NULLIF\(EXCLUDED\.quote_attribution, ''\), pesce_posts\.quote_attribution\)/
  );
});

test('la course gagnée par le webhook porte l’attribution sur la ligne canonique', () => {
  // La ligne provisoire du Studio — seule à porter l'auteur — est supprimée juste après la fusion.
  assert.match(db, /add\('quote_attribution', provisional\.quoteAttribution\)/);
});

test('le texte d’une citation n’est jamais écrasé par le message du canal', () => {
  assert.match(db, /CASE WHEN content_type = 'citation' THEN text ELSE/);
});

test('l’attribution est corrigeable, le type ne l’est pas', () => {
  assert.equal(POST_UPDATABLE_COLUMNS.quoteAttribution, 'quote_attribution');
  assert.ok(!Object.values(POST_UPDATABLE_COLUMNS).includes('content_type'));
});

test('le studio compte les citations (zéro honnête plutôt que clé absente)', () => {
  assert.match(db, /citation: 0/);
});

// — Serveur : publication

test('la rubrique publique connaît le type citation', () => {
  // Un type inconnu est SILENCIEUSEMENT ignoré : sans cette entrée, ?type=citation renvoie tout.
  assert.match(content, /const CONTENT_TYPES = new Set\(\[[^\]]*'citation'/);
});

test('citation_publish persiste d’abord, distribue ensuite', () => {
  const block = actionBlock(studio, "if (action === 'citation_publish')");
  const persist = block.indexOf('persistCanonicalPost');
  const distribute = block.indexOf('distributePost');
  assert.notEqual(persist, -1, 'persistance canonique absente');
  assert.notEqual(distribute, -1, 'distribution absente');
  assert.ok(persist < distribute, 'le canonique Neon doit précéder la distribution Telegram');
});

test('citation_publish ne recopie jamais le message distribué dans le texte canonique', () => {
  const block = actionBlock(studio, "if (action === 'citation_publish')");
  // `text` EST la citation lue par le lecteur : y recopier le message du canal afficherait
  // l'attribution en double et ferait entrer le lien de distribution dans la citation publique.
  assert.match(block, /mirrorText: false/);
  assert.doesNotMatch(block, /text: citationDistributionText/);
});

test('citation_publish refuse une citation sans auteur ou trop longue, sans rien persister', () => {
  const block = actionBlock(studio, "if (action === 'citation_publish')");
  const firstPersist = block.indexOf('persistCanonicalPost');
  const validation = block.slice(0, firstPersist);
  assert.match(validation, /MAX_CITATION_QUOTE_LENGTH/);
  assert.match(validation, /MAX_CITATION_ATTRIBUTION_LENGTH/);
  assert.match(validation, /400/, 'les refus doivent être des 400 éditoriaux');
  // Refus franc, jamais de troncature silencieuse.
  assert.doesNotMatch(block, /slice\(0, MAX_CITATION_QUOTE_LENGTH\)/);
});

// — Serveur : correction en place

test('une citation se corrige en place, jamais par retrait + republication', () => {
  const block = actionBlock(studio, "if (action === 'article_update')");
  assert.match(block, /'citation'/, 'la garde de type doit accepter les citations');
  assert.match(block, /isCitation/);
  assert.match(block, /quoteAttribution: attribution/);
  // L'identité et le message Telegram survivent à la correction.
  assert.match(block, /reply_markup: postMarkup\(post\.id\)/);
  assert.match(block, /editMessageText/);
  // Garde-fous « jamais recréer » (miroir du test existant sur relink_articles).
  assert.doesNotMatch(block, /recall_post/);
  assert.doesNotMatch(block, /article_publish/);
  assert.doesNotMatch(block, /published: false/);
  assert.doesNotMatch(block, /upsertChannelPost/);
});

test('la correction d’une citation garde le rendu de distribution de la publication', () => {
  const block = actionBlock(studio, "if (action === 'article_update')");
  assert.match(block, /citationDistributionText\(text, attribution, post\.id\)/);
});

// — Rendu public

test('le lecteur rend une citation comme une citation attribuée, échappée', () => {
  assert.match(readerFormat, /citationReaderBody/);
  assert.match(readerFormat, /blockquote/);
  assert.match(readerFormat, /figcaption/);
  assert.match(readerFormat, /PESCE_READER_FORMAT = \{ escapeHtml, readerBody, readerBodySource, citationReaderBody \}/);
});

test('le Mini App étiquette et rubrique les citations', () => {
  assert.match(app, /citation: 'Citation'/);
  assert.match(app, /citation: \{ category: 'CITATION'/);
  assert.match(app, /citations: \{ label: 'Citations', type: 'citation' \}/);
  assert.match(indexHtml, /data-filter="citations"/);
  assert.match(app, /ecrits-\(tout\|enquetes\|societe\|opinion\|videos\|audios\|entretiens\|citations\)/);
});

test('le bandeau du lecteur annonce ce qu’on lit réellement', () => {
  assert.match(indexHtml, /id="readerDocLabel"/);
  assert.match(app, /readerDocLabel/);
  assert.match(app, /'Lecture Citation' : 'Lecture Article'/);
});

test('une citation ne prend jamais la une du journal ni de l’accueil', () => {
  // Le filtre de une écarte les citations SANS écarter document/other.
  const guards = app.match(/hasText\(post\) && post\.contentType !== 'citation'/g) || [];
  assert.equal(guards.length, 2, 'les deux compositions de une (accueil + journal) doivent exclure les citations');
  assert.doesNotMatch(app, /posts\.filter\(\(post\) => post\.contentType === 'text'\)/);
});

// — Studio

test('les deux pupitres proposent le type Citations', () => {
  for (const [name, source] of [['studio.js', miniStudio], ['web-studio.js', webStudio]]) {
    assert.match(source, /label: 'Citations'/, `${name} doit proposer le type Citations`);
    assert.match(source, /citationAttribution/, `${name} doit porter le champ auteur`);
  }
});

test('le champ auteur est basculé par visibilité, sans re-rendre le pupitre', () => {
  // Re-rendre le volet au clic d'une pastille effacerait le texte déjà tapé.
  assert.match(webStudio, /function applyFormatVisibility/);
  assert.match(webStudio, /kind === 'citation'/);
});

test('le Studio route une citation vers citation_publish', () => {
  assert.match(webStudio, /action: 'citation_publish'/);
  assert.match(webStudio, /quoteAttribution/);
});

test('une citation publiée reste corrigeable depuis « Écrits »', () => {
  assert.match(webStudio, /\['text', 'document', 'other', 'citation'\]/);
  // Le bouton « Modifier » doit mener à la correction en place, jamais à une republication.
  assert.match(webStudio, /action: 'article_update'/);
});
