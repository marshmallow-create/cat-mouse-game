// .envの接続先を確認。設定値やパスワードは表示しません。
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { databaseConfig } = require("./database-config");

async function main() {
  if (process.env.DATABASE_MODE !== "supabase") throw new Error("Cloud mode required");
  const pool = new Pool({ ...databaseConfig(), max: 1, connectionTimeoutMillis: 10000 });
  let client;
  try {
    client = await pool.connect();
    const identity = (await client.query("SELECT current_user AS role, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0];
    assert.equal(identity.role, "latte_app");
    assert.equal(identity.ssl, true);
    const counts = (await client.query("SELECT (SELECT count(*) FROM game_users) AS users, (SELECT count(*) FROM game_results) AS results")).rows[0];
    await client.query("BEGIN");
    const user = (await client.query("INSERT INTO game_users(username,password_hash) VALUES($1,$2) RETURNING id", ["check_" + crypto.randomBytes(8).toString("hex"), "temporary-verification-only"])).rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    await client.query("INSERT INTO game_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [token, user.id]);
    const playId = crypto.randomUUID();
    const saved = (await client.query("INSERT INTO game_results(play_id,score,user_id) VALUES($1,3,$2) RETURNING score", [playId, user.id])).rows[0];
    assert.equal(saved.score, 3);
    assert.equal((await client.query("SELECT count(*) FROM game_results WHERE user_id=$1", [user.id])).rows[0].count, "1");
    await client.query("DELETE FROM game_sessions WHERE token_hash=$1", [token]);
    await client.query("ROLLBACK");
    console.log(`Supabase接続・SSL・専用ロールの読み書きを確認: ${counts.users}利用者、${counts.results}記録。検証行はロールバック済み。`);
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    await pool.end();
  }
}
main().catch(error => { console.error("クラウドDBの確認に失敗:", error.code || error.name); process.exitCode = 1; });
