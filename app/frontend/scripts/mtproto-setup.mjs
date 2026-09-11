// Configuration unique MTProto (locale uniquement — jamais déployée, jamais committée avec des secrets).
// Crée la session utilisateur autorisée du canal (contrôle des directs/livestreams RTMP,
// réconciliation autoritaire et statistiques Telegram — capacités absentes de la Bot API).
// PRÉREQUIS (créés sur https://my.telegram.org → API development tools) :
//   PESCE_MT_PROTO_API_ID et PESCE_MT_PROTO_API_HASH en variables d'environnement locales.
// Usage : node scripts/mtproto-setup.mjs   (puis suivre la connexion interactive)
// Le script affiche la chaîne de session UNIQUEMENT sur votre terminal : sauvegardez-la
// immédiatement dans la variable d'environnement Vercel PESCE_MT_PROTO_SESSION (Secret).
// Ne la collez jamais dans le dépôt, un ticket, un chat ou un navigateur.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import readline from 'node:readline/promises';

const apiId = Number(process.env.PESCE_MT_PROTO_API_ID);
const apiHash = process.env.PESCE_MT_PROTO_API_HASH;
if (!apiId || !apiHash) {
  console.error('PESCE_MT_PROTO_API_ID / PESCE_MT_PROTO_API_HASH manquants — voir my.telegram.org.');
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });
const input = readline.createInterface({ input: process.stdin, output: process.stdout });

await client.start({
  phoneNumber: async () => input.question('Numéro de téléphone (format international) : '),
  password: async () => input.question('Mot de passe 2FA (laisser vide si absent) : '),
  phoneCode: async () => input.question('Code reçu sur Telegram : '),
  onError: (error) => console.error('Erreur de connexion :', error.message),
});
input.close();

const session = client.session.save();
console.log('\nConfiguration réussie. Sauvegardez cette chaîne dans Vercel (variable PESCE_MT_PROTO_SESSION, type Secret) :');
console.log('PESCE_MT_PROTO_SESSION=' + session);
console.log('Ne collez jamais cette chaîne dans le dépôt ou un canal public.');
await client.disconnect();
process.exit(0);
