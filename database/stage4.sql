-- 旧記録を保持し、新しい記録を利用者に結び付けます。
BEGIN;
CREATE TABLE IF NOT EXISTS game_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE game_results ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES game_users(id);
CREATE INDEX IF NOT EXISTS game_results_user_ranking_idx
  ON game_results(user_id, score DESC, played_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS game_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES game_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS game_sessions_expiry_idx ON game_sessions(expires_at);
GRANT SELECT, INSERT ON game_users TO latte_app;
GRANT USAGE ON SEQUENCE game_users_id_seq TO latte_app;
GRANT SELECT, INSERT, DELETE ON game_sessions TO latte_app;
COMMIT;
