// Tests de la façade MTProto : fail-closed absolu sans configuration, aucun secret dans le code
// public, et les routes RTMP restent hors de portée de toute surface publique.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getChannelLiveState, getChannelRtmp, mtProtoConfigured } from '../lib/mtproto.js';

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

test('mtProtoConfigured : exige les trois variables de session', () => {
  assert.equal(mtProtoConfigured({}), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1' }), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1', PESCE_MT_PROTO_API_HASH: 'x' }), false);
  assert.equal(mtProtoConfigured({ PESCE_MT_PROTO_API_ID: '1', PESCE_MT_PROTO_API_HASH: 'x', PESCE_MT_PROTO_SESSION: 's' }), true);
});

test('getChannelRtmp : refus explicite sans configuration (jamais d’identifiants fabriqués)', async () => {
  await withEnv({ PESCE_MT_PROTO_API_ID: undefined, PESCE_MT_PROTO_API_HASH: undefined, PESCE_MT_PROTO_SESSION: undefined }, async () => {
    await assert.rejects(() => getChannelRtmp({ channelUsername: 'PesceHounyoOfficiel' }), /MTProto non configuré/);
    await assert.rejects(() => getChannelLiveState({ channelUsername: 'PesceHounyoOfficiel' }), /MTProto non configuré/);
  });
});

test('aucun secret ni identifiant RTMP dans les surfaces publiques', () => {
  const publicFiles = ['../app.js', '../index.html', '../constants.js', '../privacy/index.html'];
  for (const file of publicFiles) {
    const content = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    assert.ok(!content.includes('PESCE_MT_PROTO_SESSION'), `session MTProto exposée dans ${file}`);
    assert.ok(!content.includes('PESCE_MT_PROTO_API_HASH'), `hash MTProto exposé dans ${file}`);
    assert.ok(!/RTMP|stream.?key|clé de stream/i.test(content), `référence RTMP publique dans ${file}`);
  }
});

test('la session MTProto n’est jamais écrite dans le dépôt', () => {
  const setup = readFileSync(fileURLToPath(new URL('../scripts/mtproto-setup.mjs', import.meta.url)), 'utf8');
  assert.ok(setup.includes('console.log'), 'script de configuration présent');
  assert.ok(!/PESCE_MT_PROTO_SESSION\s*=\s*['"][A-Za-z0-9]/.test(setup), 'session codée en dur dans le script de configuration');
  assert.ok(setup.includes('client.session.save()'), 'la session doit être produite dynamiquement par la connexion');
});
