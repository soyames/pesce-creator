import crypto from 'node:crypto';

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function validateTelegramInitData(initData, botToken, maxAgeSeconds = MAX_AUTH_AGE_SECONDS) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!receivedHash || !Number.isFinite(authDate)) return false;
  const age = Math.floor(Date.now() / 1000) - authDate;
  if (age < -60 || age > maxAgeSeconds) return false;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => `${key}=${value}`).join('\n');
  const secretKey = crypto.createHmac('sha256','WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256',secretKey).update(dataCheckString).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(calculatedHash,'hex'),Buffer.from(receivedHash,'hex')); } catch { return false; }
}

export function telegramUserFromInitData(initData) {
  if (!initData) return null;
  try { const user = new URLSearchParams(initData).get('user'); return user ? JSON.parse(user) : null; } catch { return null; }
}

// Identifiants Telegram de la créatrice (et de comptes temporaires/futurs).
// Source : PESCE_CREATOR_TELEGRAM_USER_IDS (liste séparée par des virgules, documentée) avec
// repli sur PESCE_CREATOR_TELEGRAM_USER_ID (singulier, historique). Aucun identifiant configuré → [].
export function creatorTelegramUserIds(env = process.env) {
  const raw = String(env.PESCE_CREATOR_TELEGRAM_USER_IDS || env.PESCE_CREATOR_TELEGRAM_USER_ID || '').trim();
  if (!raw) return [];
  return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
}

export function isCreatorTelegramUser(userId) {
  return creatorTelegramUserIds().includes(String(userId || ''));
}
