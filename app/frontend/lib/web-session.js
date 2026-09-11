// Sessions web du Studio créatrice (Google OAuth) : côté serveur uniquement.
// Le client ne reçoit qu'un jeton aléatoire dans un cookie HttpOnly/Secure/SameSite ;
// Neon ne stocke que l'empreinte SHA-256 du jeton + l'adresse autorisée + l'expiration.
// Aucun secret d'environnement n'est requis : le jeton est généré à la connexion.
import crypto from 'node:crypto';
import { db } from './db.js';

export const WEB_SESSION_COOKIE = 'pesce_web_session';
export const WEB_SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours

export function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function sessionCookieHeader(token, { maxAgeSeconds = WEB_SESSION_TTL_MS / 1000, secure = true } = {}) {
  const attributes = [
    `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearSessionCookieHeader(secure = true) {
  const attributes = [`${WEB_SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export async function createWebSession(email, { ttlMs = WEB_SESSION_TTL_MS, now = new Date() } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db().query(
    `INSERT INTO pesce_web_sessions (token_hash, email, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [tokenHash(token), email, now, expiresAt]
  );
  return { token, expiresAt };
}

// Valide la session portée par la requête : cookie → empreinte → ligne non expirée.
// Renvoie l'adresse autorisée, ou null (session absente, inconnue ou expirée).
export async function webSessionEmailFromRequest(req, { now = new Date() } = {}) {
  const token = parseCookies(req.headers?.cookie)[WEB_SESSION_COOKIE];
  if (!token) return null;
  const result = await db().query(
    `SELECT email, expires_at FROM pesce_web_sessions WHERE token_hash = $1`,
    [tokenHash(token)]
  );
  const row = result.rows[0];
  if (!row) return null;
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (isNaN(expiresAt) || expiresAt.getTime() <= now.getTime()) {
    await destroyWebSession(req).catch(() => {});
    return null;
  }
  return row.email;
}

export async function destroyWebSession(req) {
  const token = parseCookies(req.headers?.cookie)[WEB_SESSION_COOKIE];
  if (!token) return null;
  await db().query(`DELETE FROM pesce_web_sessions WHERE token_hash = $1`, [tokenHash(token)]);
  return token;
}
