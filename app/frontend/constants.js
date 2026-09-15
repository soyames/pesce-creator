// Identité et configuration partagées de Pesce Studio.
// Chargé de trois façons : <script src> classique (navigateur), import via lib/config.js (fonctions serveur),
// et import direct (tests). Aucun import ni export ici — l'assignation globalThis est le seul mécanisme
// compatible avec les trois contextes sans bundler ni étape de build.
// Ce fichier est servi publiquement : aucune donnée secrète ne doit y figurer.
(function () {
  if (globalThis.PESCE) return; // déjà chargé (par ex. inclus dans le bundle d'une fonction serveur)

  const freeze = (value) => Object.freeze(value);

  const STAR_TIERS = freeze([
    freeze({ amount: 50, label: 'Petit soutien' }),
    freeze({ amount: 100, label: 'Soutien' }),
    freeze({ amount: 250, label: 'Grand soutien' }),
    freeze({ amount: 500, label: 'Soutien majeur' }),
    freeze({ amount: 1000, label: 'Soutien exceptionnel' }),
  ]);

  const SUPPORT_TOPICS = freeze([
    freeze({ value: 'stars', label: 'Paiement / Étoiles' }),
    freeze({ value: 'contenu', label: 'Contenus' }),
    freeze({ value: 'autre', label: 'Autre sujet' }),
  ]);

  const MINI_APP_URL = 'https://pesce-creator-nine.vercel.app/';
  const BOT_URL = 'https://t.me/PesceStudioBot';

  // Lien PUBLIC et partageable d'une publication : il ouvre le journal complet sur cet article
  // (navigateur ordinaire comme Telegram) — jamais une page isolée. Source unique : aucun
  // composant ne doit reconstruire cette forme à la main.
  const articleLink = (postId) => `${MINI_APP_URL}?post=${encodeURIComponent(String(postId || ''))}`;

  // Équivalent Telegram : ouvre le Mini App directement sur la publication. Le paramètre de
  // démarrage Telegram n'accepte que [A-Za-z0-9_-] (64 caractères max) ; hors de ce jeu, on
  // renvoie null et l'appelant retombe sur le lien web, qui fonctionne partout.
  const articleTelegramLink = (postId) => {
    const id = String(postId || '');
    return /^[A-Za-z0-9_-]{1,58}$/.test(id) ? `${BOT_URL}?startapp=post_${id}` : null;
  };

  globalThis.PESCE = freeze({
    APP_NAME: 'Pesce Studio',
    CREATOR_NAME: 'Pesce Hounyo',
    TAGLINE: 'Journaliste · Société · Opinion',
    BOT_USERNAME: 'PesceStudioBot',
    BOT_URL,
    CHANNEL_USERNAME: 'PesceHounyoOfficiel',
    CHANNEL_HANDLE: '@PesceHounyoOfficiel',
    CHANNEL_URL: 'https://t.me/PesceHounyoOfficiel',
    SUPPORT_URL: 'https://t.me/PesceStudioBot?startapp=support',
    STUDIO_URL: 'https://t.me/PesceStudioBot?startapp=studio',
    // Bureau privé sur le web (portail de bureau, connexion mot de passe ou Google).
    // Adresse canonique unique : aucun composant ne la reconstruit à la main.
    WEB_STUDIO_URL: `${MINI_APP_URL}studio`,
    MINI_APP_URL,
    YOUTUBE_HANDLE: '@gnonnouxopescehounyo2576',
    YOUTUBE_URL: 'https://www.youtube.com/@gnonnouxopescehounyo2576',
    STAR_TIERS,
    SUPPORT_TOPICS,
    articleLink,
    articleTelegramLink,
  });
})();
