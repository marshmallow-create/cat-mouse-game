// Node.js標準のscryptでパスワードをハッシュ化し、DBにセッションを保管します。
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { getPool } = require("./game-store");
const { serverConfig } = require("./server-config");
const scrypt = promisify(crypto.scrypt);
const COOKIE = "latte_session";
const SESSION_SECONDS = 12 * 60 * 60;
const attempts = new Map();
let hashing = 0;
const error = (status, message) => Object.assign(new Error(message), { status });
const digest = value => crypto.createHash("sha256").update(value).digest("hex");

function checkAuthRate(request, username) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  // 公開環境ではプロキシのIPを全利用者で共有するため、利用者名で制限します。
  // 転送ヘッダーは利用者が偽装できるので認証制限の根拠にしません。
  const key = serverConfig().production ? `user:${username}` : request.socket.remoteAddress;
  if (!attempts.has(key) && attempts.size >= 10000) throw error(429, "処理が混み合っています。少し待って再試行してください。");
  const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
  attempts.set(key, entry);
  if (++entry.count > 30) throw error(429, "試行回数が多すぎます。15分後に再試行してください。");
}

function credentials(body) {
  if (!body || Array.isArray(body) || Object.keys(body).length !== 2
      || typeof body.username !== "string" || !/^[a-zA-Z0-9_]{3,32}$/.test(body.username)
      || typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
    throw error(400, "利用者名は半角英数字・_で3〜32文字、パスワードは12〜128文字にしてください。");
  }
  return { username: body.username.toLowerCase(), password: body.password };
}

async function derive(password, salt) {
  if (hashing >= (serverConfig().production ? 1 : 2)) throw error(429, "処理が混み合っています。少し待って再試行してください。");
  hashing++;
  try { return await scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }); }
  finally { hashing--; }
}

function sessionToken(request) {
  const token = (request.headers.cookie || "").split(";").map(item => item.trim())
    .find(item => item.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function setCookie(response, token, seconds = SESSION_SECONDS) {
  const secure = serverConfig().production ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`);
}

async function currentSession(request) {
  const token = sessionToken(request);
  if (!token) return null;
  const result = await getPool().query(`
    SELECT u.id, u.username FROM game_sessions s JOIN game_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
  `, [digest(token)]);
  return result.rows.length ? { user: result.rows[0], csrfToken: digest("csrf:" + token) } : null;
}

async function authenticate(body, registering, request, response) {
  checkAuthRate(request, typeof body?.username === "string" ? body.username.toLowerCase().slice(0, 32) : "invalid");
  const { username, password } = credentials(body);
  const database = getPool();
  let user;
  if (registering) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = `scrypt$${salt}$${(await derive(password, salt)).toString("hex")}`;
    try {
      user = (await database.query("INSERT INTO game_users(username, password_hash) VALUES($1, $2) RETURNING id, username", [username, hash])).rows[0];
    } catch (cause) {
      if (cause.code === "23505") throw error(409, "この利用者名は使用できません。別の名前を選んでください。");
      throw cause;
    }
  } else {
    const found = (await database.query("SELECT id, username, password_hash FROM game_users WHERE username = $1", [username])).rows[0];
    const [, salt, hash] = (found?.password_hash || `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`).split("$");
    const actual = await derive(password, salt);
    if (!found || !crypto.timingSafeEqual(actual, Buffer.from(hash, "hex"))) {
      throw error(401, "利用者名またはパスワードが違います。");
    }
    user = { id: found.id, username: found.username };
  }
  const token = crypto.randomBytes(32).toString("hex");
  // 期限切れと、同じブラウザの古いセッションを破棄します。
  await database.query("DELETE FROM game_sessions WHERE expires_at <= now() OR token_hash = $1", [digest(sessionToken(request) || "")]);
  await database.query("INSERT INTO game_sessions(token_hash, user_id, expires_at) VALUES($1, $2, now() + interval '12 hours')", [digest(token), user.id]);
  setCookie(response, token);
  return { user, csrfToken: digest("csrf:" + token) };
}

function requireCsrf(request, session) {
  if (request.headers["x-csrf-token"] !== session.csrfToken) throw error(403, "ログイン状態を再確認してください。画面を再読み込みしてください。");
}

async function logout(request, response) {
  await getPool().query("DELETE FROM game_sessions WHERE token_hash = $1", [digest(sessionToken(request) || "")]);
  setCookie(response, "", 0);
}

module.exports = { currentSession, authenticate, requireCsrf, logout };
