// Configuration unique MTProto (locale uniquement — jamais déployée, jamais committée avec des secrets).
// Crée la session utilisateur autorisée du canal (contrôle des directs/livestreams RTMP,
// réconciliation autoritaire et statistiques Telegram — capacités absentes de la Bot API).
//
// PRÉREQUIS : un identifiant d'application créé sur https://my.telegram.org → API development
// tools (api_id + api_hash). Le script les DEMANDE en saisie masquée s'ils ne sont pas déjà dans
// l'environnement : rien ne passe alors par la ligne de commande, donc rien n'entre dans
// l'historique du shell. Ils ne sont ni affichés, ni écrits sur disque.
//
// LE COMPTE UTILISÉ POUR SE CONNECTER DOIT ÊTRE ADMINISTRATEUR DU CANAL : sans cela Telegram
// répond CHAT_ADMIN_REQUIRED sur les directs et les statistiques, quelle que soit la validité
// de la session.
//
// Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mtproto-setup.mjs
//
// Le script affiche la chaîne de session UNIQUEMENT sur votre terminal : sauvegardez-la
// immédiatement dans Vercel (PESCE_MT_PROTO_SESSION, type Secret), puis redéployez.
// Ne la collez jamais dans le dépôt, un ticket, un chat ou un navigateur.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'node:readline/promises';
import { readSecret } from './secret-prompt.mjs';

async function credentials() {
  const fromEnv = { apiId: Number(process.env.PESCE_MT_PROTO_API_ID), apiHash: process.env.PESCE_MT_PROTO_API_HASH };
  if (fromEnv.apiId && fromEnv.apiHash) return fromEnv;
  console.error('Identifiants d’application Telegram (my.telegram.org → API development tools).');
  console.error('La saisie reste invisible ; rien n’est affiché ni enregistré.\n');
  const apiId = Number((await readSecret('api_id   : ')).trim());
  const apiHash = (await readSecret('api_hash : ')).trim();
  return { apiId, apiHash };
}

let apiId;
let apiHash;
try {
  ({ apiId, apiHash } = await credentials());
} catch (error) {
  console.error(`\n${error.message || error}`);
  process.exit(1);
}
if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error('\nIdentifiants invalides : api_id doit être un nombre et api_hash ne peut pas être vide.');
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
const input = readline.createInterface({ input: process.stdin, output: process.stdout });

console.error('\nConnectez-vous avec le compte ADMINISTRATEUR du canal.');
await client.start({
  phoneNumber: async () => input.question('Numéro de téléphone (format international) : '),
  // Le mot de passe 2FA est un secret : saisie masquée, jamais affichée.
  password: async () => readSecret('Mot de passe 2FA (laisser vide si absent) : '),
  phoneCode: async () => input.question('Code reçu sur Telegram : '),
  onError: (error) => console.error('Erreur de connexion :', error.message),
});
input.close();

// Contrôle de cohérence : le compte connecté est-il bien celui qu'on croit ?
try {
  const me = await client.getMe();
  const name = [me?.firstName, me?.lastName].filter(Boolean).join(' ') || me?.username || 'compte connecté';
  console.error(`\nConnecté en tant que : ${name}${me?.username ? ` (@${me.username})` : ''}`);
  console.error('Vérifiez que CE compte est administrateur du canal, sinon les statistiques et');
  console.error('les directs continueront de répondre « droits d’administration manquants ».');
} catch { /* contrôle indicatif : un échec ici n'invalide pas la session */ }

const session = client.session.save();
console.error('\nConfiguration réussie. Collez cette chaîne dans Vercel (PESCE_MT_PROTO_SESSION, type Secret), puis redéployez :');
console.log(session);
console.error('\nN’oubliez pas PESCE_MT_PROTO_API_ID et PESCE_MT_PROTO_API_HASH dans Vercel (type Secret).');
console.error('Ne collez jamais ces valeurs dans le dépôt, un ticket ou un chat.');
await client.disconnect();
process.exit(0);
