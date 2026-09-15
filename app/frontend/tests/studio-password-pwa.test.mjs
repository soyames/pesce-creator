// Connexion par mot de passe du Studio créatrice + application installable (PWA) du bureau privé.
//
// Trois invariants sont gardés ici :
//   1. Le mot de passe n'est jamais stocké, ni comparé par un condensat rapide, ni exposé au
//      client ; la session créée est EXACTEMENT celle de la connexion Google.
//   2. Le service worker ne met en cache QUE des ressources statiques publiques de la coquille :
//      aucun /api/*, aucune donnée privée, aucune réponse authentifiée.
//   3. La frontière public/privé tient : le Mini App public n'est ni contrôlé ni mis en cache
//      par la PWA du Studio, et installer la PWA n'authentifie personne.
//
// Aucun mot de passe réel n'apparaît : toutes les valeurs ci-dessous sont des fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import studioAuthHandler, { passwordLoginDecision } from '../api/studio-auth.js';
import {
  hashPassword, isPasswordLoginConfigured, LOGIN_MAX_FAILURES, loginFailureCount, loginScope,
  normalizeEmail, parsePasswordHash, recordLoginFailure, clearLoginFailures, SCRYPT_PARAMS,
  studioPasswordHash, verifyPassword,
} from '../lib/password-auth.js';
import { createWebSession, destroyWebSession, sessionCookieHeader, WEB_SESSION_COOKIE, WEB_SESSION_TTL_MS, webSessionEmailFromRequest } from '../lib/web-session.js';
import { isWebAdminEmail } from '../lib/google-auth.js';
import { MIGRATIONS } from '../lib/schema.js';

const ORIGIN = 'https://pesce-creator-nine.vercel.app';
const ADMIN = 'pescestudio8@gmail.com';
// Fixtures de test — jamais un identifiant réel (règle permanente du projet).
const FIXTURE_PASSWORD = 'fixture-de-test-du-studio-2026';
const FIXTURE_WRONG = 'fixture-de-test-erronee';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
const resolve = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

