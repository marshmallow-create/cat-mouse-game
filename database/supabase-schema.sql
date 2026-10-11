-- 新規・空のSupabaseプロジェクト用。既存テーブルを上書きしません。
-- Supabase Authは使用せず、Node.jsの利用者名＋パスワード認証を維持します。
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'latte_app') THEN
    CREATE ROLE latte_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
-- 管理者がこのロールの権限を検証・管理できるようにします。
GRANT latte_app TO postgres;

CREATE TABLE public.game_users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.game_results (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  score INTEGER NOT NULL CHECK (score >= 0),
  played_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  play_id UUID,
  user_id INTEGER REFERENCES public.game_users(id)
);
CREATE UNIQUE INDEX game_results_play_id_key ON public.game_results(play_id);
CREATE INDEX game_results_ranking_idx ON public.game_results(score DESC, played_at DESC, id DESC);
CREATE INDEX game_results_user_ranking_idx ON public.game_results(user_id, score DESC, played_at DESC, id DESC);
CREATE TABLE public.game_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.game_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX game_sessions_expiry_idx ON public.game_sessions(expires_at);
CREATE INDEX game_sessions_user_id_idx ON public.game_sessions(user_id);

-- ブラウザ向けData APIには、パスワードハッシュやセッションを公開しません。
REVOKE ALL ON public.game_users, public.game_results, public.game_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.game_users_id_seq, public.game_results_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO latte_app;
GRANT SELECT, INSERT ON public.game_users, public.game_results TO latte_app;
GRANT SELECT, INSERT, DELETE ON public.game_sessions TO latte_app;
GRANT USAGE ON SEQUENCE public.game_users_id_seq, public.game_results_id_seq TO latte_app;

ALTER TABLE public.game_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
-- このロールはサーバー専用。利用者別の認証・アクセス確認は既存のNode.js APIで実施。
CREATE POLICY server_users_select ON public.game_users FOR SELECT TO latte_app USING (true);
CREATE POLICY server_users_insert ON public.game_users FOR INSERT TO latte_app WITH CHECK (true);
CREATE POLICY server_results_select ON public.game_results FOR SELECT TO latte_app USING (true);
CREATE POLICY server_results_insert ON public.game_results FOR INSERT TO latte_app WITH CHECK (true);
CREATE POLICY server_sessions_select ON public.game_sessions FOR SELECT TO latte_app USING (true);
CREATE POLICY server_sessions_insert ON public.game_sessions FOR INSERT TO latte_app WITH CHECK (true);
CREATE POLICY server_sessions_delete ON public.game_sessions FOR DELETE TO latte_app USING (true);
COMMIT;
