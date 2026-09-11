// Tests de l'authentification web du Studio créatrice (/studio) : aucune donnée privée sans
// session serveur valide, aucune connexion réseau requise (les échecs vérifiés sont pré-réseau),
// la liste d'autorisation est stricte, et l'endpoint /api/studio reste fail-closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import studioAuthHandler from '../api/studio-auth.js';
import studioHandler from '../api/studio.js';
import { clearSessionCookieHeader, parseCookies, sessionCookieHeader, WEB_SESSION_COOKIE } from '../lib/web-session.js';
import { DEFAULT_WEB_ADMIN_EMAILS, isWebAdminEmail, validateGoogleClaims, verifyGoogleIdToken, webAdminEmails } from '../lib/google-auth.js';

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

function nowSeconds(offset = 0) { return Math.floor(Date.now() / 1000) + offset; }

function claims(overrides = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: 'client-test.apps.googleusercontent.com',
    exp: nowSeconds(3600),
    email: 'pescestudio8@gmail.com',
    email_verified: true,
    ...overrides,
  };
}

// — Cookies de session
test('parseCookies : syntaxe et robustesse', () => {
  assert.equal(Object.keys(parseCookies('')).length, 0);
  assert.deepEqual(parseCookies(`${WEB_SESSION_COOKIE}=abc; Autre=123`), { [WEB_SESSION_COOKIE]: 'abc', Autre: '123' });
  assert.deepEqual(parseCookies('malformé;;=;x=y'), { x: 'y' });
  assert.deepEqual(parseCookies(undefined), {});
});

test('sessionCookieHeader : HttpOnly + SameSite=Lax + Secure optionnel', () => {
  const header = sessionCookieHeader('jeton', { secure: true });
  assert.ok(header.startsWith(`${WEB_SESSION_COOKIE}=jeton;`));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Lax'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('Max-Age=604800'));
  const insecure = sessionCookieHeader('jeton', { secure: false });
  assert.ok(!insecure.includes('Secure'));
  const cleared = clearSessionCookieHeader(true);
  assert.ok(cleared.includes('Max-Age=0'));
  assert.ok(cleared.includes('HttpOnly'));
});

// — Vérification des revendications Google (sans réseau)
test('validateGoogleClaims : revendications exigées strictement', () => {
  assert.equal(validateGoogleClaims(claims(), { clientId: 'client-test.apps.googleusercontent.com' }), 'pescestudio8@gmail.com');
  assert.equal(validateGoogleClaims(claims({ iss: 'https://evil.example' }), { clientId: 'client-test.apps.googleusercontent.com' }), null, 'émetteur accepté');
  assert.equal(validateGoogleClaims(claims({ aud: 'autre-client' }), { clientId: 'client-test.apps.googleusercontent.com' }), null, 'audience acceptée');
  assert.equal(validateGoogleClaims(claims({ exp: nowSeconds(-60) }), { clientId: 'client-test.apps.googleusercontent.com' }), null, 'jeton expiré accepté');
  assert.equal(validateGoogleClaims(claims({ email_verified: false }), { clientId: 'client-test.apps.googleusercontent.com' }), null, 'adresse non vérifiée acceptée');
  assert.equal(validateGoogleClaims(claims({ email: 'pas-un-email' }), { clientId: 'client-test.apps.googleusercontent.com' }), null);
  assert.equal(validateGoogleClaims(claims({ alg: 'HS256' }), { clientId: 'client-test.apps.googleusercontent.com' }), null, 'jeton symétrique accepté');
  assert.equal(validateGoogleClaims(null, {}), null);
  assert.equal(validateGoogleClaims(claims(), {}), null, 'audience manquante acceptée');
});

test('verifyGoogleIdToken : rejets sans accès réseau (jetons malformés ou mauvais algorithme)', async () => {
  assert.equal(await verifyGoogleIdToken('', {}), null);
  assert.equal(await verifyGoogleIdToken('a.b', {}), null);
  assert.equal(await verifyGoogleIdToken('a.b.c', {}), null); // en-tête indéchiffrable
  assert.equal(await verifyGoogleIdToken(`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims())).toString('base64url')}.c2ln`, { clientId: 'x' }), null, 'algorithme non RS256 accepté');
});

