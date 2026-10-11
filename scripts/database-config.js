const fs = require("node:fs");
const path = require("node:path");

function databaseConfig(env = process.env) {
  const mode = env.DATABASE_MODE || (env.DATABASE_URL ? "supabase" : "local");
  if (!["local", "supabase"].includes(mode)) throw new Error("DATABASE_MODEはlocalまたはsupabaseにしてください。");
  if (mode === "local") {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".local", "postgres", "app-connection.json"), "utf8"));
  }
  if (!env.DATABASE_URL) throw new Error("SupabaseのDATABASE_URLをサーバー側に設定してください。");
  const url = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URLはPostgreSQLの接続URLにしてください。");
  // 接続URLのsslmodeで証明書検証の設定が上書きされるのを避ける。
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  const ssl = { rejectUnauthorized: true };
  if (env.DATABASE_SSL_CA) ssl.ca = env.DATABASE_SSL_CA.replace(/\\n/g, "\n");
  else if (env.DATABASE_SSL_CA_FILE) ssl.ca = fs.readFileSync(path.resolve(__dirname, "..", env.DATABASE_SSL_CA_FILE), "utf8");
  return { connectionString: url.toString(), ssl };
}

module.exports = { databaseConfig };