function stubRes() {
  return {
    code: 0, body: null, headers: {},
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

// Accès Neon simulé : reproduit UNIQUEMENT les requêtes réellement émises par le code.
// Toute requête inattendue lève — un changement de SQL non couvert ne peut pas passer inaperçu.
function fakeClient() {
  const sessions = new Map();
  const attempts = [];
  return {
    sessions, attempts,
    async query(sql, params = []) {
      if (/INSERT INTO pesce_web_sessions/.test(sql)) { sessions.set(params[0], { email: params[1], expires_at: params[3] }); return { rows: [] }; }
      if (/SELECT email, expires_at FROM pesce_web_sessions/.test(sql)) { const row = sessions.get(params[0]); return { rows: row ? [row] : [] }; }
      if (/DELETE FROM pesce_web_sessions/.test(sql)) { sessions.delete(params[0]); return { rows: [] }; }
      if (/INSERT INTO pesce_login_attempts/.test(sql)) { attempts.push({ scope: params[0], createdAt: params[1] }); return { rows: [] }; }
      if (/SELECT count\(\*\)::int AS failures FROM pesce_login_attempts/.test(sql)) {
        return { rows: [{ failures: attempts.filter((item) => item.scope === params[0] && item.createdAt > params[1]).length }] };
      }
      if (/DELETE FROM pesce_login_attempts WHERE scope/.test(sql)) {
        for (let index = attempts.length - 1; index >= 0; index -= 1) if (attempts[index].scope === params[0]) attempts.splice(index, 1);
        return { rows: [] };
      }
      if (/DELETE FROM pesce_login_attempts WHERE created_at/.test(sql)) {
        for (let index = attempts.length - 1; index >= 0; index -= 1) if (attempts[index].createdAt < params[0]) attempts.splice(index, 1);
        return { rows: [] };
      }
      throw new Error(`SQL inattendu dans le test : ${sql}`);
    },
  };
}

// ——————————————————————————————————————————————————————————————————————————
// A. Dérivation du mot de passe : jamais un condensat rapide
// ——————————————————————————————————————————————————————————————————————————

test('empreinte : scrypt paramétré (jamais un SHA-256 nu), sel aléatoire, format auto-descriptif', async () => {
  const first = await hashPassword(FIXTURE_PASSWORD);
  const second = await hashPassword(FIXTURE_PASSWORD);
  assert.notEqual(first, second, 'deux empreintes identiques : le sel n’est pas aléatoire');
  const parsed = parsePasswordHash(first);
  assert.ok(parsed, 'empreinte illisible');
  assert.equal(parsed.N, SCRYPT_PARAMS.N);
  assert.ok(parsed.N >= 16384, 'coût scrypt trop faible pour un mot de passe');
  assert.ok(parsed.salt.length >= 16, 'sel trop court');
  assert.ok(parsed.hash.length >= 32, 'empreinte trop courte');
  assert.ok(first.startsWith('scrypt$'), 'algorithme non identifié dans l’empreinte');
  // Un condensat rapide du mot de passe ne doit apparaître nulle part dans l'empreinte.
  const { createHash } = await import('node:crypto');
  const naive = createHash('sha256').update(FIXTURE_PASSWORD).digest('hex');
  assert.ok(!first.includes(naive), 'la dérivation ressemble à un SHA-256 du mot de passe');
});

test('vérification : correcte acceptée, incorrecte refusée, entrées aberrantes fail-closed', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  assert.equal(await verifyPassword(FIXTURE_PASSWORD, encoded), true, 'mot de passe correct refusé');
  assert.equal(await verifyPassword(FIXTURE_WRONG, encoded), false, 'mot de passe erroné accepté');
  assert.equal(await verifyPassword('', encoded), false, 'mot de passe vide accepté');
  assert.equal(await verifyPassword(FIXTURE_PASSWORD, ''), false, 'empreinte absente acceptée');
  assert.equal(await verifyPassword(FIXTURE_PASSWORD, 'sha256$x$y'), false, 'empreinte d’un autre algorithme acceptée');
  assert.equal(await verifyPassword(FIXTURE_PASSWORD, 'n’importe quoi'), false, 'empreinte illisible acceptée');
  assert.equal(await verifyPassword(FIXTURE_PASSWORD, undefined), false);
  assert.equal(await verifyPassword('x'.repeat(5000), encoded), false, 'entrée démesurée dérivée quand même');
});

test('normalisation d’adresse : espaces et casse uniquement — aucune réécriture élargissante', () => {
  assert.equal(normalizeEmail('  PESCEstudio8@Gmail.com '), ADMIN);
  assert.equal(normalizeEmail(undefined), '');
  // Un alias ou une variante ponctuée reste une AUTRE adresse : la liste n'est jamais élargie.
  assert.equal(isWebAdminEmail(normalizeEmail('pesce.studio8@gmail.com'), {}), false);
  assert.equal(isWebAdminEmail(normalizeEmail('pescestudio8+admin@gmail.com'), {}), false);
  assert.equal(isWebAdminEmail(normalizeEmail('  PESCESTUDIO8@GMAIL.COM  '), {}), true);
});

test('configuration : PESCE_STUDIO_PASSWORD_HASH absente ou invalide → voie désactivée', async () => {
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: undefined }, () => {
    assert.equal(isPasswordLoginConfigured(), false);
    assert.equal(studioPasswordHash(), '');
  });
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: 'valeur-mal-collée' }, () => {
    assert.equal(isPasswordLoginConfigured(), false, 'empreinte illisible considérée comme configurée');
  });
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: encoded }, () => {
    assert.equal(isPasswordLoginConfigured(), true);
  });
});

// ——————————————————————————————————————————————————————————————————————————
// B. Décision de connexion : 1) correcte 2) mauvais mot de passe 3) mauvaise adresse 4) manquant
// ——————————————————————————————————————————————————————————————————————————

test('décision : adresse autorisée + mot de passe correct → acceptée', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  const decision = await passwordLoginDecision({ email: ADMIN, password: FIXTURE_PASSWORD, encoded }, { authorize: (email) => isWebAdminEmail(email, {}) });
  assert.equal(decision.status, 200);
  assert.equal(decision.email, ADMIN);
  assert.ok(!decision.recordFailure);
});

test('décision : mot de passe erroné → 401 générique et tentative comptabilisée', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  const decision = await passwordLoginDecision({ email: ADMIN, password: FIXTURE_WRONG, encoded }, { authorize: (email) => isWebAdminEmail(email, {}) });
  assert.equal(decision.status, 401);
  assert.equal(decision.message, 'Adresse ou mot de passe incorrect.');
  assert.equal(decision.recordFailure, true);
});

test('décision : adresse non autorisée → 401, message STRICTEMENT identique (aucun oracle)', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  const authorize = (email) => isWebAdminEmail(email, {});
  const wrongEmail = await passwordLoginDecision({ email: 'quelqun@example.org', password: FIXTURE_PASSWORD, encoded }, { authorize });
  const wrongPassword = await passwordLoginDecision({ email: ADMIN, password: FIXTURE_WRONG, encoded }, { authorize });
  assert.equal(wrongEmail.status, 401);
  assert.equal(wrongEmail.status, wrongPassword.status, 'statuts distincts : l’existence de l’adresse fuite');
  assert.equal(wrongEmail.message, wrongPassword.message, 'messages distincts : l’existence de l’adresse fuite');
});