// — Régression du flux production : un jeton RS256 réellement signé (clé RSA locale, JWK n/e)
// devait passer la vérification — c'est le chemin qui échouait car le certificat x5c était
// utilisé à tort comme clé publique. C'est l'équivalent exact d'un jeton Google valide.
test('verifyGoogleIdToken : signature RS256 réelle vérifiée, altérations refusées', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${b64({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' })}.${b64(claims())}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), privateKey).toString('base64url');
  const token = `${signingInput}.${signature}`;
  const clientId = 'client-test.apps.googleusercontent.com';

  assert.equal(
    await verifyGoogleIdToken(token, { clientId, certs: { 'test-kid': jwk } }),
    'pescestudio8@gmail.com',
    'jeton Google valide refusé (régression du flux de connexion)'
  );
  // Signature altérée → refus.
  assert.equal(
    await verifyGoogleIdToken(`${signingInput}.${Buffer.from('deadbeef').toString('base64url')}`, { clientId, certs: { 'test-kid': jwk } }),
    null,
    'signature altérée acceptée'
  );
  // kid inconnu des clés servies → refus.
  assert.equal(
    await verifyGoogleIdToken(token, { clientId, certs: { 'autre-kid': jwk } }),
    null,
    'clé inconnue acceptée'
  );
  // Audience différente du client OAuth → refus.
  assert.equal(
    await verifyGoogleIdToken(token, { clientId: 'autre-client', certs: { 'test-kid': jwk } }),
    null,
    'audience étrangère acceptée'
  );
});

// — Régression du MÉCANISME de l'échec production : le point de terminaison JWKS de Google
// renvoie { "keys": [{ kid, n, e, … }, …] } (table → liste) ; la vérification doit normaliser
// cette forme. L'ancien code indexait le kid directement sur l'objet racine et refusait ainsi
// TOUT jeton Google valide. Ce test sert de vraies clés via un vrai endpoint JWKS local.
test('verifyGoogleIdToken : forme JWKS réelle de Google ({ keys: […] }) acceptée', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const certsUrl = `http://127.0.0.1:${server.address().port}/certs`;

  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${b64({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })}.${b64(claims())}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), privateKey).toString('base64url');
  const token = `${signingInput}.${signature}`;
  const clientId = 'client-test.apps.googleusercontent.com';

  try {
    assert.equal(
      await verifyGoogleIdToken(token, { clientId, certsUrl }),
      'pescestudio8@gmail.com',
      'jeton valide refusé avec la forme JWKS réelle (mécanisme de l\'échec production)'
    );
  } finally {
    server.close();
  }
});

// — Liste d'autorisation
test('webAdminEmails : valeur par défaut documentée et surcharge d’environnement', () => {
  assert.deepEqual(webAdminEmails({}), DEFAULT_WEB_ADMIN_EMAILS);
  assert.deepEqual(DEFAULT_WEB_ADMIN_EMAILS, ['pescestudio8@gmail.com']);
  assert.deepEqual(webAdminEmails({ PESCE_WEB_ADMIN_EMAILS: ' a@b.co , PESCESTUDIO8@GMAIL.COM ' }), ['a@b.co', 'pescestudio8@gmail.com']);
});

test('isWebAdminEmail : comparaison insensible à la casse, refus des autres comptes', () => {
  assert.equal(isWebAdminEmail('PESCEstudio8@gmail.com', {}), true, 'administrateur légitime refusé');
  assert.equal(isWebAdminEmail('autre@gmail.com', {}), false, 'compte non autorisé accepté');
  assert.equal(isWebAdminEmail('', {}), false);
});

// — Endpoint d'authentification : fail-closed sans session, sans configuration, sans jeton
test('studio-auth : config expose le client OAuth public ou null', async () => {
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: undefined }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'GET', url: '/api/studio-auth', query: { action: 'config' }, headers: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.clientId, null);
  });
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-public' }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'GET', url: '/api/studio-auth', query: { action: 'config' }, headers: {} }, res);
    assert.equal(res.body.clientId, 'client-public');
  });
});

test('studio-auth : session absente → 401, sans accès base', async () => {
  const res = stubRes();
  await studioAuthHandler({ method: 'GET', url: '/api/studio-auth', query: { action: 'session' }, headers: {} }, res);
  assert.equal(res.code, 401);
  assert.equal(res.body.authenticated, false);
});

test('studio-auth : login refuse sans configuration, sans jeton, avec jeton malformé', async () => {
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: undefined }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'POST', url: '/api/studio-auth', body: { action: 'login', credential: 'x' } }, res);
    assert.equal(res.code, 503, 'login accepté sans client OAuth');
  });
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-public' }, async () => {
    const missing = stubRes();
    await studioAuthHandler({ method: 'POST', url: '/api/studio-auth', body: { action: 'login' } }, missing);
    assert.equal(missing.code, 400);
    const malformed = stubRes();
    await studioAuthHandler({ method: 'POST', url: '/api/studio-auth', body: { action: 'login', credential: 'pas-un-jwt' } }, malformed);
    assert.equal(malformed.code, 401, 'jeton malformé accepté');
  });
});

test('studio-auth : déconnexion efface toujours le cookie', async () => {
  const res = stubRes();
  await studioAuthHandler({ method: 'POST', url: '/api/studio-auth', body: { action: 'logout' }, headers: { cookie: `${WEB_SESSION_COOKIE}=xyz` } }, res);
  assert.equal(res.code, 200);
  assert.ok(res.headers['Set-Cookie'].includes('Max-Age=0'));
});

