const fs = require("node:fs/promises");
const path = require("node:path");

async function snapshot(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const users = (await client.query("SELECT id, username, password_hash, created_at FROM game_users ORDER BY id")).rows;
    const results = (await client.query("SELECT id, score, played_at, play_id, user_id FROM game_results ORDER BY id")).rows;
    const sequences = (await client.query("SELECT sequencename, last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename IN ('game_users_id_seq', 'game_results_id_seq') ORDER BY sequencename")).rows;
    await client.query("COMMIT");
    return { format: "cat-mouse-game-backup-v1", exportedAt: new Date().toISOString(), users, results, sequences };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function writeBackup(data, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // 既存の控えを上書きしません。セッションは持ち出さず復元時に再ログインします。
  await fs.writeFile(destination, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
}

function validateBackup(data) {
  if (data?.format !== "cat-mouse-game-backup-v1" || !Array.isArray(data.users)
      || !Array.isArray(data.results) || !Array.isArray(data.sequences)) throw new Error("ゲーム用バックアップの形式が違います。");
}

async function restoreIntoEmptyDatabase(client, data) {
  validateBackup(data);
  const counts = (await client.query("SELECT (SELECT count(*) FROM game_users) + (SELECT count(*) FROM game_results) + (SELECT count(*) FROM game_sessions) AS count")).rows[0];
  if (counts.count !== "0") throw new Error("復元先は空の検証用データベースにしてください。");
  await client.query("BEGIN");
  try {
    for (const user of data.users) {
      await client.query("INSERT INTO game_users(id,username,password_hash,created_at) VALUES($1,$2,$3,$4)", [user.id, user.username, user.password_hash, user.created_at]);
    }
    for (const result of data.results) {
      await client.query("INSERT INTO game_results(id,score,played_at,play_id,user_id) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5)", [result.id, result.score, result.played_at, result.play_id, result.user_id]);
    }
    for (const [name, records] of [["game_users_id_seq", data.users], ["game_results_id_seq", data.results]]) {
      const sequence = data.sequences.find(item => item.sequencename === name);
      const lastValue = records.reduce((value, record) => BigInt(record.id) > value ? BigInt(record.id) : value, BigInt(sequence?.last_value || 0));
      await client.query("SELECT setval($1::regclass, $2::bigint, $3)", [name, String(lastValue || 1n), lastValue > 0n]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

module.exports = { snapshot, writeBackup, restoreIntoEmptyDatabase, validateBackup };
