// Authentification par mot de passe du Studio créatrice WEB (/studio) — vérification SERVEUR.
//
// Le mot de passe n'existe NULLE PART dans le dépôt, la base ou les journaux : seule son
// empreinte scrypt vit dans la variable d'environnement PESCE_STUDIO_PASSWORD_HASH (Vercel,
// type Secret), produite localement par scripts/generate-studio-password-hash.mjs.
//
// scrypt (RFC 7914, node:crypto) est une fonction de dérivation de clé conçue POUR les mots de
// passe : coût mémoire ET calcul paramétrés. Jamais de SHA-256 nu — un condensat rapide se
// force en masse. Aucune dépendance ajoutée : l'implémentation native de Node suffit.
//
// La session créée après vérification est la MÊME que celle de la connexion Google
// (lib/web-session.js) : jeton aléatoire 256 bits, empreinte SHA-256 dans Neon, cookie
// HttpOnly/Secure/SameSite, expiration à 7 jours. Aucun système d'authentification parallèle.
import crypto from 'node:crypto';
import { db } from './db.js';

// Paramètres de coût : N=2^15, r=8, p=1 (~32 Mio, ~100 ms) — robuste et compatible avec la
// durée d'exécution d'une fonction serverless. `maxmem` doit dépasser 128 × N × r.
export const SCRYPT_PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 32 });
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
const SALT_BYTES = 16;
const MAX_PASSWORD_BYTES = 1024; // borne de sûreté : aucun scrypt sur une entrée démesurée

// Fenêtre et seuil de limitation des tentatives (protection contre la force brute).
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 8;
const LOGIN_RETENTION_MS = 24 * 3600 * 1000;

// Normalisation d'adresse : espaces retirés, casse repliée. Rien d'autre — aucune réécriture
// « intelligente » (points, alias +) qui élargirait silencieusement la liste d'autorisation.
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function deriveKey(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

// Format d'empreinte auto-descriptif : les paramètres de coût voyagent AVEC l'empreinte, donc
// un durcissement futur n'invalide pas les empreintes déjà posées.
//   scrypt$N=32768,r=8,p=1$<sel base64url>$<empreinte base64url>
export async function hashPassword(password, { params = SCRYPT_PARAMS, salt = crypto.randomBytes(SALT_BYTES) } = {}) {
  if (typeof password !== 'string' || !password) throw new Error('Mot de passe vide.');
  const { N, r, p, keylen } = { ...SCRYPT_PARAMS, ...params };
  const derived = await deriveKey(password, salt, { N, r, p, keylen });
  return `scrypt$N=${N},r=${r},p=${p}$${Buffer.from(salt).toString('base64url')}$${derived.toString('base64url')}`;
}

// Analyse d'une empreinte encodée. Renvoie null (jamais une exception) sur toute forme invalide :
// une variable d'environnement mal collée doit refuser la connexion, pas faire tomber la route.
export function parsePasswordHash(encoded) {
  const parts = String(encoded ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null;
  const params = {};
  for (const pair of parts[1].split(',')) {
    const [key, value] = pair.split('=');
    params[key] = Number(value);
  }
  const { N, r, p } = params;
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 1024 || r < 1 || p < 1 || (N & (N - 1)) !== 0) return null; // N doit être une puissance de 2
  const salt = Buffer.from(parts[2], 'base64url');
  const hash = Buffer.from(parts[3], 'base64url');
  if (!salt.length || hash.length < 16) return null;
  return { N, r, p, keylen: hash.length, salt, hash };
}

// Vérification à temps constant. Toute anomalie (empreinte absente/illisible, mot de passe vide
// ou démesuré) répond « faux » — fail closed, sans distinction observable pour l'appelant.
export async function verifyPassword(password, encoded) {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  if (typeof password !== 'string' || !password) return false;
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false;
  let derived;
  try {
    derived = await deriveKey(password, parsed.salt, parsed);
  } catch (error) {
    console.error('scrypt derivation failed', error.message); // jamais la valeur saisie
    return false;
  }
  return derived.length === parsed.hash.length && crypto.timingSafeEqual(derived, parsed.hash);
}

// Empreinte configurée (noms de variables uniquement dans les journaux — jamais la valeur).
export function studioPasswordHash(env = process.env) {
  return String(env.PESCE_STUDIO_PASSWORD_HASH || '').trim();
}

export function isPasswordLoginConfigured(env = process.env) {
  return parsePasswordHash(studioPasswordHash(env)) !== null;
}

// — Limitation des tentatives (Neon, même base que les sessions : aucun service ajouté).
// La clé de regroupement est une EMPREINTE de l'adresse réseau : aucune donnée personnelle
// en clair, et aucune corrélation avec l'adresse e-mail tentée (qui fuiterait sa validité).
export function loginScope(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || String(req?.headers?.['x-real-ip'] || '') || req?.socket?.remoteAddress || 'inconnu';
  return crypto.createHash('sha256').update(`pesce-studio-login:${address}`).digest('hex').slice(0, 32);
}

// `client` (accès Neon) est injectable pour les tests ; en production c'est le pool de lib/db.js.
export async function loginFailureCount(scope, { now = new Date(), windowMs = LOGIN_WINDOW_MS, client = null } = {}) {
  const result = await (client || db()).query(
    'SELECT count(*)::int AS failures FROM pesce_login_attempts WHERE scope = $1 AND created_at > $2',
    [scope, new Date(now.getTime() - windowMs)]
  );
  return Number(result.rows[0]?.failures || 0);
}

export async function recordLoginFailure(scope, { now = new Date(), client = null } = {}) {
  const access = client || db();
  await access.query('INSERT INTO pesce_login_attempts (scope, created_at) VALUES ($1, $2)', [scope, now]);
  // Purge opportuniste : la table ne conserve jamais d'historique au-delà de 24 h.
  await access.query('DELETE FROM pesce_login_attempts WHERE created_at < $1', [new Date(now.getTime() - LOGIN_RETENTION_MS)]);
}

export async function clearLoginFailures(scope, { client = null } = {}) {
  await (client || db()).query('DELETE FROM pesce_login_attempts WHERE scope = $1', [scope]);
}
