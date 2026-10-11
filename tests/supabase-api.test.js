// 明示したSupabase接続だけで実行します。終了後の検証利用者は管理用SQLで削除します。
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

test("Supabase: register, login, save once, ranking and logout", { timeout: 25000, skip: process.env.SUPABASE_SMOKE_TEST !== "1" }, async () => {
  assert.equal(process.env.DATABASE_MODE, "supabase");
  const root = path.resolve(__dirname, "..");
  const username = "cloud_" + crypto.randomBytes(8).toString("hex");
  const playId = crypto.randomUUID();
  await fs.writeFile(path.join(root, ".local/supabase/smoke-cleanup.json"), JSON.stringify({ username, playId }), { flag: "wx" });
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  // npmや--env-fileを経由しない、従来の起動方法でも.envを読み込むことを確認。
  const serverEnv = { ...process.env, PORT: String(port) };
  for (const key of ["DATABASE_MODE", "DATABASE_URL", "DATABASE_SSL_CA_FILE"]) delete serverEnv[key];
  const server = spawn(process.execPath, ["scripts/server.js"], { cwd: root, env: serverEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.resume();
  let cookie, csrfToken, userId;
  const base = `http://127.0.0.1:${port}`;
  async function api(route, body) {
    const response = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}), ...(userId ? { "X-Game-User": String(userId) } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const newCookie = response.headers.get("set-cookie");
    if (newCookie) cookie = newCookie.split(";")[0];
    const data = await response.json();
    assert.ok(response.ok, `HTTP ${response.status}`);
    if (data.csrfToken) csrfToken = data.csrfToken;
    if (data.user) userId = data.user.id;
    return data;
  }
  try {
    await Promise.race([once(server.stdout, "data"), once(server, "exit").then(() => { throw new Error("Server startup failed"); })]);
    server.stdout.resume();
    const credentials = { username, password: crypto.randomBytes(24).toString("hex") };
    assert.equal((await api("/api/auth/register", credentials)).user.username, username);
    assert.equal((await api("/api/auth/me")).user.id, userId);
    await api("/api/auth/logout", {});
    assert.equal((await api("/api/auth/me")).user, null);
    assert.equal((await api("/api/auth/login", credentials)).user.username, username);
    const saved = await api("/api/results", { playId, score: 4 });
    assert.equal(saved.result.score, 4);
    const duplicate = await api("/api/results", { playId, score: 4 });
    assert.equal(duplicate.result.id, saved.result.id);
    const ranking = await api("/api/rankings");
    assert.equal(ranking.results.length, 1);
    assert.equal(ranking.results[0].score, 4);
    const image = await fetch(base + "/images/leche.png");
    assert.equal(image.status, 200);
    await api("/api/auth/logout", {});
    console.log("Cloud API verified. Cleanup marker: .local/supabase/smoke-cleanup.json");
  } finally {
    if (server.exitCode === null) { const ended = once(server, "exit"); server.kill(); await ended; }
  }
});
