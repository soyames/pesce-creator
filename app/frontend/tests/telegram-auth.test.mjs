// Tests de lib/telegram-auth.js : validation HMAC des initData Telegram et liste des identifiants créatrice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { creatorTelegramUserIds, isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';

const BOT_TOKEN = '123456:ABC-TEST_TOKEN';

// Reproduit la signature Telegram : secret = HMAC_SHA256('WebAppData', botToken), hash = HMAC(secret, data_check_string).
function signInit(params, token = BOT_TOKEN) {
  const dataCheckString = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  const all = new URLSearchParams({ ...params, hash });
  return all.toString();
}

function validParams(overrides = {}) {
  return {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 123456789, first_name: 'Pesce', username: 'pescehounyo' }),
    query_id: 'AAHqTest',
    ...overrides,
  };
}

test('initData valide → true', () => {
  assert.equal(validateTelegramInitData(signInit(validParams()), BOT_TOKEN), true);
});

test('initData falsifiée (user modifié après signature) → false', () => {
  const signed = signInit(validParams());
  const params = new URLSearchParams(signed);
  params.set('user', JSON.stringify({ id: 999 }));
  assert.equal(validateTelegramInitData(params.toString(), BOT_TOKEN), false);
});

test('auth_date altéré après signature → false', () => {
  const signed = signInit(validParams());
  const params = new URLSearchParams(signed);
  params.set('auth_date', String(Math.floor(Date.now() / 1000) - 100));
  assert.equal(validateTelegramInitData(params.toString(), BOT_TOKEN), false);
});

test('auth_date vieux de 25 h → false (fenêtre de 24 h)', () => {
  const params = validParams({ auth_date: String(Math.floor(Date.now() / 1000) - 25 * 3600) });
  assert.equal(validateTelegramInitData(signInit(params), BOT_TOKEN), false);
});

test('maxAgeSeconds personnalisé respecté', () => {
  const params = validParams({ auth_date: String(Math.floor(Date.now() / 1000) - 120) });
  assert.equal(validateTelegramInitData(signInit(params), BOT_TOKEN, 300), true);
  assert.equal(validateTelegramInitData(signInit(params), BOT_TOKEN, 60), false);
});

test('tolérance d’horloge : +30 s ok, +120 s refusé', () => {
  const late = validParams({ auth_date: String(Math.floor(Date.now() / 1000) + 30) });
  const tooLate = validParams({ auth_date: String(Math.floor(Date.now() / 1000) + 120) });
  assert.equal(validateTelegramInitData(signInit(late), BOT_TOKEN), true);
  assert.equal(validateTelegramInitData(signInit(tooLate), BOT_TOKEN), false);
});

test('entrées invalides → false', () => {
  assert.equal(validateTelegramInitData('', BOT_TOKEN), false);
  assert.equal(validateTelegramInitData(signInit(validParams()), ''), false);
  assert.equal(validateTelegramInitData(null, BOT_TOKEN), false);
  const noHash = signInit(validParams()).replace(/&?hash=[^&]*/, '');
  assert.equal(validateTelegramInitData(noHash, BOT_TOKEN), false);
  const noAuthDate = signInit({ user: JSON.stringify({ id: 1 }) });
  assert.equal(validateTelegramInitData(noAuthDate, BOT_TOKEN), false);
});

test('hash corrompu (courbe timingSafeEqual) → false', () => {
  const signed = signInit(validParams());
  assert.equal(validateTelegramInitData(`${signed.slice(0, -4)}zzzz`, BOT_TOKEN), false);
});

test('telegramUserFromInitData : valide, absent, malformé', () => {
  const user = telegramUserFromInitData(signInit(validParams()));
  assert.equal(user.id, 123456789);
  assert.equal(user.first_name, 'Pesce');
  assert.equal(telegramUserFromInitData(signInit({ auth_date: '123' })), null);
  assert.equal(telegramUserFromInitData(signInit(validParams({ user: '{pas du json' }))), null);
  assert.equal(telegramUserFromInitData(null), null);
});

// — Identifiants créatrice
function withEnv(env, fn) {
  const saved = process.env;
  const next = { ...saved };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  process.env = next;
  try { fn(); } finally {
    process.env = saved; // restaure la vue initiale
  }
}

test('creatorTelegramUserIds : plural multi-ids, espaces, doublons', () => {
  withEnv({ PESCE_CREATOR_TELEGRAM_USER_IDS: '111, 222 ,111, ', PESCE_CREATOR_TELEGRAM_USER_ID: undefined }, () => {
    assert.deepEqual(creatorTelegramUserIds(), ['111', '222']);
  });
});

test('creatorTelegramUserIds : singular seul (legacy)', () => {
  withEnv({ PESCE_CREATOR_TELEGRAM_USER_IDS: undefined, PESCE_CREATOR_TELEGRAM_USER_ID: '333' }, () => {
    assert.deepEqual(creatorTelegramUserIds(), ['333']);
  });
});

test('creatorTelegramUserIds : les deux → le plural gagne', () => {
  withEnv({ PESCE_CREATOR_TELEGRAM_USER_IDS: '444, 555', PESCE_CREATOR_TELEGRAM_USER_ID: '999' }, () => {
    assert.deepEqual(creatorTelegramUserIds(), ['444', '555']);
  });
});

test('creatorTelegramUserIds : rien de configuré → []', () => {
  withEnv({ PESCE_CREATOR_TELEGRAM_USER_IDS: undefined, PESCE_CREATOR_TELEGRAM_USER_ID: undefined }, () => {
    assert.deepEqual(creatorTelegramUserIds(), []);
    assert.equal(isCreatorTelegramUser(111), false);
    assert.equal(isCreatorTelegramUser('111'), false);
  });
});

test('isCreatorTelegramUser : nombre vs chaîne, tolérance d’espaces', () => {
  withEnv({ PESCE_CREATOR_TELEGRAM_USER_IDS: '111, 222', PESCE_CREATOR_TELEGRAM_USER_ID: undefined }, () => {
    assert.equal(isCreatorTelegramUser(111), true);
    assert.equal(isCreatorTelegramUser('111'), true);
    assert.equal(isCreatorTelegramUser(222), true);
    assert.equal(isCreatorTelegramUser(333), false);
    assert.equal(isCreatorTelegramUser(''), false);
  });
});
