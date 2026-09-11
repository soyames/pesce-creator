// Accès PostgreSQL/Neon — source unique des fonctions de données de l'application.
// Le schéma est appliqué automatiquement au démarrage à froid (ensureMigrations, DDL idempotent de lib/schema.js) :
// aucun opérateur n'est requis pour migrer la base en production. Les colonnes SQL sont en snake_case ;
// les objets retournés gardent les mêmes formes camelCase qu'historiquement (Dates JavaScript pour les timestamps).
import { Pool } from '@neondatabase/serverless';
import { MIGRATIONS } from './schema.js';

let pool;

// Résolution de la connexion : DATABASE_URL (fournie par l'intégration Vercel Neon, préférée),
// puis POSTGRES_URL, puis les variables PG* individuelles. Aucun identifiant n'est journalisé.
export function connectionString(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE } = env;
  if (PGHOST && PGUSER && PGPASSWORD && PGDATABASE) {
    return `postgresql://${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}@${PGHOST}/${encodeURIComponent(PGDATABASE)}?sslmode=require`;
  }
  return '';
}

export function db() {
  if (pool) return pool;
  const url = connectionString();
  if (!url) throw new Error('Base de données non configurée : DATABASE_URL (ou PG*) est requis.');
  pool = new Pool({ connectionString: url });
  pool.on('error', (error) => console.error('erreur du pool de connexions', error.message));
  return pool;
}

// — Migrations : appliquées une fois par processus au premier accès. DDL idempotent (lib/schema.js),
// donc un démarrage concurrent ou un rejeu est sans effet. Renvoie les migrations nouvellement appliquées.
let migrationsEnsured = false;

export async function ensureMigrations() {
  const client = db();
  if (migrationsEnsured) return [];
  migrationsEnsured = true; // posé avant l'await : pas de double exécution dans ce processus
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  const newlyApplied = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [migration.name]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${migration.name} échouée : ${error.message}`);
    }
    newlyApplied.push(migration.name);
    console.log(`migration appliquée : ${migration.name}`);
  }
  return newlyApplied;
}

async function ensureDb() {
  await ensureMigrations();
  return db();
}

function num(value) {
  return value === null || value === undefined ? null : Number(value);
}

// — Publications du canal
const mapPost = (row) => row && ({
  id: row.id,
  source: row.source,
  channelId: num(row.channel_id),
  channelUsername: row.channel_username,
  messageId: num(row.message_id),
  contentType: row.content_type,
  text: row.text ?? '',
  telegramUrl: row.telegram_url,
  mediaFileId: row.media_file_id,
  mediaMimeType: row.media_mime_type,
  mediaFileName: row.media_file_name,
  mediaDuration: num(row.media_duration),
  mediaWidth: num(row.media_width),
  mediaHeight: num(row.media_height),
  mediaThumbnailFileId: row.media_thumbnail_file_id,
  articleUrl: row.article_url,
  articleImageUrl: row.article_image_url,
  published: row.published === true,
  publishedAt: row.published_at,
  receivedAt: row.received_at,
  updatedAt: row.updated_at,
});

export async function upsertChannelPost(post) {
  await (await ensureDb()).query(
    `INSERT INTO pesce_posts (
       id, source, channel_id, channel_username, message_id, content_type, text, telegram_url,
       media_file_id, media_mime_type, media_file_name, media_duration, media_width, media_height,
       media_thumbnail_file_id, article_url, article_image_url, published, published_at, received_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
     ON CONFLICT (id) DO UPDATE SET
       source = EXCLUDED.source, channel_id = EXCLUDED.channel_id, channel_username = EXCLUDED.channel_username,
       message_id = EXCLUDED.message_id, content_type = EXCLUDED.content_type, text = EXCLUDED.text,
       telegram_url = EXCLUDED.telegram_url, media_file_id = EXCLUDED.media_file_id,
       media_mime_type = EXCLUDED.media_mime_type, media_file_name = EXCLUDED.media_file_name,
       media_duration = EXCLUDED.media_duration, media_width = EXCLUDED.media_width,
       media_height = EXCLUDED.media_height, media_thumbnail_file_id = EXCLUDED.media_thumbnail_file_id,
       published = EXCLUDED.published, published_at = EXCLUDED.published_at,
       received_at = EXCLUDED.received_at, updated_at = now(),
       -- Les métadonnées d'article (URL Telegraph, image de couverture) écrites au moment de la
       -- publication par le Studio ne doivent JAMAIS être écrasées par un sync webhook sans image.
       article_url = COALESCE(NULLIF(EXCLUDED.article_url, ''), pesce_posts.article_url),
       article_image_url = COALESCE(NULLIF(EXCLUDED.article_image_url, ''), pesce_posts.article_image_url)`,
    [
      post.id, post.source, post.channelId ?? null, post.channelUsername ?? null, post.messageId ?? null,
      post.contentType ?? 'text', post.text || '', post.telegramUrl ?? null, post.mediaFileId ?? null,
      post.mediaMimeType ?? null, post.mediaFileName ?? null, post.mediaDuration ?? null,
      post.mediaWidth ?? null, post.mediaHeight ?? null, post.mediaThumbnailFileId ?? null,
      post.articleUrl ?? null, post.articleImageUrl ?? null,
      post.published === true, post.publishedAt ?? new Date(), post.receivedAt ?? new Date(),
    ]
  );
  return post.id;
}

export async function listChannelPosts({ type, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const result = await (await ensureDb()).query(
    `SELECT * FROM pesce_posts
     WHERE published = true AND ($1::text IS NULL OR content_type = $1)
     ORDER BY published_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [type || null, safeLimit]
  );
  return result.rows.map(mapPost);
}

