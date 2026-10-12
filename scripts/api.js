// HTTPの要求を確認し、データベースの結果をJSONで返す窓口。
const { saveResult, getRanking, getPersonalBest } = require("./game-store");
const { currentSession, authenticate, requireCsrf, logout } = require("./auth");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function requestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > 2048) {
        tooLarge = true;
        chunks.length = 0;
        reject(requestError(413, "送信するデータが大きすぎます。"));
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(requestError(400, "JSONの形式が正しくありません。")); }
    });
    request.on("error", reject);
    request.on("aborted", () => reject(requestError(400, "送信が中断されました。")));
  });
}

async function handleApi(request, response, pathname, config) {
  try {
    const allowedOrigins = config.allowedOrigins;
    if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
      throw requestError(403, "この画面からの要求は受け付けられません。");
    }
    if (request.method === "POST" && (!allowedOrigins.includes(request.headers.origin)
        || (!config.production && request.headers.origin !== (config.origin || `http://${request.headers.host}`)))) {
      throw requestError(403, "同じゲーム画面から操作してください。");
    }
    const methods = { "/api/auth/me": "GET", "/api/auth/register": "POST",
      "/api/auth/login": "POST", "/api/auth/logout": "POST", "/api/rankings": "GET", "/api/results": "POST" };
    if (!methods[pathname]) throw requestError(404, "APIが見つかりません。");
    if (request.method !== methods[pathname]) {
      response.setHeader("Allow", methods[pathname]);
      throw requestError(405, "このAPIのHTTPメソッドが違います。");
    }
    if (pathname === "/api/auth/register" || pathname === "/api/auth/login") {
      if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw requestError(415, "JSONで送信してください。");
      const auth = await authenticate(await readJson(request), pathname.endsWith("register"), request, response);
      sendJson(response, pathname.endsWith("register") ? 201 : 200, auth);
      return;
    }
    const session = await currentSession(request);
    if (pathname === "/api/auth/me") {
      sendJson(response, 200, session || { user: null });
      return;
    }
    if (!session) throw requestError(401, "ログインしてください。");
    if (request.method === "POST") requireCsrf(request, session);
    if (pathname === "/api/auth/logout") {
      await logout(request, response);
      sendJson(response, 200, { user: null });
      return;
    }
    if (request.headers["x-game-user"] !== String(session.user.id)) {
      throw requestError(409, "利用者が変わりました。ログイン状態を確認して、元の利用者で保存を再試行してください。");
    }
    if (pathname === "/api/rankings") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        throw requestError(405, "ランキングはGETで取得してください。");
      }
      const [results, personalBest] = await Promise.all([getRanking(), getPersonalBest(session.user.id)]);
      sendJson(response, 200, { results, personalBest });
    } else if (pathname === "/api/results") {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        throw requestError(405, "結果はPOSTで保存してください。");
      }
      if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        throw requestError(415, "結果はJSONで送信してください。");
      }
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)
          || !Object.keys(body).every(key => ["playId", "score", "catType"].includes(key))
          || (body.catType !== undefined && body.catType !== null && !["leche", "latte"].includes(body.catType))
          || typeof body.playId !== "string"
          || !UUID_PATTERN.test(body.playId)
          || !Number.isInteger(body.score) || body.score < 0 || body.score > 2147483647) {
        throw requestError(400, "プレイ番号、0以上の整数スコア、正しい猫の種類を送信してください。");
      }
      const saved = await saveResult(body.playId, body.score, session.user.id, body.catType ?? null);
      sendJson(response, saved.alreadySaved ? 200 : 201, saved);
    } else {
      throw requestError(404, "APIが見つかりません。");
    }
  } catch (error) {
    if (error.status) sendJson(response, error.status, { error: error.message });
    else {
      console.error("記録APIのDBエラー:", error.code || "database");
      sendJson(response, 503, { error: "データベースに接続できません。起動と設定を確認して再試行してください。" });
    }
  }
}

module.exports = { handleApi };
