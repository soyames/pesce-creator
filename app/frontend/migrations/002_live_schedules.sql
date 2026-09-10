-- Pesce Studio — programmation des directs (live streams).
-- Le direct lui-même reste hébergé par la plateforme externe (YouTube, etc.) : seule la
-- programmation (métadonnées d'application) est stockée ici, jamais le média.

CREATE TABLE IF NOT EXISTS pesce_live_schedules (
  id TEXT PRIMARY KEY,                       -- live_<ts>_<6>
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scheduled_at TIMESTAMPTZ NOT NULL,
  link TEXT,                                 -- destination externe du direct (YouTube, …)
  status TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | live | cancelled | completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pesce_live_schedules_status_at_idx ON pesce_live_schedules (status, scheduled_at DESC);
