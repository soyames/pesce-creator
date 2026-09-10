// Tests fail-closed des endpoints publics (aucun accès réseau ni base de données requis) :
// méthodes refusées, token manquant, initData invalide, jeton média invalide, événement hors liste blanche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mediaHandler from '../api/media.js';
import invoiceHandler from '../api/create-invoice.js';
import supportHandler from '../api/support.js';
import trackHandler from '../api/track.js';
import webhookHandler from '../api/telegram-pesce-studio.webhook.js';

const BOT_TOKEN = '123456:ABC-TEST_TOKEN';

function signInit(params, token = BOT_TOKEN) {
  const dataCheckString = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

function validInit() {
  return signInit({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 123456789, first_name: 'Pesce', username: 'pescehounyo' }),
    query_id: 'AAHqTest',
  });
}

function stubRes() {
  return {
    code: 0, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
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

const BASE_ENV = { TELEGRAM_PESCE_BOT_TOKEN: BOT_TOKEN, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined, TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET: undefined, PESCE_MEDIA_SIGNING_SECRET: undefined };

test('media : GET seul accepté → 405', async () => {
  const res = stubRes();
  await mediaHandler({ method: 'POST', query: {} }, res);
  assert.equal(res.code, 405);
});

test('media : file_id manquant → 400', async () => {
  await withEnv(BASE_ENV, async () => {
    const res = stubRes();
    await mediaHandler({ method: 'GET', query: {} }, res);
    assert.equal(res.code, 400);
  });
});

test('media : jeton manquant/invalide → 403 (aucun accès réseau)', async () => {
  await withEnv(BASE_ENV, async () => {
    const res = stubRes();
    await mediaHandler({ method: 'GET', query: { file_id: 'probe' } }, res);
    assert.equal(res.code, 403);
    const forged = stubRes();
    await mediaHandler({ method: 'GET', query: { file_id: 'probe', token: '1234567890.deadbeef' } }, forged);
    assert.equal(forged.code, 403);
  });
});

test('create-invoice : GET → 405, token manquant → 503, initData invalide → 401', async () => {
  const getRes = stubRes();
  await invoiceHandler({ method: 'GET', body: {} }, getRes);
  assert.equal(getRes.code, 405);
  await withEnv({ ...BASE_ENV, TELEGRAM_PESCE_BOT_TOKEN: undefined }, async () => {
    const res = stubRes();
    await invoiceHandler({ method: 'POST', body: {} }, res);
    assert.equal(res.code, 503);
  });
  await withEnv(BASE_ENV, async () => {
    const res = stubRes();
    await invoiceHandler({ method: 'POST', body: { stars: 100, initData: 'auth_date=1&hash=abcd' } }, res);
    assert.equal(res.code, 401);
  });
});

test('support : GET → 405, token manquant → 503, initData invalide → 401', async () => {
  const getRes = stubRes();
  await supportHandler({ method: 'GET', body: {} }, getRes);
  assert.equal(getRes.code, 405);
  await withEnv({ ...BASE_ENV, TELEGRAM_PESCE_BOT_TOKEN: undefined }, async () => {
    const res = stubRes();
    await supportHandler({ method: 'POST', body: {} }, res);
    assert.equal(res.code, 503);
  });
  await withEnv(BASE_ENV, async () => {
    const res = stubRes();
    await supportHandler({ method: 'POST', body: { message: 'x', initData: 'auth_date=1&hash=abcd' } }, res);
    assert.equal(res.code, 401);
  });
});

test('track : GET → 405, token manquant → 503, initData invalide → 401, événement hors liste blanche → 400', async () => {
  const getRes = stubRes();
  await trackHandler({ method: 'GET', body: {} }, getRes);
  assert.equal(getRes.code, 405);
  await withEnv({ ...BASE_ENV, TELEGRAM_PESCE_BOT_TOKEN: undefined }, async () => {
    const res = stubRes();
    await trackHandler({ method: 'POST', body: {} }, res);
    assert.equal(res.code, 503);
  });
  await withEnv(BASE_ENV, async () => {
    const badAuth = stubRes();
    await trackHandler({ method: 'POST', body: { event: 'open', initData: 'auth_date=1&hash=abcd' } }, badAuth);
    assert.equal(badAuth.code, 401);
    const badEvent = stubRes();
    await trackHandler({ method: 'POST', body: { event: 'bogus', initData: validInit() } }, badEvent);
    assert.equal(badEvent.code, 400, 'événement hors liste blanche accepté');
  });
});

test('webhook : GET → 405, secret manquant → 503 (fail-closed), secret invalide → 401', async () => {
  const getRes = stubRes();
  await webhookHandler({ method: 'GET', body: {} }, getRes);
  assert.equal(getRes.code, 405);
  await withEnv({ ...BASE_ENV, TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET: undefined }, async () => {
    const res = stubRes();
    await webhookHandler({ method: 'POST', headers: {}, body: { update_id: 1 } }, res);
    assert.equal(res.code, 503, 'webhook accepté sans secret configuré');
  });
  await withEnv({ ...BASE_ENV, TELEGRAM_PESCE_STUDIO_WEBHOOK_SECRET: 'secret-env' }, async () => {
    const noHeader = stubRes();
    await webhookHandler({ method: 'POST', headers: {}, body: { update_id: 1 } }, noHeader);
    assert.equal(noHeader.code, 401);
    const wrongHeader = stubRes();
    await webhookHandler({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'mauvais' }, body: { update_id: 1 } }, wrongHeader);
    assert.equal(wrongHeader.code, 401);
  });
});
