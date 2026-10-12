const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");
const { serverConfig } = require("../scripts/server-config");
const { snapshot, writeBackup, restoreIntoEmptyDatabase } = require("../scripts/game-backup");
const root = path.resolve(__dirname, "..");

test("production requires a fixed HTTPS origin and Render URL is supported", () => {
  assert.throws(() => serverConfig({ NODE_ENV: "production" }), /APP_ORIGIN/);
  for (const origin of ["http://game.example", "https://game.example/path", "https://user:password@game.example", "https://game.example?x=1"]) {
    assert.throws(() => serverConfig({ NODE_ENV: "production", APP_ORIGIN: origin }));
  }
  const config = serverConfig({ NODE_ENV: "production", RENDER_EXTERNAL_URL: "https://cats.onrender.com", PORT: "10000" });
  assert.deepEqual(config.allowedOrigins, ["https://cats.onrender.com"]);
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 10000);
  assert.equal(serverConfig({}).host, "127.0.0.1");
});

test("production proxy requests, Secure sessions, private logs and backup restoration", { timeout: 60000 }, async () => {
  const runDb = action => {
    const result = spawnSync(process.execPath, ["scripts/database.js", action], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const wasRunning = runDb("status").includes("is running");
  runDb("start");
  const config = JSON.parse(fs.readFileSync(path.join(root, ".local/postgres/app-connection.json"), "utf8"));
  const password = fs.readFileSync(path.join(root, ".local/postgres/pgpass.conf"), "utf8").trim().split(":").at(-1);
  const adminConfig = { ...config, user: "latte_admin", password, max: 1 };
  const admin = new Pool(adminConfig);
  const prefix = crypto.randomBytes(6).toString("hex");
  const username = "public_" + prefix;
  const database = "latte_restore_test_" + prefix;
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let server, restored, created = false, cookie = "", session = {};
  const logs = [];
  const origin = "https://game.example";
  const request = (route, options = {}) => fetch(`http://127.0.0.1:${port}${route}`, { ...options,
    headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": session.csrfToken || "", "X-Game-User": String(session.user?.id || ""), ...options.headers },
    signal: AbortSignal.timeout(10000) });
  const post = (route, data, headers = {}) => request(route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data) });
  try {
    server = spawn(process.execPath, ["scripts/server.js"], { cwd: root,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", APP_ORIGIN: origin, DATABASE_MODE: "local" },
      windowsHide: true, stdio: "pipe" });
    server.stdout.on("data", chunk => logs.push(chunk.toString())); server.stderr.resume();
    await Promise.race([once(server.stdout, "data"), once(server, "exit").then(() => { throw new Error("Production server did not start"); })]);
    const credentials = { username, password: "test-secret-password-1234" };
    assert.equal((await post("/api/auth/register", credentials, { Origin: "http://localhost:" + port })).status, 403);
    assert.equal((await post("/api/auth/register", credentials, { Origin: "https://evil.example", "X-Forwarded-Host": "game.example", "X-Forwarded-Proto": "https" })).status, 403);
    assert.equal((await post("/api/auth/register", credentials, { Origin: "" })).status, 403);
    const registered = await post("/api/auth/register", credentials);
    assert.equal(registered.status, 201);
    assert.match(registered.headers.get("set-cookie"), /; Secure/);
    assert.match(registered.headers.get("strict-transport-security"), /max-age/);
    assert.match(registered.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    session = await registered.json(); cookie = registered.headers.get("set-cookie").split(";")[0];
    assert.equal((await (await request("/api/auth/me")).json()).user.id, session.user.id);
    const playId = crypto.randomUUID();
    assert.equal((await post("/api/results", { playId, score: 11 })).status, 201);
    assert.equal((await post("/api/results", { playId, score: 11 })).status, 200);
    const ranking = await (await request("/api/rankings")).json();
    assert.equal(ranking.personalBest.score, 11);
    assert.ok(ranking.results.some(result => result.username === username && result.score === 11));
    const health = await request("/healthz");
    assert.equal(health.status, 200); assert.equal(await health.text(), "ok");
    assert.equal((await request("/healthz", { method: "POST" })).status, 405);
    assert.equal((await request("/.env")).status, 404);
    assert.equal((await request("/scripts/server-config.js")).status, 404);
    await request("/?password=private-query-value&token=private-token-value");
    const joinedLogs = logs.join("");
    for (const secret of ["test-secret-password-1234", "private-query-value", "private-token-value", session.csrfToken, cookie]) assert.ok(!joinedLogs.includes(secret));
    assert.ok(joinedLogs.includes('"requestId"'));
    // 実データを含む控えはGit管理外へ保存し、新しい検証用DBだけへ復元。
    const data = await snapshot(admin);
    const filename = path.join(root, ".local/backups", `test-${prefix}.json`);
    await writeBackup(data, filename);
    await assert.rejects(writeBackup(data, filename), error => error.code === "EEXIST");
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    restored = new Pool({ ...adminConfig, database });
    for (const file of ["schema.sql", "stage3.sql", "stage4.sql"]) await restored.query(fs.readFileSync(path.join(root, "database", file), "utf8"));
    const client = await restored.connect();
    try {
      await restoreIntoEmptyDatabase(client, data);
      await assert.rejects(restoreIntoEmptyDatabase(client, data), /空の/);
    } finally { client.release(); }
    const copy = await snapshot(restored);
    assert.deepEqual(copy.users, data.users);
    assert.deepEqual(copy.results, data.results);
    assert.equal((await restored.query("SELECT count(*) FROM game_sessions")).rows[0].count, "0");
    const oldMaximum = data.results.reduce((value, row) => BigInt(row.id) > value ? BigInt(row.id) : value, 0n);
    const added = (await restored.query("INSERT INTO game_results(score,user_id,play_id) VALUES(2,$1,$2) RETURNING id", [session.user.id, crypto.randomUUID()])).rows[0];
    assert.ok(BigInt(added.id) > oldMaximum);
    const loggedOut = await post("/api/auth/logout", {});
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.headers.get("set-cookie"), /Max-Age=0; Secure/);
    assert.equal((await request("/api/rankings")).status, 401);
  } finally {
    if (server && server.exitCode === null) { const ended = once(server, "exit"); server.kill(); await ended; }
    if (restored) await restored.end();
    if (created) {
      assert.match(database, /^latte_restore_test_[a-f0-9]{12}$/);
      await admin.query(`DROP DATABASE "${database}"`);
    }
    await admin.query("DELETE FROM game_results WHERE user_id IN (SELECT id FROM game_users WHERE username=$1)", [username]);
    await admin.query("DELETE FROM game_users WHERE username=$1", [username]);
    await admin.end();
    if (!wasRunning) runDb("stop");
  }
});