test('décision : saisie incomplète → 400 générique ; sans empreinte configurée → 503', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  const missingPassword = await passwordLoginDecision({ email: ADMIN, password: '', encoded });
  assert.equal(missingPassword.status, 400);
  assert.equal(missingPassword.message, 'Adresse ou mot de passe incorrect.');
  const missingEmail = await passwordLoginDecision({ email: '', password: FIXTURE_PASSWORD, encoded });
  assert.equal(missingEmail.status, 400);
  const notConfigured = await passwordLoginDecision({ email: ADMIN, password: FIXTURE_PASSWORD, encoded: '' });
  assert.equal(notConfigured.status, 503);
});

test('décision : au-delà du seuil de tentatives → 429, même avec le mot de passe correct', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  const decision = await passwordLoginDecision(
    { email: ADMIN, password: FIXTURE_PASSWORD, encoded },
    { authorize: () => true, failures: LOGIN_MAX_FAILURES }
  );
  assert.equal(decision.status, 429, 'la limitation de tentatives est contournable');
});

// ——————————————————————————————————————————————————————————————————————————
// C. Limitation des tentatives (Neon simulé)
// ——————————————————————————————————————————————————————————————————————————

test('tentatives : comptage par empreinte d’adresse réseau, réinitialisation, fenêtre glissante', async () => {
  const client = fakeClient();
  const scope = loginScope({ headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' } });
  assert.match(scope, /^[0-9a-f]{32}$/, 'la clé de regroupement n’est pas une empreinte');
  assert.ok(!scope.includes('203.0.113.7'), 'adresse réseau conservée en clair');

  assert.equal(await loginFailureCount(scope, { client }), 0);
  for (let attempt = 0; attempt < 3; attempt += 1) await recordLoginFailure(scope, { client });
  assert.equal(await loginFailureCount(scope, { client }), 3);

  // Une autre origine n'est jamais pénalisée par les échecs d'une première.
  const other = loginScope({ headers: { 'x-forwarded-for': '198.51.100.4' } });
  assert.notEqual(other, scope);
  assert.equal(await loginFailureCount(other, { client }), 0);

  // Fenêtre glissante : vue depuis plus tard, les échecs sortent de la fenêtre et ne comptent plus.
  assert.equal(await loginFailureCount(scope, { client, windowMs: 60_000, now: new Date(Date.now() + 3600_000) }), 0);

  await clearLoginFailures(scope, { client });
  assert.equal(await loginFailureCount(scope, { client }), 0, 'une connexion réussie ne remet pas le compteur à zéro');
});

// ——————————————————————————————————————————————————————————————————————————
// D. Session : la même que Google, valable, révocable
// ——————————————————————————————————————————————————————————————————————————

test('session : une connexion réussie produit une session web valide (identique à la voie Google)', async () => {
  const client = fakeClient();
  const { token, expiresAt } = await createWebSession(ADMIN, { client });
  assert.ok(token.length >= 40, 'jeton de session trop court');
  assert.equal(client.sessions.size, 1);
  const [storedHash] = [...client.sessions.keys()];
  assert.match(storedHash, /^[0-9a-f]{64}$/, 'le jeton n’est pas stocké sous forme d’empreinte SHA-256');
  assert.ok(!storedHash.includes(token), 'le jeton brut est stocké en base');
  assert.ok(expiresAt.getTime() - Date.now() > WEB_SESSION_TTL_MS - 5000, 'durée de session inattendue');

  const request = { headers: { cookie: `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}` } };
  assert.equal(await webSessionEmailFromRequest(request, { client }), ADMIN, 'session créée non reconnue');

  const cookie = sessionCookieHeader(token, { secure: true });
  assert.ok(cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Lax'));
});

test('session : une session existante (créée avant ce changement) reste valable', async () => {
  // Une session déjà posée est une simple ligne empreinte → adresse → expiration : la voie
  // mot de passe n'introduit aucun format concurrent qui l'invaliderait.
  const client = fakeClient();
  const { token } = await createWebSession(ADMIN, { client });
  const request = { headers: { cookie: `${WEB_SESSION_COOKIE}=${token}` } };
  assert.equal(await webSessionEmailFromRequest(request, { client }), ADMIN);
  // Expirée → refusée et nettoyée.
  const expired = await createWebSession(ADMIN, { client, ttlMs: -1000 });
  const staleRequest = { headers: { cookie: `${WEB_SESSION_COOKIE}=${expired.token}` } };
  assert.equal(await webSessionEmailFromRequest(staleRequest, { client }), null, 'session expirée acceptée');
});

test('déconnexion : la session est détruite côté serveur, pas seulement côté cookie', async () => {
  const client = fakeClient();
  const { token } = await createWebSession(ADMIN, { client });
  const request = { headers: { cookie: `${WEB_SESSION_COOKIE}=${token}` } };
  assert.equal(await webSessionEmailFromRequest(request, { client }), ADMIN);
  await destroyWebSession(request, { client });
  assert.equal(client.sessions.size, 0, 'la ligne de session survit à la déconnexion');
  assert.equal(await webSessionEmailFromRequest(request, { client }), null, 'le jeton reste accepté après déconnexion');
});

// ——————————————————————————————————————————————————————————————————————————
// E. Endpoint /api/studio-auth : voies disponibles, refus, fail-closed
// ——————————————————————————————————————————————————————————————————————————

test('endpoint config : expose les voies disponibles — jamais l’empreinte ni le mot de passe', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-public', PESCE_STUDIO_PASSWORD_HASH: encoded }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'GET', query: { action: 'config' }, headers: {} }, res);
    assert.equal(res.code, 200);
    assert.equal(res.body.clientId, 'client-public', 'la connexion Google n’est plus proposée');
    assert.equal(res.body.passwordLogin, true);
    const serialized = JSON.stringify(res.body);
    assert.ok(!serialized.includes(encoded), 'l’empreinte du mot de passe est renvoyée au client');
    assert.ok(!serialized.includes('scrypt'), 'des détails de l’empreinte fuient vers le client');
    assert.ok(!serialized.includes(FIXTURE_PASSWORD), 'le mot de passe fuite vers le client');
    assert.ok(!serialized.includes('PESCE_STUDIO_PASSWORD_HASH'), 'nom de variable secrète renvoyé au client');
  });
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: undefined, PESCE_STUDIO_PASSWORD_HASH: undefined }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'GET', query: { action: 'config' }, headers: {} }, res);
    assert.equal(res.body.clientId, null);
    assert.equal(res.body.passwordLogin, false);
  });
});