test('studio-auth : méthodes refusées → 405, action inconnue → 400', async () => {
  const res = stubRes();
  await studioAuthHandler({ method: 'PUT', url: '/api/studio-auth', query: { action: 'session' }, headers: {} }, res);
  assert.equal(res.code, 405);
  const unknown = stubRes();
  await studioAuthHandler({ method: 'GET', url: '/api/studio-auth', query: { action: 'bogus' }, headers: {} }, unknown);
  assert.equal(unknown.code, 400);
});

// — /api/studio : le flux Telegram existant reste intact et fail-closed sans session web
test('studio : les actions d\'image/d\'audio/de vidéo restent fail-closed sans session', async () => {
  const baseEnv = { TELEGRAM_PESCE_BOT_TOKEN: '123456:ABC-TEST_TOKEN', PESCE_CREATOR_TELEGRAM_USER_IDS: undefined };
  await withEnv(baseEnv, async () => {
    for (const action of ['article_image_upload', 'article_image_from_channel', 'video_publish', 'video_update', 'audio_publish', 'resync_message', 'reconcile_channel', 'live_rtmp', 'live_status_sync', 'telegram_stats']) {
      const res = stubRes();
      await studioHandler({ method: 'POST', headers: {}, body: { action } }, res);
      assert.equal(res.code, 401, `action ${action} acceptée sans session`);
    }
  });
});

test('studio : sans session web, initData invalide → 401 ; initData valide mais créatrice non configurée → 403', async () => {
  const baseEnv = { TELEGRAM_PESCE_BOT_TOKEN: '123456:ABC-TEST_TOKEN', PESCE_CREATOR_TELEGRAM_USER_IDS: undefined };
  await withEnv(baseEnv, async () => {
    const invalid = stubRes();
    await studioHandler({ method: 'GET', headers: {}, body: {} }, invalid);
    assert.equal(invalid.code, 401, 'initData absente acceptée');
    const badInit = stubRes();
    await studioHandler({ method: 'GET', headers: {}, body: { initData: 'auth_date=1&hash=abcd' } }, badInit);
    assert.equal(badInit.code, 401, 'initData falsifiée acceptée');
  });
});

test('studio : sans session web et sans jeton de bot → 503 (fail-closed)', async () => {
  await withEnv({ TELEGRAM_PESCE_BOT_TOKEN: undefined, PESCE_CREATOR_TELEGRAM_USER_IDS: undefined }, async () => {
    const res = stubRes();
    await studioHandler({ method: 'GET', headers: {}, body: {} }, res);
    assert.equal(res.code, 503);
  });
});

// — Page /studio : aucun secret ni donnée privée dans le HTML statique
test('la page /studio ne contient ni identifiant Google, ni secret, ni donnée privée statique', () => {
  const html = readFileSync(fileURLToPath(new URL('../studio/index.html', import.meta.url)), 'utf8');
  assert.ok(html.includes('id="studioLogin"'), 'écran de connexion attendu');
  assert.ok(!html.includes('pescestudio8@gmail.com'), 'adresse administrateur codée en dur dans la page');
  assert.ok(!html.includes('GOOGLE_OAUTH_CLIENT'), 'identifiant OAuth codé en dur dans la page');
  assert.ok(!html.includes('client_secret'), 'secret client dans la page');
  assert.ok(!/TELEGRAPH_ACCESS_TOKEN|PESCE_WEB_ADMIN_EMAILS/.test(html), 'nom de variable d’environnement dans la page');
});

test('la page /studio est une page de connexion : aucune donnée de gestion sur la surface de connexion', () => {
  // Les libellés de menu (Brouillons, Audience & Stars…) appartiennent à la coquille masquée —
  // ils ne sont pas des données. La SURFACE DE CONNEXION, elle, n'affiche rien de privé.
  const html = readFileSync(fileURLToPath(new URL('../studio/index.html', import.meta.url)), 'utf8');
  const loginMarkup = html.slice(html.indexOf('<main id="studioLogin"'), html.indexOf('</main>'));
  for (const term of ['Brouillon', 'draft', 'ticket', 'paiement', 'Stars', 'Message']) {
    assert.ok(!loginMarkup.includes(term), `donnée privée « ${term} » sur l'écran de connexion`);
  }
  // Et le HTML statique ne contient aucune valeur de données réelles (tout est rendu après l'authentification).
  for (const marker of ['pescestudio8@gmail.com', 'PS-2026', 'draft_', 'pay_']) {
    assert.ok(!html.includes(marker), `valeur de données réelle « ${marker} » dans le HTML statique`);
  }
});
