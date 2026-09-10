-- Pesce Studio — schéma initial PostgreSQL/Neon.
-- Modèle issu des collections Firestore (pesce_posts, pesce_payments, pesce_drafts,
-- pesce_support_sessions, pesce_support_tickets) ; les contrats applicatifs restent inchangés.
-- Les médias Telegram ne sont jamais stockés ici (file_id et métadonnées uniquement).

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pesce_posts (
  id TEXT PRIMARY KEY,                       -- <chat_id>_<message_id>
  source TEXT NOT NULL DEFAULT 'telegram',
  channel_id BIGINT,
  channel_username TEXT,
  message_id BIGINT,
  content_type TEXT NOT NULL DEFAULT 'text', -- text | photo | audio | video | document | other
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
  id TEXT PRIMARY KEY,                       -- telegram_payment_charge_id
  provider_charge_id TEXT,                   -- provider_payment_charge_id
  user_id BIGINT,
  username TEXT,
  amount INTEGER,                            -- Étoiles Telegram (XTR)
  currency TEXT,
  payload TEXT,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_payments_paid_at_idx ON pesce_payments (paid_at DESC);

CREATE TABLE IF NOT EXISTS pesce_drafts (
  id TEXT PRIMARY KEY,                       -- draft_<ts>_<6>
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  author_telegram_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_drafts_updated_at_idx ON pesce_drafts (updated_at DESC);

CREATE TABLE IF NOT EXISTS pesce_support_sessions (
  user_id TEXT PRIMARY KEY,                  -- identifiant Telegram du demandeur
  status TEXT,
  chat_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pesce_support_tickets (
  id TEXT PRIMARY KEY,                       -- PS-YYYYMMDD-XXXXX
  chat_id BIGINT,
  user_id TEXT,
  username TEXT,
  first_name TEXT,
  message TEXT,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'open',       -- open | resolved
  source TEXT NOT NULL DEFAULT 'telegram',   -- telegram | mini_app
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  last_reply TEXT,
  last_reply_at TIMESTAMPTZ,
  last_reply_by TEXT
);
CREATE INDEX IF NOT EXISTS pesce_support_tickets_status_created_idx ON pesce_support_tickets (status, created_at DESC);
