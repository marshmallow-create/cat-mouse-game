// 移行用の控えをGit管理外の.localへ保存。パスワードハッシュを画面へ出力しません。
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { databaseConfig } = require("./database-config");

async function main() {
  const pool = new Pool({ ...databaseConfig({ DATABASE_MODE: "local" }), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const users = (await client.query("SELECT id, username, password_hash, created_at FROM game_users ORDER BY id")).rows;
    const results = (await client.query("SELECT id, score, played_at, play_id, user_id FROM game_results ORDER BY id")).rows;
    const sequences = (await client.query("SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename IN ('game_users_id_seq', 'game_results_id_seq')")).rows;
    const filename = process.argv[2] || "game-data.json";
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(filename)) throw new Error("Invalid backup filename");
    const destination = path.join(__dirname, "..", ".local", "supabase", filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, JSON.stringify({ exportedAt: new Date().toISOString(), users, results, sequences }, null, 2), { mode: 0o600, flag: "wx" });
    await client.query("COMMIT");
    console.log(`移行用の控えを保存しました: ${users.length}利用者、${results.length}記録。ログイン状態は移さず再ログインします。`);
    console.log(`保存先: .local/supabase/${filename}（Git管理外）`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error("移行用控えの保存に失敗:", error.code || "export_error"); process.exitCode = 1; });
