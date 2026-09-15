// Diagnostic MTProto (local uniquement — jamais déployé). Répond à UNE question : la session
// configurée peut-elle réellement faire ce que le Studio lui demande ?
//
// Il n'affiche QUE des statuts. Aucun identifiant, aucune empreinte, aucune chaîne de session
// n'est imprimée — conformément à la règle permanente du projet (vérifier un secret = rapporter
// SET / MISSING / VALID / INVALID, jamais la valeur).
//
// Usage :
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mtproto-doctor.mjs \
//     [--credentials <fichier my.telegram.org>] [--session <fichier contenant la session>]
//
// Les identifiants peuvent venir de l'environnement (PESCE_MT_PROTO_API_ID / API_HASH /
// SESSION) ou de fichiers locaux : rien ne transite par la ligne de commande, donc rien
// n'entre dans l'historique du shell.
import { readFileSync } from 'node:fs';
import { normalizeBroadcastStats } from '../lib/mtproto.js';
import { CHANNEL_USERNAME } from '../lib/config.js';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

// Lecture tolérante d'un export my.telegram.org : on cherche l'étiquette puis la valeur qui
// suit (même séparée par un retour à la ligne). Les valeurs ne sont jamais imprimées.
function credentialsFromFile(path) {
  const text = readFileSync(path, 'utf8');
  const apiId = (text.match(/api[_\s-]*id\D{0,20}(\d{5,12})/i) || [])[1];
  const apiHash = (text.match(/api[_\s-]*hash\W{0,20}([0-9a-f]{32})/i) || [])[1];
  return { apiId: Number(apiId), apiHash };
}

function resolveConfig() {
  const credentialsPath = argument('credentials');
  const sessionPath = argument('session');
  let apiId = Number(process.env.PESCE_MT_PROTO_API_ID);
  let apiHash = process.env.PESCE_MT_PROTO_API_HASH;
  if ((!apiId || !apiHash) && credentialsPath) {
    const parsed = credentialsFromFile(credentialsPath);
    apiId = apiId || parsed.apiId;
    apiHash = apiHash || parsed.apiHash;
  }
  const session = sessionPath ? readFileSync(sessionPath, 'utf8').trim() : (process.env.PESCE_MT_PROTO_SESSION || '');
  return { apiId, apiHash, session };
}

const status = (label, ok, detail = '') => console.log(`${ok ? 'OK     ' : 'ÉCHEC  '}${label}${detail ? ` — ${detail}` : ''}`);

async function main() {
  const { apiId, apiHash, session } = resolveConfig();
  status('api_id', Boolean(apiId), apiId ? 'SET' : 'MISSING');
  status('api_hash', Boolean(apiHash), apiHash ? 'SET' : 'MISSING');
  status('session', Boolean(session), session ? 'SET' : 'MISSING');
  if (!apiId || !apiHash || !session) {
    console.log('\nConfiguration incomplète : voir la procédure unique dans CLAUDE.md.');
    process.exitCode = 1;
    return;
  }

  const { TelegramClient, Api } = await import('telegram');
  const { StringSession } = await import('telegram/sessions/index.js');
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 2, timeout: 20000 });

  try {
    await client.connect();
    status('connexion Telegram', true);
  } catch (error) {
    status('connexion Telegram', false, error.message);
    process.exitCode = 1;
    return;
  }

  let me = null;
  try {
    me = await client.getMe();
    status('session valide', true, `connectée en tant que @${me?.username || me?.firstName || 'compte'}`);
  } catch (error) {
    status('session valide', false, error.message);
    await client.disconnect();
    process.exitCode = 1;
    return;
  }

  let peer = null;
  try {
    peer = await client.getEntity(CHANNEL_USERNAME);
    status(`accès au canal @${CHANNEL_USERNAME}`, true);
  } catch (error) {
    status(`accès au canal @${CHANNEL_USERNAME}`, false, `${error.message} — ce compte ne voit pas le canal`);
    await client.disconnect();
    process.exitCode = 1;
    return;
  }

  // Droits d'administration : la question qui décide de tout le reste.
  let isAdmin = false;
  try {
    const full = await client.invoke(new Api.channels.GetParticipant({ channel: peer, participant: 'me' }));
    const kind = full?.participant?.className || '';
    isAdmin = /Creator|Admin/i.test(kind);
    status('droits d’administration sur le canal', isAdmin, isAdmin ? kind : `${kind || 'simple membre'} — les statistiques et les directs resteront refusés`);
  } catch (error) {
    status('droits d’administration sur le canal', false, error.message);
  }

  // Statistiques de diffusion, en suivant la migration de centre de données si Telegram la demande.
  try {
    const request = new Api.stats.GetBroadcastStats({ channel: peer });
    let raw;
    try {
      raw = await client.invoke(request);
    } catch (error) {
      const migrate = String(error?.message || '').match(/STATS_MIGRATE_(\d+)/i);
      if (!migrate) throw error;
      console.log(`       (Telegram demande le centre de données ${migrate[1]} — requête rejouée)`);
      raw = await client.invoke(request, Number(migrate[1]));
    }
    const stats = normalizeBroadcastStats(raw);
    if (!stats) {
      status('statistiques de diffusion', false, 'Telegram a répondu sans mesure exploitable (canal trop petit ?)');
    } else {
      status('statistiques de diffusion', true);
      console.log(`       abonnés ${stats.followers ?? '—'} · vues/publication ${stats.viewsPerPost ?? '—'} · partages/publication ${stats.sharesPerPost ?? '—'} · réactions/publication ${stats.reactionsPerPost ?? '—'}`);
    }
  } catch (error) {
    // Même code d'erreur pour deux causes très différentes : le dire précisément.
    if (isAdmin && /CHAT_ADMIN_REQUIRED/i.test(error.message || '')) {
      status('statistiques de diffusion', false, 'Telegram ne les ouvre pas encore pour ce canal (seuil d’abonnés) — la configuration, elle, est correcte');
    } else {
      status('statistiques de diffusion', false, error.message);
    }
  }

  // Flux RTMP du direct : on vérifie seulement que Telegram RÉPOND, jamais la valeur de la clé.
  try {
    const rtmp = await client.invoke(new Api.phone.GetGroupCallStreamRtmpUrl({ peer, revoke: false }));
    status('flux RTMP des directs', Boolean(rtmp?.url && rtmp?.key), 'serveur et clé fournis (valeurs non affichées)');
  } catch (error) {
    status('flux RTMP des directs', false, error.message);
  }

  await client.disconnect();
  console.log('\nAucun identifiant, aucune clé et aucune session n’ont été affichés.');
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
