// Jetons signés pour le proxy média /api/media (photos, audios, vidéos Telegram).
// Format du jeton : <expiration>.<hmac> avec hmac = HMAC-SHA256(secret, `${fileId}:${expiration}`).
// Le secret par défaut est le token du bot (déjà requis par getFile) : aucun nouvel env obligatoire.
import crypto from 'node:crypto';

export const MEDIA_TTL_SECONDS = 12 * 60 * 60; // 12 h
export const MEDIA_CLOCK_TOLERANCE_SECONDS = 60;

export function signMedia(fileId, { secret, ttlSeconds = MEDIA_TTL_SECONDS, now = Date.now() } = {}) {
  if (!secret) throw new Error('Secret de signature média manquant.');
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const hmac = crypto.createHmac('sha256', secret).update(`${fileId}:${exp}`).digest('hex');
  return `${exp}.${hmac}`;
}

export function verifyMediaToken(fileId, token, { secret, now = Date.now() } = {}) {
  if (!secret || typeof token !== 'string' || !fileId) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const exp = Number(token.slice(0, dot));
  const received = token.slice(dot + 1);
  if (!Number.isFinite(exp)) return false;
  const nowSeconds = Math.floor(now / 1000);
  if (exp < nowSeconds - MEDIA_CLOCK_TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${fileId}:${exp}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex')); } catch { return false; }
}
