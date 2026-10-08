-- BEGIN〜ROLLBACKの間で練習します。既存の記録には触れません。
BEGIN;

-- INSERT：記録を追加する。idはデータベースが自動で設定します。
INSERT INTO game_results (score, played_at)
VALUES
    (12, '2026-10-08 10:00:00+09'),
    (18, '2026-10-08 10:10:00+09'),
    (18, '2026-10-08 10:20:00+09'),
    (7,  '2026-10-08 10:30:00+09')
RETURNING id, score, played_at;

-- SELECT：保存済みの記録と今回追加した練習用の記録を読み出します。
-- ORDER BY：高いスコア、新しい日時、大きい記録番号の順。
-- LIMIT：表示する件数の上限。
SELECT id, score, played_at
FROM game_results
ORDER BY score DESC, played_at DESC, id DESC
LIMIT 10;

-- ROLLBACK：今回の追加を取り消す。何度実行しても記録は増えません。
-- 自動採番した番号は戻らないため、番号に抜けができることがあります。
ROLLBACK;
