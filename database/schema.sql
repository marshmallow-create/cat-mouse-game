-- 1行が1回のプレイ結果。再実行しても既存の記録は消しません。
CREATE TABLE IF NOT EXISTS game_results (
    -- 自動採番する主キー。同じ番号を持つ行は作れません。
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- スコアは必須で、0以上の整数に限定します。
    score INTEGER NOT NULL CHECK (score >= 0),
    -- 日時は必須。省略した場合はデータベースが現在時刻を設定します。
    played_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
