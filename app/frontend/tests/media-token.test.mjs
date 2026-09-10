// Tests de lib/media-token.js : jetons HMAC signés pour /api/media.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signMedia, verifyMediaToken } from '../lib/media-token.js';

const SECRET = 'secret-de-test';
const FILE_ID = 'AgACAgEAAxkBAAIB6mdx-file';
const NOW = Date.now();

test('aller-retour valide', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, now: NOW });
  assert.equal(verifyMediaToken(FILE_ID, token, { secret: SECRET, now: NOW }), true);
});

test('mauvais fileId → false', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, now: NOW });
  assert.equal(verifyMediaToken('autre-file', token, { secret: SECRET, now: NOW }), false);
});

test('jeton expiré → false', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, ttlSeconds: 3600, now: NOW });
  assert.equal(verifyMediaToken(FILE_ID, token, { secret: SECRET, now: NOW + 3700 * 1000 }), false);
});

test('tolérance d’horloge de 60 s', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, ttlSeconds: 3600, now: NOW });
  assert.equal(verifyMediaToken(FILE_ID, token, { secret: SECRET, now: NOW + (3600 + 30) * 1000 }), true);
});

test('signature altérée → false', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, now: NOW });
  const dot = token.indexOf('.');
  const tampered = `${token.slice(0, dot)}.${'0'.repeat(token.length - dot - 1)}`;
  assert.equal(verifyMediaToken(FILE_ID, tampered, { secret: SECRET, now: NOW }), false);
});

test('mauvais secret → false', () => {
  const token = signMedia(FILE_ID, { secret: SECRET, now: NOW });
  assert.equal(verifyMediaToken(FILE_ID, token, { secret: 'autre-secret', now: NOW }), false);
});

test('jetons malformés → false sans exception', () => {
  assert.equal(verifyMediaToken(FILE_ID, 'x', { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken(FILE_ID, '', { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken(FILE_ID, '.', { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken(FILE_ID, '123.', { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken(FILE_ID, 'abc.def', { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken(FILE_ID, null, { secret: SECRET, now: NOW }), false);
  assert.equal(verifyMediaToken('', signMedia(FILE_ID, { secret: SECRET, now: NOW }), { secret: SECRET, now: NOW }), false);
});

test('signature déterministe pour un now fixe', () => {
  assert.equal(signMedia(FILE_ID, { secret: SECRET, now: NOW }), signMedia(FILE_ID, { secret: SECRET, now: NOW }));
});

test('signMedia sans secret → erreur explicite', () => {
  assert.throws(() => signMedia(FILE_ID, { now: NOW }), /Secret de signature média manquant/);
});
