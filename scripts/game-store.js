// サーバーだけが使う、PostgreSQLとの接続とSQL。
const { Pool } = require("pg");
const { databaseConfig } = require("./database-config");

let pool;

function getPool() {
  if (!pool) {
    const connection = databaseConfig();
    // 少数の接続を再利用し、要求のたびに接続を増やさないようにします。
    pool = new Pool({ ...connection, max: 5, connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000, statement_timeout: 5000 });
    pool.on("error", error => console.error("DB接続エラー:", error.code || "connection"));
  }
  return pool;
}

async function saveResult(playId, score, userId) {
  const database = getPool();
  // $1、$2に値を別渡しすることで、入力をSQLの命令として扱いません。
  const inserted = await database.query(`
    INSERT INTO game_results (play_id, score, user_id) VALUES ($1, $2, $3)
    ON CONFLICT (play_id) DO NOTHING
    RETURNING id, score, played_at
  `, [playId, score, userId]);
  if (inserted.rows.length) return { result: inserted.rows[0], alreadySaved: false };

  // 同じ番号を再送した場合は元の記録を返します。日時も変更しません。
  const existing = await database.query(
    "SELECT id, score, played_at FROM game_results WHERE play_id = $1 AND user_id = $2", [playId, userId]);
  if (!existing.rows.length) {
    const error = new Error("このプレイ番号は使用できません。");
    error.status = 409;
    throw error;
  }
  if (existing.rows[0].score !== score) {
    const error = new Error("同じプレイ番号で異なるスコアは保存できません。");
    error.status = 409;
    throw error;
  }
  return { result: existing.rows[0], alreadySaved: true };
}

async function getRanking() {
  const result = await getPool().query(`
    SELECT r.id, r.score, r.played_at, u.username
    FROM game_results r JOIN game_users u ON u.id = r.user_id
    ORDER BY r.score DESC, r.played_at DESC, r.id DESC LIMIT 10
  `);
  return result.rows;
}

async function getPersonalBest(userId) {
  const result = await getPool().query(`
    SELECT id, score, played_at FROM game_results WHERE user_id = $1
    ORDER BY score DESC, played_at DESC, id DESC LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
}

async function closeDatabase() {
  if (pool) await pool.end();
}

module.exports = { saveResult, getRanking, getPersonalBest, closeDatabase, getPool };
