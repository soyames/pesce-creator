// Vue ESM des constantes partagées (définies dans ../constants.js) pour les fonctions serveur et les tests.
// constants.js est un script classique sans import ni export : le pont globalThis est confiné ici,
// afin que les fichiers api/*.js lisent des imports ESM normaux.
import '../constants.js';

const P = globalThis.PESCE;
if (!P) throw new Error('constants.js manquant : globalThis.PESCE est introuvable.');

export const APP_NAME = P.APP_NAME;
export const CREATOR_NAME = P.CREATOR_NAME;
export const TAGLINE = P.TAGLINE;
export const BOT_USERNAME = P.BOT_USERNAME;
export const BOT_URL = P.BOT_URL;
export const CHANNEL_USERNAME = P.CHANNEL_USERNAME;
export const CHANNEL_HANDLE = P.CHANNEL_HANDLE;
export const CHANNEL_URL = P.CHANNEL_URL;
export const SUPPORT_URL = P.SUPPORT_URL;
export const STUDIO_URL = P.STUDIO_URL;
export const MINI_APP_URL = P.MINI_APP_URL;
export const YOUTUBE_HANDLE = P.YOUTUBE_HANDLE;
export const YOUTUBE_URL = P.YOUTUBE_URL;
export const STAR_TIERS = P.STAR_TIERS;
export const SUPPORT_TOPICS = P.SUPPORT_TOPICS;
export default P;