// — Paiements (Étoiles Telegram)
const mapPayment = (row) => row && ({
  id: row.id,
  telegramPaymentChargeId: row.id,
  telegramProviderChargeId: row.provider_charge_id,
  userId: num(row.user_id),
  username: row.username,
  amount: num(row.amount),
  currency: row.currency,
  payload: row.payload,
  paidAt: row.paid_at,
  refundedAt: row.refunded_at,
  updatedAt: row.updated_at,
});

export async function upsertPayment(payment) {
  const chargeId = String(payment.telegramPaymentChargeId || payment.id || '').trim();
  if (!chargeId) throw new Error('Paiement sans identifiant Telegram.');
  await (await ensureDb()).query(
    `INSERT INTO pesce_payments (id, provider_charge_id, user_id, username, amount, currency, payload, paid_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET
       provider_charge_id = EXCLUDED.provider_charge_id, user_id = EXCLUDED.user_id,
       username = EXCLUDED.username, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
       payload = EXCLUDED.payload, paid_at = EXCLUDED.paid_at, updated_at = now()`,
    [chargeId, payment.telegramProviderChargeId ?? null, payment.userId ?? null, payment.username ?? null,
     payment.amount ?? null, payment.currency ?? null, payment.payload ?? null, payment.paidAt ?? new Date()]
  );
  return chargeId;
}

export async function getPayment(chargeId) {
  const result = await (await ensureDb()).query('SELECT * FROM pesce_payments WHERE id = $1', [String(chargeId || '')]);
  return mapPayment(result.rows[0]) || null;
}

export async function markPaymentRefunded(chargeId, refundedAt = new Date()) {
  await (await ensureDb()).query(
    'UPDATE pesce_payments SET refunded_at = $2, updated_at = now() WHERE id = $1',
    [String(chargeId), refundedAt]
  );
  return String(chargeId);
}