test('endpoint : sans empreinte configurée → 503 ; saisie incomplète → 400 ; aucun cookie posé', async () => {
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: undefined }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'password_login', email: ADMIN, password: FIXTURE_PASSWORD } }, res);
    assert.equal(res.code, 503);
    assert.equal(res.headers['Set-Cookie'], undefined, 'cookie de session posé sans configuration');
  });
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: encoded }, async () => {
    const missingPassword = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'password_login', email: ADMIN } }, missingPassword);
    assert.equal(missingPassword.code, 400, 'mot de passe manquant accepté');
    assert.equal(missingPassword.body.message, 'Adresse ou mot de passe incorrect.');
    assert.equal(missingPassword.headers['Set-Cookie'], undefined);

    const missingEmail = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'password_login', password: FIXTURE_PASSWORD } }, missingEmail);
    assert.equal(missingEmail.code, 400, 'adresse manquante acceptée');
    assert.equal(missingEmail.headers['Set-Cookie'], undefined);
  });
});

test('endpoint : base indisponible → aucune session, même avec le mot de passe correct (fail-closed)', async () => {
  const encoded = await hashPassword(FIXTURE_PASSWORD);
  await withEnv({ PESCE_STUDIO_PASSWORD_HASH: encoded, DATABASE_URL: undefined, POSTGRES_URL: undefined, PGHOST: undefined }, async () => {
    const res = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'password_login', email: ADMIN, password: FIXTURE_PASSWORD } }, res);
    assert.ok(res.code >= 400, `connexion aboutie sans base (statut ${res.code})`);
    assert.equal(res.headers['Set-Cookie'], undefined, 'cookie de session posé sans base');
    assert.equal(res.body.message, 'Authentification indisponible.', 'l’incident interne fuit vers le client');
    assert.ok(!JSON.stringify(res.body || {}).includes(FIXTURE_PASSWORD), 'le mot de passe est renvoyé dans l’erreur');
    assert.ok(!JSON.stringify(res.body || {}).includes(encoded), 'l’empreinte est renvoyée dans l’erreur');
  });
});

