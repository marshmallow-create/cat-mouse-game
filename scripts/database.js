// 学習用PostgreSQLの準備・起動・SQL実行をまとめるNode.jsのスクリプト。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const projectDir = path.resolve(__dirname, "..");
const localDir = path.join(projectDir, ".local", "postgres");
const binDir = path.join(localDir, "runtime", "pgsql", "bin");
const dataDir = path.join(localDir, "data");
const passwordFile = path.join(localDir, "pgpass.conf");
const HOST = "127.0.0.1";
const PORT = "5433";
const USER = "latte_admin";
const DATABASE = "latte_game";
// PostgreSQL公式Windowsページが紹介するEDBのWindows用ZIP。
const DOWNLOAD_URL = "https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip";

function runTool(name, args, capture = false) {
  // 起動時の出力をファイルに向け、バックグラウンドのPostgreSQLが
  // 呼び出し元のターミナルや出力パイプを保持しないようにします。
  const launching = name === "pg_ctl" && args.includes("start");
  const logHandle = launching ? fs.openSync(path.join(localDir, "launcher.log"), "a") : null;
  let result;
  try {
    result = spawnSync(path.join(binDir, `${name}.exe`), args, {
      env: {
        ...process.env,
        PGPASSFILE: passwordFile,
        PGCLIENTENCODING: "UTF8",
        PGTZ: "Asia/Tokyo",
        PGCONNECT_TIMEOUT: "5"
      },
      stdio: launching ? ["ignore", logHandle, logHandle] : capture ? "pipe" : "inherit",
      encoding: "utf8",
      windowsHide: true
    });
  } finally {
    if (logHandle !== null) fs.closeSync(logHandle);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(capture ? result.stderr.trim() : `${name} failed (${result.status}).`);
  }
  return capture ? result.stdout.trim() : undefined;
}

function psqlArgs(database = DATABASE) {
  // -X：個人のpsql設定を使わない。-w：パスワード入力を待たず設定ファイルを使う。
  // ON_ERROR_STOP：SQLでエラーが出たら、その時点で停止する。
  return ["-X", "-w", "-h", HOST, "-p", PORT, "-U", USER, "-d", database,
    "-v", "ON_ERROR_STOP=1", "-P", "pager=off"];
}

async function install() {
  if (fs.existsSync(path.join(binDir, "postgres.exe"))) return;
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("This setup supports Windows x64.");
  }
  fs.mkdirSync(localDir, { recursive: true });
  const zipFile = path.join(localDir, "postgresql.zip");
  console.log("Downloading PostgreSQL 18.6 from EDB (about 385 MB)...");
  const response = await fetch(DOWNLOAD_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(zipFile));
  console.log("Extracting PostgreSQL binaries...");
  const runtimeDir = path.join(localDir, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const result = spawnSync("tar.exe", ["-xf", zipFile, "-C", runtimeDir,
    "pgsql/bin", "pgsql/lib", "pgsql/share"], { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Archive extraction failed.");
  fs.unlinkSync(zipFile);
  runTool("postgres", ["--version"]);
}

function initialize() {
  if (fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    if (!fs.existsSync(passwordFile)) throw new Error("The database password file is missing.");
    return;
  }
  // パスワードはランダム生成し、Gitの対象外のファイルに保存します。
  if (!fs.existsSync(passwordFile)) {
    const password = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(passwordFile, `${HOST}:${PORT}:*:${USER}:${password}\n`, { mode: 0o600 });
  }
  const password = fs.readFileSync(passwordFile, "utf8").trim().split(":").at(-1);
  const initPasswordFile = path.join(localDir, "init-password.txt");
  fs.writeFileSync(initPasswordFile, `${password}\n`, { mode: 0o600 });
  try {
    runTool("initdb", ["-D", dataDir, "-U", USER, "--encoding=UTF8", "--locale=C",
      "--auth=scram-sha-256", `--pwfile=${initPasswordFile}`]);
  } finally {
    fs.unlinkSync(initPasswordFile);
  }
}

function isRunning() {
  const result = spawnSync(path.join(binDir, "pg_ctl.exe"), ["-D", dataDir, "status"],
    { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.status === 3) return false;
  throw new Error(result.stderr.trim() || "Cannot read database status.");
}

function start() {
  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    throw new Error("Run npm run db:setup first.");
  }
  if (!isRunning()) {
    // -l：ログをファイルへ。-w：起動が完了するまで待つ。
    // 127.0.0.1で待ち受け、このPCの外からは接続しません。
    runTool("pg_ctl", ["-D", dataDir, "-l", path.join(localDir, "postgres.log"),
      "-o", `-h ${HOST} -p ${PORT}`, "-w", "start"]);
  }
  console.log(`PostgreSQL ready: ${HOST}:${PORT} / ${DATABASE}`);
}

async function main() {
  const action = process.argv[2];
  if (action === "setup") {
    await install();
    initialize();
    start();
    const exists = runTool("psql", [...psqlArgs("postgres"), "-t", "-A", "-c",
      `SELECT 1 FROM pg_database WHERE datname = '${DATABASE}';`], true);
    if (exists !== "1") {
      runTool("createdb", ["-w", "-h", HOST, "-p", PORT, "-U", USER, DATABASE]);
    }
    runTool("psql", [...psqlArgs(), "-f", path.join(projectDir, "database", "schema.sql")]);
    console.log("Setup complete. Try: npm run db:practice");
  } else if (action === "start") {
    start();
  } else if (action === "stop") {
    if (isRunning()) runTool("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    else console.log("PostgreSQL is already stopped.");
  } else if (action === "status") {
    console.log(isRunning() ? "PostgreSQL is running." : "PostgreSQL is stopped.");
  } else if (action === "shell" || action === "practice") {
    if (!isRunning()) throw new Error("Run npm run db:start first.");
    const extra = action === "practice"
      ? ["-f", path.join(projectDir, "database", "practice.sql")]
      : process.argv.slice(3);
    runTool("psql", [...psqlArgs(), ...extra]);
  } else {
    throw new Error("Choose: setup, start, stop, status, shell, practice.");
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
