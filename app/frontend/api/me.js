// Rôle de l'utilisateur Telegram courant pour la Mini App.
// Aucune dépendance Firestore : cette route doit répondre même si Firestore est indisponible.
import { creatorTelegramUserIds, isCreatorTelegramUser, telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';

let creatorNotConfiguredWarned = false;
function warnCreatorNotConfiguredOnce() {
  if (creatorNotConfiguredWarned) return;
  creatorNotConfiguredWarned = true;
  console.warn('Aucun identifiant créatrice configuré (PESCE_CREATOR_TELEGRAM_USER_IDS) : le studio restera masqué pour tout le monde. Voir README.');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Méthode non autorisée.' });

  const token = process.env.TELEGRAM_PESCE_BOT_TOKEN;
  if (!token) return res.status(503).json({ user: null, isCreator: false, message: 'Bot Telegram non configuré.' });

  try {
    const initData = typeof req.headers['x-telegram-init-data'] === 'string' ? req.headers['x-telegram-init-data'] : '';
    if (!validateTelegramInitData(initData, token)) return res.status(401).json({ user: null, isCreator: false, message: 'Session Telegram invalide ou expirée.' });

    const user = telegramUserFromInitData(initData);
    const creatorConfigured = creatorTelegramUserIds().length > 0;
    if (!creatorConfigured) warnCreatorNotConfiguredOnce();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      user: {
        id: user?.id ?? null,
        firstName: user?.first_name ?? null,
        lastName: user?.last_name ?? null,
        username: user?.username ?? null,
        languageCode: user?.language_code ?? null,
        isPremium: Boolean(user?.is_premium),
      },
      isCreator: Boolean(user?.id && isCreatorTelegramUser(user.id)),
      creatorConfigured,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ user: null, isCreator: false, message: 'Impossible de déterminer le rôle.' });
  }
}
