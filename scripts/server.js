// このファイルはNode.jsで動く「サーバー側」のJavaScriptです。
const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const PROJECT_ROOT = path.join(__dirname, "..");
// 従来のnode scripts/server.jsでも、プロジェクトの接続設定を読み込みます。
// 明示した環境変数（テストのDATABASE_MODE=localなど）は上書きしません。
const envFile = path.join(PROJECT_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { handleApi } = require("./api");
const { closeDatabase } = require("./game-store");
const { getPool } = require("./game-store");
const { randomUUID } = require("node:crypto");
const { serverConfig } = require("./server-config");

let config;
try { config = serverConfig(); }
catch (error) {
  console.error("サーバー設定を確認してください:", error.message);
  process.exit(1);
}
const HOST = config.host;
const PORT = config.port;

// URLと返すファイルの対応表。サーバーのコードや設定は配信しません。
const files = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/style.css", { name: "style.css", type: "text/css; charset=utf-8" }],
  ["/scripts/script.js", { name: "scripts/script.js", type: "text/javascript; charset=utf-8" }],
  ["/images/latte.png", { name: "images/latte.png", type: "image/png" }],
  ["/images/leche.png", { name: "images/leche.png", type: "image/png" }],
  ["/images/mouse.png", { name: "images/mouse.png", type: "image/png" }],
  ["/images/mouse-busaiku.png", { name: "images/mouse-busaiku.png", type: "image/png" }],
  ["/images/riku.png", { name: "images/riku.png", type: "image/png" }],
  ["/images/alley.png", { name: "images/alley.png", type: "image/png" }]
]);

const server = http.createServer(async (request, response) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let logPath = "/invalid-url";
  // ブラウザへ返し終わったら、要求と結果をターミナルで確認できます。
  response.on("finish", () => {
    console.log(JSON.stringify({ time: new Date().toISOString(), requestId, method: request.method,
      path: logPath.slice(0, 200), status: response.statusCode, durationMs: Date.now() - startedAt }));
  });

  // 学習中は再読み込みのたびに最新のファイルを取得します。
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (config.production) response.setHeader("Strict-Transport-Security", "max-age=31536000");

  function sendText(status, message) {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : message);
  }

  let pathname;
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    // 日本語の画像名も扱えるよう、URLの文字を元に戻します。
    pathname = decodeURIComponent(url.pathname);
    logPath = pathname;
  } catch {
    sendText(400, "URLの形式が正しくありません。");
    return;
  }

  if (pathname === "/healthz") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(405, "GETで確認してください。");
      return;
    }
    try { await getPool().query("SELECT 1"); sendText(200, "ok"); }
    catch { sendText(503, "unavailable"); }
    return;
  }

  // APIはファイルではなく、データベースへの保存・読み出しを行います。
  if (pathname.startsWith("/api/")) {
    await handleApi(request, response, pathname, config);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(405, "このURLではGETまたはHEADを使ってください。");
    return;
  }

  // ブラウザが自動で要求するタブのアイコンは、今回は空で返します。
  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }

  const file = files.get(pathname);
  if (!file) {
    sendText(404, "ページが見つかりません。");
    return;
  }

  try {
    // scriptsフォルダーの1つ上を基準に読み込み、起動した場所に依存しません。
    const content = await readFile(path.join(PROJECT_ROOT, file.name));
    response.writeHead(200, {
      "Content-Type": file.type,
      "Content-Length": content.length
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error(`ファイルを読み込めませんでした: ${file.name}`, error.message);
    sendText(500, "サーバーでファイルを読み込めませんでした。");
  }
});

server.requestTimeout = 15000;

function shutdown() {
  // 公開サービスからの終了要求に、長い接続があっても応答します。
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`ポート${PORT}は使用中です。起動済みのサーバーを停止するか、PORTを変更してください。`);
  } else {
    console.error("サーバーを起動できませんでした:", error.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`ゲームを開く: ${config.origin || `http://localhost:${PORT}`}`);
  console.log(`データベース: ${process.env.DATABASE_MODE === "supabase" || (!process.env.DATABASE_MODE && process.env.DATABASE_URL) ? "Supabase" : "ローカルPostgreSQL"}`);
  console.log("停止するには、このターミナルで Ctrl + C を押してください。");
});