export async function listPayments({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const result = await (await ensureDb()).query(
    'SELECT * FROM pesce_payments ORDER BY paid_at DESC NULLS LAST, id DESC LIMIT $1',
    [safeLimit]
  );
  return result.rows.map(mapPayment);
}

// — Brouillons du studio
const mapDraft = (row) => row && ({
  id: row.id,
  text: row.text,
  status: row.status,
  authorTelegramUserId: row.author_telegram_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function createDraft(draft) {
  await (await ensureDb()).query(
    `INSERT INTO pesce_drafts (id, text, status, author_telegram_user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), now())`,
    [draft.id, draft.text, draft.status || 'draft', draft.authorTelegramUserId ?? null, draft.createdAt ?? null]
  );
  return draft.id;
}

export async function deleteDraft(draftId) {
  await (await ensureDb()).query('DELETE FROM pesce_drafts WHERE id = $1', [String(draftId)]);
  return String(draftId);
}

export async function listDrafts({ limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const result = await (await ensureDb()).query(
    'SELECT * FROM pesce_drafts ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $1',
    [safeLimit]
  );
  return result.rows.map(mapDraft);
}

// — Sessions de support (bot Telegram)
export async function getSupportSession(userId) {
  if (!userId) return null;
  const result = await (await ensureDb()).query('SELECT * FROM pesce_support_sessions WHERE user_id = $1', [String(userId)]);
  const row = result.rows[0];
  return row ? { id: row.user_id, userId: row.user_id, status: row.status, chatId: num(row.chat_id), updatedAt: row.updated_at } : null;
}

export async function setSupportSession(userId, data) {
  await (await ensureDb()).query(
    `INSERT INTO pesce_support_sessions (user_id, status, chat_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, chat_id = EXCLUDED.chat_id, updated_at = now()`,
    [String(userId), data.status ?? null, data.chatId ?? null]
  );
  return String(userId);
}

export async function deleteSupportSession(userId) {
  await (await ensureDb()).query('DELETE FROM pesce_support_sessions WHERE user_id = $1', [String(userId)]);
}

// — Tickets de support
const mapTicket = (row) => row && ({
  id: row.id,
  chatId: num(row.chat_id),
  userId: row.user_id,
  username: row.username,
  firstName: row.first_name,
  message: row.message,
  topic: row.topic,
  status: row.status,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
  resolvedBy: row.resolved_by,
  lastReply: row.last_reply,
  lastReplyAt: row.last_reply_at,
  lastReplyBy: row.last_reply_by,
});

export async function createSupportTicket(ticket) {
  await (await ensureDb()).query(
    `INSERT INTO pesce_support_tickets (
       id, chat_id, user_id, username, first_name, message, topic, status, source, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())`,
    [ticket.id, ticket.chatId ?? null, ticket.userId ?? null, ticket.username ?? null,
     ticket.firstName ?? null, ticket.message, ticket.topic ?? null, ticket.status || 'open', ticket.source ?? 'telegram']
  );
  return ticket.id;
}

export async function listSupportTickets({ status, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await (await ensureDb()).query(
    `SELECT * FROM pesce_support_tickets
     WHERE ($1::text IS NULL OR status = $1)
     ORDER BY created_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [status || null, safeLimit]
  );
  return result.rows.map(mapTicket);
}

export async function updateSupportTicket(ticketId, data) {
  const sets = [];
  const values = [String(ticketId)];
  const add = (column, value) => {
    values.push(value);
    sets.push(`${column} = COALESCE($${values.length}, ${column})`);
  };
  if (data.status !== undefined) add('status', data.status);
  if (data.resolvedAt !== undefined) add('resolved_at', data.resolvedAt);
  if (data.resolvedBy !== undefined) add('resolved_by', data.resolvedBy);
  if (data.lastReply !== undefined) add('last_reply', data.lastReply);
  if (data.lastReplyAt !== undefined) add('last_reply_at', data.lastReplyAt);
  if (data.lastReplyBy !== undefined) add('last_reply_by', data.lastReplyBy);
  if (sets.length === 0) return String(ticketId);
  await (await ensureDb()).query(
    `UPDATE pesce_support_tickets SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    values
  );
  return String(ticketId);
}

// — Programmation des directs (le média reste sur la plateforme externe ; seules les métadonnées sont stockées)
export const LIVE_STATUSES = ['scheduled', 'live', 'cancelled', 'completed'];

const mapLive = (row) => row && ({
  id: row.id,
  title: row.title,
  description: row.description,
  scheduledAt: row.scheduled_at,
  link: row.link,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function createLiveSchedule(schedule) {
  await (await ensureDb()).query(
    `INSERT INTO pesce_live_schedules (id, title, description, scheduled_at, link, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
    [schedule.id, schedule.title, schedule.description || '', schedule.scheduledAt, schedule.link ?? null, schedule.status || 'scheduled']
  );
  return schedule.id;
}

export async function updateLiveSchedule(liveId, data) {
  const sets = [];
  const values = [String(liveId)];
  const add = (column, value) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (data.title !== undefined) add('title', data.title);
  if (data.description !== undefined) add('description', data.description);
  if (data.scheduledAt !== undefined) add('scheduled_at', data.scheduledAt);
  if (data.link !== undefined) add('link', data.link);
  if (data.status !== undefined) add('status', data.status);
  if (sets.length === 0) return String(liveId);
  await (await ensureDb()).query(
    `UPDATE pesce_live_schedules SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    values
  );
  return String(liveId);
}

export async function listLiveSchedules({ statuses, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const statusList = Array.isArray(statuses) && statuses.length > 0 ? statuses.filter((s) => LIVE_STATUSES.includes(s)) : LIVE_STATUSES;
  const result = await (await ensureDb()).query(
    `SELECT * FROM pesce_live_schedules
     WHERE status = ANY($1::text[])
     ORDER BY scheduled_at DESC NULLS LAST, id DESC
     LIMIT $2`,
    [statusList, safeLimit]
  );
  return result.rows.map(mapLive);
}

// Prochains directs publics : programmés ou en cours, à venir (tolérance d'une heure pour un direct qui démarre).
export async function getUpcomingLive({ now = new Date() } = {}) {
  const result = await (await ensureDb()).query(
    `SELECT * FROM pesce_live_schedules
     WHERE (status = 'live' AND scheduled_at <= ($1::timestamptz + interval '1 day'))
        OR (status = 'scheduled' AND scheduled_at >= ($1::timestamptz - interval '1 hour'))
     ORDER BY scheduled_at ASC, id ASC
     LIMIT 3`,
    [now]
  );
  return result.rows.map(mapLive);
}

// — Idempotence du webhook Telegram : une update est traitée une seule fois.
export async function markUpdateProcessed(updateId) {
  const result = await (await ensureDb()).query(
    'INSERT INTO pesce_webhook_updates (update_id) VALUES ($1) ON CONFLICT (update_id) DO NOTHING',
    [updateId]
  );
  return result.rowCount > 0;
}

// Conserve uniquement les keepLast identifiants les plus récents (nettoyage périodique).
export async function pruneWebhookUpdates(keepLast = 100000) {
  await (await ensureDb()).query(
    `DELETE FROM pesce_webhook_updates
     WHERE update_id < (SELECT COALESCE(MAX(update_id), 0) - $1 FROM pesce_webhook_updates)`,
    [keepLast]
  );
}

// — Audience (V1, minimaliste : ouvertures du Mini App)
export const AUDIENCE_EVENTS = ['open'];

export async function trackAudienceEvent({ userId, event }) {
  if (!AUDIENCE_EVENTS.includes(event)) return null;
  await (await ensureDb()).query(
    'INSERT INTO pesce_audience_events (user_id, event) VALUES ($1, $2)',
    [userId ?? null, event]
  );
  return event;
}

export async function getAudienceStats() {
  const result = await (await ensureDb()).query(
    `SELECT COUNT(*)::int AS opens,
            COUNT(DISTINCT user_id)::int AS unique_users,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS last_7_days
     FROM pesce_audience_events`
  );
  return {
    opens: result.rows[0].opens,
    uniqueUsers: result.rows[0].unique_users,
    last7Days: result.rows[0].last_7_days,
  };
}

// — Vue d'ensemble du studio (indicateurs + listes récentes)
export async function getStudioOverview() {
  const [totalsResult, starsResult, supportersResult, openTicketsResult, recentPosts, recentPayments, recentTickets, drafts, liveSchedules, audience] = await Promise.all([
    (await ensureDb()).query('SELECT content_type, COUNT(*)::int AS count FROM pesce_posts WHERE published = true GROUP BY content_type'),
    (await ensureDb()).query('SELECT COALESCE(SUM(amount), 0)::int AS stars, COUNT(*)::int AS payments FROM pesce_payments'),
    (await ensureDb()).query('SELECT COUNT(DISTINCT user_id)::int AS supporters FROM pesce_payments WHERE user_id IS NOT NULL'),
    (await ensureDb()).query(`SELECT COUNT(*)::int AS open_tickets FROM pesce_support_tickets WHERE status = 'open'`),
    listChannelPosts({ limit: 10 }),
    listPayments({ limit: 10 }),
    listSupportTickets({ status: 'open', limit: 10 }),
    listDrafts({ limit: 20 }),
    listLiveSchedules({ limit: 20 }),
    getAudienceStats(),
  ]);

  const totals = { total: 0, text: 0, photo: 0, audio: 0, video: 0, document: 0, other: 0 };
  for (const row of totalsResult.rows) {
    totals[row.content_type] = row.count;
    totals.total += row.count;
  }

  return {
    totals,
    stars: starsResult.rows[0].stars,
    payments: starsResult.rows[0].payments,
    supporters: supportersResult.rows[0].supporters,
    openTickets: openTicketsResult.rows[0].open_tickets,
    recentPosts: recentPosts,
    recentPayments: recentPayments,
    recentTickets: recentTickets,
    drafts,
    liveSchedules,
    audience,
  };
}