test('endpoint : la voie Google reste intacte (actions distinctes, refus inchangés)', async () => {
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-public' }, async () => {
    const malformed = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'login', credential: 'pas-un-jwt' } }, malformed);
    assert.equal(malformed.code, 401, 'jeton Google malformé accepté');
    const missing = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'login' } }, missing);
    assert.equal(missing.code, 400);
  });
  // Un mot de passe ne peut pas être présenté comme un jeton Google, et inversement.
  await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-public', PESCE_STUDIO_PASSWORD_HASH: await hashPassword(FIXTURE_PASSWORD) }, async () => {
    const crossed = stubRes();
    await studioAuthHandler({ method: 'POST', headers: {}, body: { action: 'login', credential: FIXTURE_PASSWORD } }, crossed);
    assert.equal(crossed.code, 401, 'un mot de passe accepté comme jeton Google');
  });
});

test('schéma : la table des tentatives existe et ne contient aucun secret', () => {
  const migration = MIGRATIONS.find((item) => item.name === '010_login_attempts.sql');
  assert.ok(migration, 'migration des tentatives de connexion absente');
  assert.ok(/CREATE TABLE IF NOT EXISTS pesce_login_attempts/.test(migration.sql));
  assert.ok(!/password|mot_de_passe|hash/i.test(migration.sql), 'la table des tentatives stocke un secret');
  // Aucune migration n'introduit de colonne de mot de passe où que ce soit.
  for (const item of MIGRATIONS) {
    assert.ok(!/password_hash|mot_de_passe/i.test(item.sql), `la migration ${item.name} stocke un mot de passe`);
  }
});

test('migrations : le chemin mot de passe garantit le schéma avant sa première requête (démarrage à froid)', () => {
  // Garde-fou du défaut « relation pesce_login_attempts does not exist » : toute requête de
  // limitation des tentatives doit passer par ensureDb() (migrations d'abord), jamais par db() nu.
  const dbSource = read('lib/db.js');
  assert.ok(/export async function ensureDb/.test(dbSource), 'ensureDb non exporté : les migrations ne sont pas garanties au démarrage à froid');
  const passwordAuth = read('lib/password-auth.js');
  assert.ok(/import \{ ensureDb \} from '\.\/db\.js'/.test(passwordAuth), 'password-auth n’emprunte pas le mécanisme de migration');
  assert.ok(!/client \|\| db\(\)/.test(passwordAuth), 'password-auth contourne les migrations (db() direct)');
  const webSession = read('lib/web-session.js');
  assert.ok(!/client \|\| db\(\)/.test(webSession), 'web-session contourne les migrations (db() direct)');
});

// ——————————————————————————————————————————————————————————————————————————
// F. Manifeste PWA et icônes
// ——————————————————————————————————————————————————————————————————————————

const manifest = JSON.parse(read('studio/manifest.webmanifest'));

test('manifeste : valide et conforme à l’identité du bureau privé', () => {
  assert.equal(manifest.name, 'Pesce Studio · Bureau Privé');
  assert.equal(manifest.short_name, 'Pesce Studio');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.lang, 'fr');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
  // Aucun secret, aucune adresse privée, aucune donnée éditoriale dans un fichier public.
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes(ADMIN), 'adresse de la créatrice dans le manifeste');
  assert.ok(!/HASH|TOKEN|SECRET|DATABASE/i.test(serialized), 'nom de secret dans le manifeste');
});

test('manifeste : portée et démarrage limités au Studio (jamais le Mini App public)', () => {
  assert.equal(manifest.start_url, '/studio');
  assert.equal(manifest.scope, '/studio');
  assert.ok(manifest.start_url.startsWith(manifest.scope), 'le démarrage sort de la portée');
  assert.notEqual(manifest.scope, '/', 'la PWA engloberait le Mini App public');
  // L'application installée s'ouvre sur le bureau privé, pas sur le journal public.
  assert.ok(!['/', '/index.html'].includes(manifest.start_url));
});

