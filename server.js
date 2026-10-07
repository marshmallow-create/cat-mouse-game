// このファイルはNode.jsで動く「サーバー側」のJavaScriptです。
const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1"; // このPCからだけ接続できるアドレス
const PORT = Number(process.env.PORT || 3000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("PORTには1〜65535の整数を指定してください。");
  process.exit(1);
}

// URLと返すファイルの対応表。サーバーのコードや設定は配信しません。
const files = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/style.css", { name: "style.css", type: "text/css; charset=utf-8" }],
  ["/script.js", { name: "script.js", type: "text/javascript; charset=utf-8" }],
  ["/images/latte.png", { name: "images/latte.png", type: "image/png" }],
  ["/images/mouse.png", { name: "images/mouse.png", type: "image/png" }],
  ["/images/alley.png", { name: "images/alley.png", type: "image/png" }]
]);

const server = http.createServer(async (request, response) => {
  // ブラウザへ返し終わったら、要求と結果をターミナルで確認できます。
  response.on("finish", () => {
    console.log(`${request.method} ${request.url} → ${response.statusCode}`);
  });

  // 学習中は再読み込みのたびに最新のファイルを取得します。
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  function sendText(status, message) {
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(request.method === "HEAD" ? undefined : message);
  }

  // GETは内容を取得する要求。HEADは内容を送らず情報だけを返します。
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendText(405, "このURLではGETまたはHEADを使ってください。");
    return;
  }

  let pathname;
  try {
    const url = new URL(request.url, `http://${HOST}:${PORT}`);
    // 日本語の画像名も扱えるよう、URLの文字を元に戻します。
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(400, "URLの形式が正しくありません。");
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
    // __dirnameはserver.jsのある場所。起動したフォルダーに依存しません。
    const content = await readFile(path.join(__dirname, file.name));
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

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`ポート${PORT}は使用中です。起動済みのサーバーを停止するか、PORTを変更してください。`);
  } else {
    console.error("サーバーを起動できませんでした:", error.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`ゲームを開く: http://localhost:${PORT}`);
  console.log("停止するには、このターミナルで Ctrl + C を押してください。");
});
