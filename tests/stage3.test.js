// 実際のローカルPostgreSQLとHTTPサーバーを使う結合テスト。
// テスト自身のプレイ番号を持つ記録だけを追加・削除します。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");

const root = path.resolve(__dirname, "..");
const dbScript = path.join(root, "scripts", "database.js");
const appConfig = JSON.parse(fs.readFileSync(path.join(root, ".local", "postgres", "app-connection.json"), "utf8"));
const adminPassword = fs.readFileSync(path.join(root, ".local", "postgres", "pgpass.conf"), "utf8").trim().split(":").at(-1);

function dbAction(action) {
  const result = spawnSync(process.execPath, [dbScript, action], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function adminPool() {
  return new Pool({ ...appConfig, user: "latte_admin", password: adminPassword, max: 1 });
}

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function startServer(port) {
  const child = spawn(process.execPath, [path.join(root, "scripts", "server.js")], {
    cwd: root, env: { ...process.env, DATABASE_MODE: "local", PORT: String(port) }, windowsHide: true, stdio: "pipe"
  });
  child.stderr.on("data", () => {});
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => { throw new Error("Test server exited before startup."); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Server startup timed out.")), 5000); timer.unref(); })
  ]);
  child.stdout.resume();
  return child;
}

async function stopServer(child) {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}

test("stages 3 and 4: authentication, ownership, API, failure and persistence", { timeout: 90000 }, async () => {
  const wasRunning = dbAction("status").includes("is running");
  dbAction("start");
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const playIds = [];
  const userIds = [];
  let session = {};
  let cookie = "";
  let child;
  let admin = adminPool();
  let app = new Pool({ ...appConfig, max: 1 });
  const makeId = () => { const id = crypto.randomUUID(); playIds.push(id); return id; };
  const request = (url, options = {}) => fetch(base + url, { ...options,
    headers: { Origin: base, Cookie: cookie, "X-CSRF-Token": session.csrfToken || "",
      "X-Game-User": String(session.user?.id || ""), ...options.headers }, signal: AbortSignal.timeout(8000) });
  const account = async (username, registering = true, password = "test-password-12345") => {
    const response = await request(registering ? "/api/auth/register" : "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password })
    });
    assert.equal(response.status, registering ? 201 : 200);
    session = await response.json();
    cookie = response.headers.get("set-cookie").split(";")[0];
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    if (registering) userIds.push(session.user.id);
    return { session, cookie };
  };
  const post = (body, options = {}) => request("/api/results", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...options
  });
  try {
    child = await startServer(port);
    assert.equal((await request("/api/rankings")).status, 401);
    assert.equal((await post({ playId: makeId(), score: 5 })).status, 401);
    assert.equal((await (await request("/api/auth/me")).json()).user, null);
    for (const credentials of [{ username: "x", password: "long-password-1234" },
      { username: "valid_name", password: "short" }, { username: "a b", password: "long-password-1234" }]) {
      assert.equal((await request("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) })).status, 400);
    }
    const username = "test_" + crypto.randomBytes(8).toString("hex");
    let alice = await account(username);
    const aliceId = session.user.id;
    const initialCount = Number((await admin.query("SELECT count(*) FROM game_results")).rows[0].count);
    let response = await request("/api/rankings");
    assert.equal(response.status, 200);
    assert.ok((await response.json()).results.length <= 10);

    // 同時再送でも1行だけになり、後からの再送でも日時が変わらない。
    const playId = makeId();
    const simultaneous = await Promise.all(Array.from({ length: 8 }, () => post({ playId, score: 12 })));
    assert.equal(simultaneous.filter(result => result.status === 201).length, 1);
    assert.equal(simultaneous.filter(result => result.status === 200).length, 7);
    const saved = await Promise.all(simultaneous.map(result => result.json()));
    assert.equal(new Set(saved.map(record => record.result.id)).size, 1);
    assert.equal(new Set(saved.map(record => record.result.played_at)).size, 1);
    const original = saved[0].result;
    const bob = await account(username + "_b");
    assert.equal((await request("/api/rankings", { headers: { "X-Game-User": String(aliceId) } })).status, 409);
    assert.deepEqual((await (await request("/api/rankings")).json()).results, []);
    assert.equal((await post({ playId, score: 12 })).status, 409);
    assert.equal((await post({ playId: makeId(), score: 15 }, { headers: { "Content-Type": "application/json", "X-Game-User": String(aliceId) } })).status, 409);
    assert.equal((await post({ playId: makeId(), score: 15, user_id: aliceId })).status, 400);
    assert.equal((await post({ playId: makeId(), score: 15 }, { headers: { "Content-Type": "application/json", "X-CSRF-Token": alice.session.csrfToken } })).status, 403);
    const bobResult = await post({ playId: makeId(), score: 17 });
    assert.equal(bobResult.status, 201);
    assert.equal((await (await request("/api/rankings")).json()).results.length, 1);
    assert.equal((await request("/api/results", { method: "DELETE" })).status, 405);
    const logoutResponse = await request("/api/auth/logout", { method: "POST" });
    assert.equal(logoutResponse.status, 200);
    assert.equal((await request("/api/rankings")).status, 401);
    session = alice.session; cookie = alice.cookie;
    assert.equal((await request("/api/rankings")).status, 401);
    alice = await account(username, false);
    assert.equal((await request("/api/rankings")).status, 200);
    const invalidLogin = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "wrong-password-1234" }) });
    assert.equal(invalidLogin.status, 401);
    const rotated = await account(username.toUpperCase(), false);
    assert.equal(rotated.session.user.id, aliceId);
    assert.notEqual(rotated.cookie, alice.cookie);
    assert.equal((await request("/api/rankings", { headers: { Cookie: alice.cookie } })).status, 401);
    const passwordHash = (await admin.query("SELECT password_hash FROM game_users WHERE id = $1", [aliceId])).rows[0].password_hash;
    assert.match(passwordHash, /^scrypt\$/);
    assert.ok(!passwordHash.includes("test-password"));
    const duplicateUser = await request("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test-password-12345" }) });
    assert.equal(duplicateUser.status, 409);
    assert.equal((await post({ playId, score: 99 })).status, 409);
    const zero = await post({ playId: makeId(), score: 0 });
    assert.equal(zero.status, 201);

    // データ形式・方法・送信元をサーバーで確認する。
    for (const body of [null, [], {}, { playId, score: -1 }, { playId, score: 1.5 },
      { playId, score: "12" }, { playId, score: 2147483648 }, { playId: "invalid", score: 12 },
      { playId: { toString: "invalid" }, score: 12 },
      { playId, score: 12, played_at: "yesterday" }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal((await post({}, { body: "{" })).status, 400);
    assert.equal((await post({}, { headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await post({}, { body: " ".repeat(3000) })).status, 413);
    assert.equal((await post({}, { headers: { "Content-Type": "application/json", Origin: "" } })).status, 403);
    assert.equal((await post({ playId, score: 12 }, { headers: { "Content-Type": "application/json", Origin: "https://example.com" } })).status, 403);
    assert.equal((await request("/api/results")).status, 405);
    assert.equal((await request("/api/rankings", { method: "POST" })).status, 405);
    assert.equal((await request("/api/missing")).status, 404);
    assert.equal((await request("/scripts/game-store.js")).status, 404);
    assert.equal((await request("/.local/postgres/app-connection.json")).status, 404);

    // 高いスコアの検証用記録で上位10件と同点の並びを確認。
    const rankingIds = [];
    for (let index = 0; index < 12; index++) {
      const id = makeId(); rankingIds.push(id);
      assert.equal((await post({ playId: id, score: 2000000000 + index })).status, 201);
    }
    await admin.query("UPDATE game_results SET score = 2000000100, played_at = $1 WHERE play_id = $2", ["2026-10-09T01:00:00Z", rankingIds[0]]);
    await admin.query("UPDATE game_results SET score = 2000000100, played_at = $1 WHERE play_id = $2", ["2026-10-09T02:00:00Z", rankingIds[1]]);
    const rankings = (await (await request("/api/rankings")).json()).results;
    const expected = (await admin.query("SELECT id, score, played_at FROM game_results WHERE user_id = $1 ORDER BY score DESC, played_at DESC, id DESC LIMIT 10", [aliceId])).rows;
    assert.equal(rankings.length, 10);
    assert.deepEqual(rankings, JSON.parse(JSON.stringify(expected)));
    assert.equal(Number((await admin.query("SELECT count(*) FROM game_results")).rows[0].count), initialCount + 15);

    // アプリ用アカウントは読み出し・追加だけ。管理操作は許可されない。
    const rights = (await app.query("SELECT current_user, has_table_privilege(current_user, 'game_results', 'SELECT') AS can_read, has_table_privilege(current_user, 'game_results', 'INSERT') AS can_insert")).rows[0];
    assert.equal(rights.current_user, "latte_app");
    assert.ok(rights.can_read && rights.can_insert);
    for (const sql of ["DELETE FROM game_results WHERE false", "UPDATE game_results SET score = 0 WHERE false", "CREATE TABLE public.forbidden_test(id integer)"]) {
      await assert.rejects(app.query(sql), error => error.code === "42501");
    }
    await app.end(); app = null;
    await admin.end(); admin = null;

    // DBが停止してもゲーム用ファイルは取得できる。復旧後の再送は重複しない。
    dbAction("stop");
    assert.equal((await request("/api/rankings")).status, 503);
    assert.equal((await post({ playId, score: 12 })).status, 503);
    assert.equal((await request("/")).status, 200);
    dbAction("start");
    assert.equal((await request("/api/rankings")).status, 200);
    let duplicate = await post({ playId, score: 12 });
    assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).result, original);

    await stopServer(child); child = await startServer(port);
    duplicate = await post({ playId, score: 12 });
    assert.equal(duplicate.status, 200);
    assert.deepEqual((await duplicate.json()).result, original);
    // セッションはHTTPサーバーとDBの再起動後も有効。期限切れは拒否。
    assert.equal((await (await request("/api/auth/me")).json()).user.id, aliceId);
    admin = adminPool();
    await admin.query("UPDATE game_sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [aliceId]);
    assert.equal((await request("/api/rankings")).status, 401);
    assert.equal((await post({ playId: makeId(), score: 2 })).status, 401);
    // 認証の試行制限。無効な入力でハッシュ計算をせず回数を確認する。
    let rateResponse;
    for (let attempt = 0; attempt < 31; attempt++) {
      rateResponse = await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "x", password: "short" }) });
    }
    assert.equal(rateResponse.status, 429);
  } finally {
    await stopServer(child);
    if (app) await app.end();
    dbAction("start");
    if (!admin) admin = adminPool();
    await admin.query("DELETE FROM game_results WHERE play_id = ANY($1::uuid[])", [playIds]);
    await admin.query("DELETE FROM game_users WHERE id = ANY($1::int[])", [userIds]);
    await admin.end();
    if (!wasRunning) dbAction("stop");
  }
});