test('icônes : dérivées de la marque existante, aux tailles attendues', () => {
  const expected = [
    ['assets/studio-icon-192.png', 192, 'any'],
    ['assets/studio-icon-512.png', 512, 'any'],
    ['assets/studio-icon-maskable-512.png', 512, 'maskable'],
  ];
  for (const [path, size, purpose] of expected) {
    assert.ok(existsSync(resolve(path)), `icône manquante : ${path}`);
    const buffer = readFileSync(resolve(path));
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} n’est pas un PNG`);
    assert.equal(buffer.readUInt32BE(16), size, `${path} : largeur inattendue`);
    assert.equal(buffer.readUInt32BE(20), size, `${path} : hauteur inattendue`);
    const declared = manifest.icons.find((icon) => icon.src === `/${path}`);
    assert.ok(declared, `${path} absente du manifeste`);
    assert.equal(declared.sizes, `${size}x${size}`);
    assert.equal(declared.purpose, purpose);
  }
  // La source de marque d'origine reste en place : rien n'a été remplacé.
  assert.ok(existsSync(resolve('assets/profilePesce.png')), 'la marque d’origine a été supprimée');
});

// ——————————————————————————————————————————————————————————————————————————
// G. Service worker : exécuté pour de vrai dans une portée simulée
// ——————————————————————————————————————————————————————————————————————————

// Charge studio-sw.js dans un contexte de worker simulé et rend ses auditeurs pilotables.
function loadServiceWorker() {
  const source = read('studio-sw.js');
  const listeners = {};
  const stores = new Map();
  const fetched = [];

  class FakeRequest {
    constructor(input, init = {}) {
      this.url = new URL(typeof input === 'string' ? input : input.url, ORIGIN).toString();
      this.method = init.method || (typeof input === 'object' && input.method) || 'GET';
      this.mode = init.mode || (typeof input === 'object' && input.mode) || 'no-cors';
    }
  }
  const keyOf = (value) => new URL(typeof value === 'string' ? value : value.url, ORIGIN).toString();
  const makeResponse = (url, { ok = true, type = 'basic', headers = {} } = {}) => ({
    url, ok, type, headers: { get: (name) => headers[name] ?? null }, clone() { return { ...this }; },
  });

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async add(request) {
          const key = keyOf(request);
          fetched.push(key);
          store.set(key, makeResponse(key));
        },
        async put(request, response) { store.set(keyOf(request), response); },
        async match(request) { return store.get(keyOf(request)) || undefined; },
      };
    },
    async match(request) {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request));
        if (hit) return hit;
      }
      return undefined;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };

  const scope = {
    location: { origin: ORIGIN },
    addEventListener(type, handler) { listeners[type] = handler; },
    async skipWaiting() {},
    clients: { async claim() {} },
  };
  scope.self = scope;

  const networkCalls = [];
  const fetchStub = async (request) => {
    networkCalls.push(keyOf(request));
    return makeResponse(keyOf(request));
  };

  // eslint-disable-next-line no-new-func — exécution contrôlée du worker dans un bac à sable de test
  new Function('self', 'caches', 'fetch', 'Request', 'Response', 'URL', source)(
    scope, caches, fetchStub, FakeRequest, { error: () => makeResponse('error', { ok: false }) }, URL
  );

  const cacheContents = () => [...stores.values()].flatMap((store) => [...store.keys()]);
  const dispatchFetch = (url, { method = 'GET', mode = 'no-cors' } = {}) => {
    let responded = null;
    const event = { request: new FakeRequest(url, { method, mode }), respondWith(promise) { responded = promise; }, waitUntil(promise) { return promise; } };
    listeners.fetch(event);
    return responded;
  };
  const install = async () => {
    let pending = null;
    listeners.install({ waitUntil(promise) { pending = promise; } });
    await pending;
  };
  return { listeners, install, dispatchFetch, cacheContents, networkCalls, caches, stores, keyOf };
}

test('service worker : l’installation ne met en cache que la coquille statique publique', async () => {
  const worker = loadServiceWorker();
  await worker.install();
  const cached = worker.cacheContents();
  assert.ok(cached.length > 0, 'aucune ressource de coquille mise en cache : la PWA ne s’installe pas');
  for (const url of cached) {
    const { pathname } = new URL(url);
    assert.ok(!pathname.startsWith('/api/'), `réponse d’API mise en cache : ${pathname}`);
    assert.ok(pathname === '/studio' || pathname.startsWith('/studio/') || pathname === '/constants.js' || pathname.startsWith('/assets/studio-icon-'),
      `ressource hors coquille du Studio mise en cache : ${pathname}`);
  }
  // Le Mini App public n'entre JAMAIS dans le cache du Studio.
  for (const publicPath of ['/', '/index.html', '/app.js', '/styles.css', '/studio.js', '/studio.css']) {
    assert.ok(!cached.includes(`${ORIGIN}${publicPath}`), `ressource du Mini App public mise en cache : ${publicPath}`);
  }
});

test('service worker : /api/* n’est ni intercepté ni mis en cache (réseau uniquement)', async () => {
  const worker = loadServiceWorker();
  await worker.install();
  const before = worker.cacheContents().length;
  const apiRoutes = [
    '/api/studio', '/api/studio-auth?action=session', '/api/content?limit=50',
    '/api/live', '/api/media?file_id=x&token=y', '/api/support', '/api/track', '/api/me',
  ];
  for (const route of apiRoutes) {
    assert.equal(worker.dispatchFetch(route), null, `requête d’API interceptée : ${route}`);
    assert.equal(worker.dispatchFetch(route, { mode: 'navigate' }), null, `navigation d’API interceptée : ${route}`);
  }
  assert.equal(worker.cacheContents().length, before, 'le cache a grossi après des requêtes d’API');
});

test('service worker : aucune mutation ni réponse privée ne passe par le cache', async () => {
  const worker = loadServiceWorker();
  await worker.install();
  const before = worker.cacheContents().length;
  // Mutations (publication, brouillon, réponse à un message, remboursement…) : jamais touchées.
  assert.equal(worker.dispatchFetch('/api/studio', { method: 'POST' }), null, 'mutation interceptée');
  assert.equal(worker.dispatchFetch('/api/studio-auth', { method: 'POST' }), null, 'connexion interceptée');
  // Ressources privées hors liste blanche : laissées au réseau, jamais mémorisées.
  for (const route of ['/api/media?file_id=brouillon', '/studio/donnees-privees.json', '/assets/profilePesce.png']) {
    worker.dispatchFetch(route);
  }
  assert.equal(worker.cacheContents().length, before, 'une ressource hors liste blanche a été mise en cache');
  const stored = worker.cacheContents().join(' ');
  for (const forbidden of ['draft', 'ticket', 'session', 'rtmp', 'payment', 'token']) {
    assert.ok(!stored.includes(forbidden), `donnée privée « ${forbidden} » dans le cache du Studio`);
  }
});

test('service worker : le Mini App public n’est jamais pris en charge', async () => {
  const worker = loadServiceWorker();
  await worker.install();
  for (const publicRoute of ['/', '/index.html', '/privacy', '/privacy/']) {
    assert.equal(worker.dispatchFetch(publicRoute, { mode: 'navigate' }), null, `navigation publique interceptée : ${publicRoute}`);
  }
  for (const publicAsset of ['/app.js', '/styles.css', '/studio.js', '/studio.css', '/assets/profilePesce.png']) {
    assert.equal(worker.dispatchFetch(publicAsset), null, `ressource publique interceptée : ${publicAsset}`);
  }
  // Les origines tierces (Tailwind, polices, Telegram) ne sont jamais interceptées non plus.
  assert.equal(worker.dispatchFetch('https://cdn.tailwindcss.com/'), null);
  assert.equal(worker.dispatchFetch('https://telegra.ph/file/x.jpg'), null);
});

test('service worker : la navigation du Studio est servie réseau d’abord, cache en repli', async () => {
  const worker = loadServiceWorker();
  await worker.install();
  const responded = worker.dispatchFetch('/studio', { mode: 'navigate' });
  assert.ok(responded, 'la navigation du Studio n’est pas prise en charge (pas d’ouverture hors connexion)');
  const response = await responded;
  assert.ok(response.ok);
  assert.ok(worker.networkCalls.includes(`${ORIGIN}/studio`), 'la coquille n’a pas été redemandée au réseau');
});

test('service worker : enregistré avec la portée /studio, jamais depuis le Mini App public', () => {
  const client = read('studio/web-studio.js');
  assert.ok(/navigator\.serviceWorker\.register\('\/studio-sw\.js', \{ scope: '\/studio' \}\)/.test(client), 'portée d’enregistrement absente ou élargie');
  assert.ok(client.includes("location.pathname.startsWith('/studio')"), 'l’enregistrement n’est pas conditionné au chemin du Studio');

  // Le Mini App public n'enregistre aucun worker et ne déclare aucun manifeste.
  const publicHtml = read('index.html');
  const publicApp = read('app.js');
  const publicStudio = read('studio.js');
  for (const [name, content] of [['index.html', publicHtml], ['app.js', publicApp], ['studio.js', publicStudio]]) {
    assert.ok(!content.includes('serviceWorker'), `${name} enregistre un service worker`);
    assert.ok(!content.includes('studio-sw.js'), `${name} référence le worker du Studio`);
  }
  assert.ok(!/rel="manifest"/.test(publicHtml), 'le Mini App public déclare un manifeste PWA');
  assert.ok(!publicHtml.includes('manifest.webmanifest'), 'le Mini App public référence le manifeste du Studio');
});

// ——————————————————————————————————————————————————————————————————————————
// H. Surface de connexion : rien de privé, rien de secret, mobile sain
// ——————————————————————————————————————————————————————————————————————————

test('page /studio : formulaire de mot de passe présent, aucun secret, aucune vérification cliente', () => {
  const html = read('studio/index.html');
  assert.ok(html.includes('id="passwordLoginForm"'), 'formulaire de connexion absent');
  assert.ok(html.includes('id="loginEmail"') && html.includes('id="loginPassword"'), 'champs de connexion absents');
  assert.ok(html.includes('type="password"'), 'le mot de passe n’est pas masqué');
  assert.ok(html.includes('autocomplete="current-password"'), 'gestionnaire de mots de passe non pris en charge');
  assert.ok(html.includes('id="loginPasswordToggle"'), 'bascule d’affichage absente');
  assert.ok(html.includes('>Se connecter<'), 'action « Se connecter » absente');
  assert.ok(html.includes('>Email<') && html.includes('>Mot de passe<'), 'libellés français attendus');
  // Aucun secret, aucune empreinte, aucune adresse en dur dans la page servie.
  for (const forbidden of ['PESCE_STUDIO_PASSWORD_HASH', 'scrypt', ADMIN, 'client_secret']) {
    assert.ok(!html.includes(forbidden), `« ${forbidden} » exposé dans la page de connexion`);
  }
  // Aucune inscription publique, aucune réinitialisation : bureau privé mono-autrice.
  for (const absent of ['Créer un compte', 'Inscription', 'Mot de passe oublié', 'Réinitialiser']) {
    assert.ok(!html.includes(absent), `affordance « ${absent} » ajoutée à un bureau privé`);
  }
});

test('client : aucune décision d’authentification côté navigateur, aucun secret journalisé', () => {
  const client = read('studio/web-studio.js');
  assert.ok(client.includes("action: 'password_login'"), 'la connexion par mot de passe n’est pas transmise au serveur');
  // Le client ne compare, ne stocke, ni ne journalise jamais un mot de passe.
  assert.ok(!/localStorage|sessionStorage/.test(client), 'stockage local utilisé pour l’authentification');
  assert.ok(!/console\.(log|warn|error)\([^)]*password/i.test(client), 'un mot de passe peut être journalisé');
  assert.ok(!/password\s*===/.test(client), 'comparaison de mot de passe côté client');
  assert.ok(client.includes("passwordInput.value = ''"), 'la saisie n’est pas effacée après connexion');
});

test('mobile : la coquille tient dans la fenêtre, sans débordement horizontal ni zones coupées', () => {
  const css = read('studio/web-studio.css');
  assert.ok(!/width:\s*100vw/.test(css), '100vw provoque un débordement horizontal permanent');
  assert.ok(/max-width:\s*1023px/.test(css), 'aucune règle de coquille pour téléphone/tablette');
  assert.ok(/100dvh/.test(css), 'hauteur dynamique absente : la navigation sort de l’écran mobile');
  assert.ok(/env\(safe-area-inset-bottom\)/.test(css) && /env\(safe-area-inset-top\)/.test(css), 'zones de sécurité non prises en charge');
  assert.ok(/font-size:\s*16px/.test(css), 'champs sous 16 px : Safari iOS zoome à la saisie');

  const html = read('studio/index.html');
  assert.ok(/viewport-fit=cover/.test(html), 'viewport-fit=cover absent (zones de sécurité inopérantes)');
  assert.ok(/id="studioShell" class="hidden flex flex-col/.test(html), 'la coquille n’est pas une colonne flexible : la navigation mobile retombe sous le contenu');
});

test('hors connexion : état honnête et refus des mutations (jamais de publication simulée)', () => {
  const html = read('studio/index.html');
  assert.ok(html.includes('id="studioOffline"'), 'aucun état de connectivité affiché');
  const client = read('studio/web-studio.js');
  assert.ok(/navigator\.onLine === false/.test(client), 'les mutations ne vérifient pas la connectivité');
  assert.ok(client.includes('Hors connexion'), 'aucun message honnête hors connexion');
  // Aucune mise en file d'attente hors ligne : pas de Background Sync, pas de rejeu différé.
  const worker = read('studio-sw.js');
  assert.ok(!/addEventListener\(\s*['"]sync['"]/.test(worker), 'Background Sync : une publication pourrait partir plus tard, à l’insu de la créatrice');
  assert.ok(!/SyncManager|backgroundFetch|periodicsync|indexedDB/i.test(worker), 'file d’attente de publication hors ligne : publication simulée');
  assert.ok(!/\bqueue\b/i.test(worker), 'file d’attente de mutations dans le worker');
});
