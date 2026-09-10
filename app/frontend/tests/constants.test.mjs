// Tests des constantes partagées : cohérence interne + garde anti-duplication des identifiants dans le code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PESCE, { CHANNEL_URL, CHANNEL_USERNAME, STAR_TIERS, STUDIO_URL, SUPPORT_URL, SUPPORT_TOPICS, YOUTUBE_HANDLE, YOUTUBE_URL } from '../lib/config.js';

test('PESCE existe, est gelé et complet', () => {
  assert.ok(PESCE);
  assert.equal(Object.isFrozen(PESCE), true);
  for (const key of ['APP_NAME', 'CREATOR_NAME', 'TAGLINE', 'BOT_USERNAME', 'BOT_URL', 'CHANNEL_USERNAME', 'CHANNEL_HANDLE', 'CHANNEL_URL', 'SUPPORT_URL', 'STUDIO_URL', 'MINI_APP_URL', 'YOUTUBE_HANDLE', 'YOUTUBE_URL', 'STAR_TIERS', 'SUPPORT_TOPICS']) {
    assert.ok(PESCE[key], `PESCE.${key} manquant`);
  }
});

test('STAR_TIERS : montants 50/100/250/500/1000, libellés uniques', () => {
  assert.deepEqual(STAR_TIERS.map((tier) => tier.amount), [50, 100, 250, 500, 1000]);
  const labels = STAR_TIERS.map((tier) => tier.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => label.length > 0));
});

test('URLs cohérentes entre elles', () => {
  assert.equal(CHANNEL_URL, `https://t.me/${CHANNEL_USERNAME}`);
  assert.ok(SUPPORT_URL.endsWith('?startapp=support'));
  assert.ok(STUDIO_URL.endsWith('?startapp=studio'));
  assert.ok(YOUTUBE_URL.includes(YOUTUBE_HANDLE));
});

test('SUPPORT_TOPICS : valeurs uniques, libellés non vides', () => {
  const values = SUPPORT_TOPICS.map((topic) => topic.value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(SUPPORT_TOPICS.every((topic) => topic.label.length > 0));
});

// Garde anti-duplication : les identifiants Pesce ne doivent plus être écrits en dur dans le code,
// uniquement dans constants.js (la prose HTML et les commentaires restent exclus par conception).
const FORBIDDEN_LITERALS = ['PesceHounyoOfficiel', 'PesceStudioBot', 'gnonnouxopescehounyo', '121 vidéos'];

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function collectJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === 'node_modules' || entry === '.git' || entry === '.vercel') continue;
      files.push(...collectJsFiles(full));
    } else if (/\.(js|mjs)$/.test(entry) && entry !== 'constants.js') {
      files.push(full);
    }
  }
  return files;
}

test('aucun identifiant Pesce écrit en dur hors de constants.js', () => {
  const frontendDir = fileURLToPath(new URL('..', import.meta.url));
  const offenders = [];
  for (const file of collectJsFiles(frontendDir)) {
    const content = stripComments(readFileSync(file, 'utf8'));
    for (const literal of FORBIDDEN_LITERALS) {
      if (content.includes(literal)) offenders.push(`${file} → ${literal}`);
    }
  }
  assert.deepEqual(offenders, []);
});
