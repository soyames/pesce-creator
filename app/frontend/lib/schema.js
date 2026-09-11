// Source unique du schéma PostgreSQL/Neon : chaque migration est un DDL idempotent
// (CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), applicable en toute sécurité et dans
// n'importe quel ordre de reprise. Appliquée par lib/db.js au démarrage à froid (ensureMigrations)
// et par scripts/migrate.mjs localement — aucun doublon de schéma ailleurs.
// Les médias Telegram/YouTube ne sont JAMAIS stockés : métadonnées et références uniquement.

export const MIGRATIONS = [
  {
    name: '001_init.sql',
    sql: `
CREATE TABLE IF NOT EXISTS pesce_posts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'telegram',
  channel_id BIGINT,
  channel_username TEXT,
  message_id BIGINT,
  content_type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  telegram_url TEXT,
  media_file_id TEXT,
  media_mime_type TEXT,
  media_file_name TEXT,
  media_duration NUMERIC,
  media_width INTEGER,
  media_height INTEGER,
  published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_posts_published_at_idx ON pesce_posts (published_at DESC) WHERE published = true;
CREATE INDEX IF NOT EXISTS pesce_posts_type_at_idx ON pesce_posts (content_type, published_at DESC) WHERE published = true;

CREATE TABLE IF NOT EXISTS pesce_payments (
  id TEXT PRIMARY KEY,
  provider_charge_id TEXT,
  user_id BIGINT,
  username TEXT,
  amount INTEGER,
  currency TEXT,
  payload TEXT,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_payments_paid_at_idx ON pesce_payments (paid_at DESC);

CREATE TABLE IF NOT EXISTS pesce_drafts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  author_telegram_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_drafts_updated_at_idx ON pesce_drafts (updated_at DESC);

CREATE TABLE IF NOT EXISTS pesce_support_sessions (
  user_id TEXT PRIMARY KEY,
  status TEXT,
  chat_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pesce_support_tickets (
  id TEXT PRIMARY KEY,
  chat_id BIGINT,
  user_id TEXT,
  username TEXT,
  first_name TEXT,
  message TEXT,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'telegram',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  last_reply TEXT,
  last_reply_at TIMESTAMPTZ,
  last_reply_by TEXT
);
CREATE INDEX IF NOT EXISTS pesce_support_tickets_status_created_idx ON pesce_support_tickets (status, created_at DESC);
`,
  },
  {
    name: '002_live_schedules.sql',
    sql: `
CREATE TABLE IF NOT EXISTS pesce_live_schedules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_live_schedules_status_at_idx ON pesce_live_schedules (status, scheduled_at DESC);
`,
  },
  {
    name: '003_webhook_updates.sql',
    sql: `
CREATE TABLE IF NOT EXISTS pesce_webhook_updates (
  update_id BIGINT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`,
  },
  {
    name: '004_media_analytics.sql',
    sql: `
ALTER TABLE pesce_posts ADD COLUMN IF NOT EXISTS media_thumbnail_file_id TEXT;
ALTER TABLE pesce_payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS pesce_audience_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT,
  event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_audience_events_at_idx ON pesce_audience_events (created_at DESC);
`,
  },
  {
    // Sessions web (Google OAuth) du Studio créatrice : jeton aléatoire haché (SHA-256) côté
    // serveur, cookie HttpOnly chez le client. Aucun secret stocké en clair.
    name: '005_web_sessions.sql',
    sql: `
CREATE TABLE IF NOT EXISTS pesce_web_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pesce_web_sessions_expires_idx ON pesce_web_sessions (expires_at);
`,
  },
];
