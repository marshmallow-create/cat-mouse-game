-- 段階2の記録を残したまま、二重保存を防ぐプレイ番号を追加します。
BEGIN;
ALTER TABLE game_results ADD COLUMN IF NOT EXISTS play_id UUID;
-- 古い記録のNULLは許し、APIから送られた同じプレイ番号は1件だけにします。
CREATE UNIQUE INDEX IF NOT EXISTS game_results_play_id_key ON game_results (play_id);
-- ランキングで使う並び順に合わせた索引。
CREATE INDEX IF NOT EXISTS game_results_ranking_idx
    ON game_results (score DESC, played_at DESC, id DESC);
COMMIT;
