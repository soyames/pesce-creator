// Vérification serveur des jetons d'identité Google (OpenID Connect, flux « Sign in with Google »).
// Aucune dépendance : clés publiques JWKS de Google (mises en cache), vérification RS256 avec
// node:crypto, puis contrôles des revendications (émetteur, audience, expiration, e-mail vérifié).
// Le secret client OAuth n'est PAS nécessaire pour ce flux : seuls l'identifiant public
// GOOGLE_OAUTH_CLIENT_ID (audience) et la vérification de signature font foi.
import crypto from 'node:crypto';

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CERTS_TTL_MS = 3600 * 1000;

let cachedCerts = null;
let cachedAt = 0;

function base64urlDecode(value) {
  const base64 = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

function parseJwt(token) {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(base64urlDecode(parts[0])),
      payload: JSON.parse(base64urlDecode(parts[1])),
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
    };
  } catch {
    return null;
  }
}

async function googlePublicKeys(certsUrl) {
  if (cachedCerts && Date.now() - cachedAt < CERTS_TTL_MS) return cachedCerts;
  const response = await fetch(certsUrl || GOOGLE_CERTS_URL);
  if (!response.ok) throw new Error(`Clés Google indisponibles (${response.status}).`);
  const data = await response.json();
  // Le point de terminaison JWKS de Google renvoie { keys: [{ kid, n, e, … }, …] } :
  // on le normalise en table kid → JWK avant toute recherche.
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedCerts = Object.fromEntries(keys.map((key) => [key.kid, key]));
  cachedAt = Date.now();
  return cachedCerts;
}

// Construit la clé publique RSA à partir du JWK (n, e) de la clé correspondant au kid.
// Le certificat x5c n'est PAS utilisable directement comme clé publique : on passe par n/e.
function jwkToPublicKey(jwk) {
  return crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
}

// Vérifie la signature du jeton avec la clé Google correspondant à son kid.
// `certs` (map kid → JWK) peut être injecté pour les tests ; sinon on utilise les JWKS de Google.
async function verifySignature(parsed, { certs, certsUrl } = {}) {
  const keys = certs || (await googlePublicKeys(certsUrl));
  const jwk = keys[parsed.header?.kid];
  if (!jwk || (!jwk.n || !jwk.e)) return false;
  const key = jwkToPublicKey(jwk);
  return crypto.verify('sha256', Buffer.from(parsed.signingInput), key, parsed.signature);
}

// Revendications exigées pour un jeton d'identité Google destiné à ce Studio.
export function validateGoogleClaims(payload, { clientId, now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.alg === 'HS256') return null; // jamais de clé symétrique pour un jeton Google
  if (!GOOGLE_ISSUERS.includes(payload.iss)) return null;
  if (!clientId || payload.aud !== clientId) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= now) return null;
  if (payload.email_verified !== true && payload.email_verified !== 'true') return null;
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  return email;
}

// Point d'entrée : renvoie l'adresse vérifiée, ou null si le jeton est invalide/expiré.
// `certs` (map kid → JWK) et `certsUrl` (endpoint JWKS) sont injectables pour les tests ;
// en production, ce sont les JWKS de Google.
export async function verifyGoogleIdToken(token, { clientId, certs, certsUrl } = {}) {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  if (parsed.header?.alg !== 'RS256') return null;
  try {
    if (!(await verifySignature(parsed, { certs, certsUrl }))) return null;
  } catch (error) {
    console.error('google id token verification failed', error);
    return null; // clés Google injoignables : refus par défaut (fail-closed)
  }
  return validateGoogleClaims(parsed.payload, { clientId });
}

// Liste des adresses autorisées : variable d'environnement PESCE_WEB_ADMIN_EMAILS (séparées par
// des virgules), avec l'administrateur du Studio comme valeur par défaut documentée.
export const DEFAULT_WEB_ADMIN_EMAILS = ['pescestudio8@gmail.com'];

export function webAdminEmails(env = process.env) {
  const raw = env.PESCE_WEB_ADMIN_EMAILS;
  if (!raw || !String(raw).trim()) return DEFAULT_WEB_ADMIN_EMAILS;
  return String(raw).split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
}

export function isWebAdminEmail(email, env = process.env) {
  const normalized = String(email || '').trim().toLowerCase();
  return Boolean(normalized) && webAdminEmails(env).includes(normalized);
}
