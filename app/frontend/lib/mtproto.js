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

// Statistiques de diffusion du canal (Phase 3) — honnêtement indisponible sans configuration.
export async function getChannelBroadcastStats({ channelUsername }) {
  if (!mtProtoConfigured()) throw new Error(NOT_CONFIGURED);
  const client = await mtProtoClient();
  const { Api } = await import('telegram');
  const peer = await client.getEntity(channelUsername);
  const stats = await client.invoke(new Api.stats.GetBroadcastStats({ channel: peer }));
  return stats;
}
