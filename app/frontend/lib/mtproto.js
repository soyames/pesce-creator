// Façade MTProto (session utilisateur autorisée) pour les capacités que la Bot API ne fournit
// PAS : contrôle des directs/livestreams du canal (RTMP), historique du canal et statistiques.
//   - La session est serveur uniquement : variables d'environnement PESCE_MT_PROTO_API_ID,
//     PESCE_MT_PROTO_API_HASH et PESCE_MT_PROTO_SESSION (jamais dans le dépôt, jamais dans le
//     navigateur, jamais dans Neon).
//   - Sans configuration : TOUTE opération échoue avec une erreur explicite (fail-closed) —
//     jamais d'invention d'état, jamais d'URL/clé fabriquée.
//   - Configuration unique documentée dans CLAUDE.md (scripts/mtproto-setup.mjs local).
const NOT_CONFIGURED = 'MTProto non configuré : voir la procédure de configuration unique dans CLAUDE.md (PESCE_MT_PROTO_API_ID / API_HASH / SESSION).';

export function mtProtoConfigured(env = process.env) {
  return Boolean(env.PESCE_MT_PROTO_API_ID && env.PESCE_MT_PROTO_API_HASH && env.PESCE_MT_PROTO_SESSION);
}

let clientPromise = null;

export async function mtProtoClient() {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  if (!clientPromise) {
    clientPromise = (async () => {
      const { TelegramClient } = await import('telegram');
      const { StringSession } = await import('telegram/sessions/index.js');
      const client = new TelegramClient(
        new StringSession(process.env.PESCE_MT_PROTO_SESSION),
        Number(process.env.PESCE_MT_PROTO_API_ID),
        process.env.PESCE_MT_PROTO_API_HASH,
        { connectionRetries: 2, timeout: 20000 }
      );
      await client.connect();
      return client;
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

// Serveur RTMP et clé de stream du direct du canal (utilisateur autorisé uniquement).
// Telegram fournit cette paire via phone.getGroupCallStreamRtmpUrl — la clé est un secret :
// elle ne transite que par l'API authentifiée du Studio, jamais par une route publique.
export async function getChannelRtmp({ channelUsername }) {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  const client = await mtProtoClient();
  const { Api } = await import('telegram');
  const peer = await client.getEntity(channelUsername);
  const result = await client.invoke(new Api.phone.GetGroupCallStreamRtmpUrl({ peer, revoke: false }));
  return { url: result.url, key: result.key };
}

// État autoritaire du direct du canal (MTProto) : renvoie null si aucun appel actif connu.
export async function getChannelLiveState({ channelUsername }) {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  const client = await mtProtoClient();
  const { Api } = await import('telegram');
  const peer = await client.getEntity(channelUsername);
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: peer }));
  const call = full.fullChat?.call;
  if (!call) return null;
  // Appels de groupe : actif tant qu'ils ne sont pas terminés (le schéma expose le champ live).
  const live = call instanceof Api.GroupCall && !call.scheduleDate && !call.finished;
  return { active: Boolean(live), title: call.title || null };
}

// Vérifie l'existence d'un message du canal (réconciliation autoritaire, Phase 2).
export async function channelMessageExists({ channelUsername, messageId }) {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  const client = await mtProtoClient();
  const { Api } = await import('telegram');
  const peer = await client.getEntity(channelUsername);
  const result = await client.invoke(new Api.channels.GetMessages({ channel: peer, id: [new Api.InputMessageID({ id: Number(messageId) })] }));
  const messages = result.messages || [];
  return messages.length > 0;
}

// — Lecture des statistiques de diffusion renvoyées par Telegram (stats.broadcastStats).
//
// Telegram ne renvoie PAS de compteurs bruts : il renvoie des valeurs « actuelle / précédente »
// (StatsAbsValueAndPrev) et des MOYENNES PAR PUBLICATION pour les vues, partages et réactions.
// Les lire comme des totaux serait inventer des chiffres. Renvoie null si la forme n'est pas
// reconnue — mieux vaut dire « indisponible » qu'afficher des zéros qui passeraient pour des
// mesures réelles.
export function normalizeBroadcastStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const current = (value) => {
    const number = Number(value?.current);
    return Number.isFinite(number) ? Math.round(number) : null;
  };
  const followers = current(stats.followers);
  const viewsPerPost = current(stats.viewsPerPost);
  const sharesPerPost = current(stats.sharesPerPost);
  const reactionsPerPost = current(stats.reactionsPerPost);
  if (followers === null && viewsPerPost === null && sharesPerPost === null && reactionsPerPost === null) return null;

  const part = Number(stats.enabledNotifications?.part);
  const total = Number(stats.enabledNotifications?.total);
  const notificationsPercent = Number.isFinite(part) && Number.isFinite(total) && total > 0
    ? Math.round((part / total) * 100)
    : null;

  const toIso = (seconds) => {
    const value = Number(seconds);
    return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
  };
  return {
    followers,
    viewsPerPost,
    sharesPerPost,
    reactionsPerPost,
    notificationsPercent,
    period: { from: toIso(stats.period?.minDate), to: toIso(stats.period?.maxDate) },
  };
}

// Statistiques de diffusion du canal (Phase 3) — honnêtement indisponible sans configuration.
// Telegram héberge les statistiques d'un canal sur un centre de données précis : la première
// requête peut répondre STATS_MIGRATE_<dc>, auquel cas il faut la rejouer sur ce centre. Sans
// ce rejeu, les statistiques échouent alors même que la session est parfaitement valide.
export async function getChannelBroadcastStats({ channelUsername }) {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  const client = await mtProtoClient();
  const { Api } = await import('telegram');
  const peer = await client.getEntity(channelUsername);
  const request = new Api.stats.GetBroadcastStats({ channel: peer });
  try {
    return normalizeBroadcastStats(await client.invoke(request));
  } catch (error) {
    const migrate = String(error?.message || '').match(/STATS_MIGRATE_(\d+)/i);
    if (!migrate) throw error;
    return normalizeBroadcastStats(await client.invoke(request, Number(migrate[1])));
  }
}
