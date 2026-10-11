// .envの接続先から、ゲームの利用者と記録だけを読み出します。
const path = require("node:path");
const fs = require("node:fs");
const { Pool } = require("pg");
const root = path.resolve(__dirname, "..");
if (fs.existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const { databaseConfig } = require("./database-config");
const { snapshot, writeBackup } = require("./game-backup");

async function main() {
  const filename = process.argv[2] || `game-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(filename)) throw new Error("ファイル名は半角英数字・_-と.jsonにしてください。");
  const pool = new Pool({ ...databaseConfig(), max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  try {
    const data = await snapshot(pool);
    await writeBackup(data, path.join(root, ".local", "backups", filename));
    console.log(`バックアップ保存: .local/backups/${filename}（${data.users.length}利用者・${data.results.length}記録）`);
  } finally { await pool.end(); }
}
main().catch(error => { console.error("バックアップ失敗:", error.code || "backup_error"); process.exitCode = 1; });
