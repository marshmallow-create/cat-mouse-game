// クラウドや通常のゲームDBへは書き込みません。新しいローカル検証DBだけに復元します。
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { databaseConfig } = require("./database-config");
const { restoreIntoEmptyDatabase, validateBackup } = require("./game-backup");
const root = path.resolve(__dirname, "..");

async function main() {
  const [filename, database] = process.argv.slice(2);
  if (!filename || !/^latte_restore_[a-z0-9_]{1,40}$/.test(database || "")) throw new Error("使い方: node scripts/restore-game-data.js BACKUP_FILE latte_restore_CHECK_NAME");
  const location = path.resolve(root, filename);
  if ((await fs.stat(location)).size > 20 * 1024 * 1024) throw new Error("バックアップが20MBを超えています。");
  const data = JSON.parse(await fs.readFile(location, "utf8"));
  validateBackup(data);
  const app = databaseConfig({ DATABASE_MODE: "local" });
  const password = (await fs.readFile(path.join(root, ".local/postgres/pgpass.conf"), "utf8")).trim().split(":").at(-1);
  const settings = { ...app, user: "latte_admin", password, max: 1, connectionTimeoutMillis: 5000 };
  const admin = new Pool({ ...settings, database: "postgres" });
  let restored;
  try {
    // 名前は上の正規表現で限定し、既存DBにはCREATE DATABASEが失敗します。
    await admin.query(`CREATE DATABASE "${database}"`);
    restored = new Pool({ ...settings, database });
    for (const file of ["schema.sql", "stage3.sql", "stage4.sql", "cat-info.sql"]) {
      await restored.query(await fs.readFile(path.join(root, "database", file), "utf8"));
    }
    const client = await restored.connect();
    try { await restoreIntoEmptyDatabase(client, data); } finally { client.release(); }
    const counts = (await restored.query("SELECT (SELECT count(*) FROM game_users) AS users, (SELECT count(*) FROM game_results) AS results")).rows[0];
    if (Number(counts.users) !== data.users.length || Number(counts.results) !== data.results.length) throw new Error("復元件数が一致しません。");
    console.log(`復元確認: ${database}（${counts.users}利用者・${counts.results}記録）。通常のゲームDBとクラウドDBは変更していません。`);
  } finally { if (restored) await restored.end(); await admin.end(); }
}
main().catch(error => { console.error("検証用DBへの復元失敗:", error.code || error.message); process.exitCode = 1; });
