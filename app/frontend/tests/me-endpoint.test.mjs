// Tests de sécurité du point de terminaison /api/me (rôle utilisateur) :
// fail-closed, 401/503, aucune dépendance de base de données, aucun secret renvoyé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/me.js';

const BOT_TOKEN = '123456:ABC-TEST_TOKEN';

function signInit(params, token = BOT_TOKEN) {
  const dataCheckString = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

function validInit(userId = 123456789) {
  return signInit({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Pesce', username: 'pescehounyo', language_code: 'fr' }),
    query_id: 'AAHqTest',
  });
}

function stubRes() {
  return {
    code: 0,
    body: null,
    headers: {},
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

test('méthode non GET → 405', async () => {
  const res = stubRes();
  await handler({ method: 'POST', headers: {} }, res);
  assert.equal(res.code, 405);
});

test('token du bot manquant → 503, isCreator:false (fail-closed)', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: undefined, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 503);
    assert.equal(res.body.isCreator, false);
  });
});

test('sans initData → 401, isCreator:false', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: {} }, res);
    assert.equal(res.code, 401);
    assert.equal(res.body.isCreator, false);
  });
});

test('initData falsifiée → 401', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: '123456789' }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: { 'x-telegram-init-data': 'auth_date=1&hash=abcd' } }, res);
    assert.equal(res.code, 401);
  });
});

test('utilisateur valide, aucune créatrice configurée → 200 isCreator:false, creatorConfigured:false', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined, PESCE_CREATOR_TELEGRAM_USER_ID: undefined }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: { 'x-telegram-init-data': validInit() } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.isCreator, false);
    assert.equal(res.body.creatorConfigured, false);
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });
});

test('créatrice valide → 200 isCreator:true, champs utilisateur', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: '123456789' }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: { 'x-telegram-init-data': validInit(123456789) } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.isCreator, true);
    assert.equal(res.body.creatorConfigured, true);
    assert.equal(res.body.user.id, 123456789);
    assert.equal(res.body.user.username, 'pescehounyo');
  });
});

test('utilisateur non créatrice avec allowlist configurée → 200 isCreator:false', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: '123456789' }, async () => {
    const res = stubRes();
    await handler({ method: 'GET', headers: { 'x-telegram-init-data': validInit(999) } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.isCreator, false);
    assert.equal(res.body.creatorConfigured, true);
  });
});
