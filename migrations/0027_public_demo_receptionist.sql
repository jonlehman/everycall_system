CREATE TABLE IF NOT EXISTS demo_sessions (
  demo_session_id TEXT PRIMARY KEY,
  normalized_website_url TEXT NOT NULL,
  website_origin TEXT NOT NULL,
  website_hostname TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  business_name TEXT,
  preview_summary TEXT,
  demo_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scrape_page_count INTEGER NOT NULL DEFAULT 0,
  scrape_pages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  failure_code TEXT,
  failure_message TEXT,
  request_ip_hash TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE TABLE IF NOT EXISTS demo_session_events (
  demo_session_event_id BIGSERIAL PRIMARY KEY,
  demo_session_id TEXT NOT NULL REFERENCES demo_sessions(demo_session_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demo_sessions_status_updated_idx
  ON demo_sessions (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS demo_sessions_website_url_updated_idx
  ON demo_sessions (normalized_website_url, updated_at DESC);

CREATE INDEX IF NOT EXISTS demo_sessions_origin_updated_idx
  ON demo_sessions (website_origin, updated_at DESC);

CREATE INDEX IF NOT EXISTS demo_sessions_expires_idx
  ON demo_sessions (expires_at ASC);

CREATE INDEX IF NOT EXISTS demo_session_events_session_created_idx
  ON demo_session_events (demo_session_id, created_at ASC);
