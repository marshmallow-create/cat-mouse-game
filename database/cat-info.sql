-- 過去の記録と旧画面の未送信記録はNULL（使用した猫が不明）のまま保持。
ALTER TABLE public.game_results
  ADD COLUMN IF NOT EXISTS cat_type TEXT
  CHECK (cat_type IN ('leche', 'latte'));
