// 実際のEdgeで登録、30秒プレイ、未送信結果の利用者分離を確認します。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { Pool } = require("pg");
const root = path.resolve(__dirname, "..");
const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function poll(fn, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await delay(100);
  }
  throw new Error("Browser condition timed out.");
}

test("stage 4 browser: accounts, real game, pending queue separation and retry", { timeout: 100000, skip: !fs.existsSync(edgePath) }, async () => {
  const status = spawnSync(process.execPath, ["scripts/database.js", "status"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(status.status, 0);
  const wasRunning = status.stdout.includes("is running");
  const started = spawnSync(process.execPath, ["scripts/database.js", "start"], { cwd: root, windowsHide: true, encoding: "utf8" });
  assert.equal(started.status, 0, started.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, ".local/postgres/app-connection.json"), "utf8"));
  const password = fs.readFileSync(path.join(root, ".local/postgres/pgpass.conf"), "utf8").trim().split(":").at(-1);
  const admin = new Pool({ ...config, user: "latte_admin", password, max: 1 });
  const prefix = "browser_" + crypto.randomBytes(6).toString("hex");
  const usernames = [prefix + "_a", prefix + "_b"];
  const port = await freePort();
  const debugPort = await freePort();
  const profile = path.join(root, ".local", prefix);
  let server, browser, socket;
  const errors = [];
  let commandId = 0;
  const commands = new Map();
  try {
    server = spawn(process.execPath, ["scripts/server.js"], { cwd: root, env: { ...process.env, DATABASE_MODE: "local", PORT: String(port) }, windowsHide: true, stdio: "pipe" });
    server.stderr.resume(); server.stdout.resume();
    await poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}`)).ok; } catch { return false; } });
    browser = spawn(edgePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    let target;
    await poll(async () => { try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === "page"); return !!target; } catch { return false; } });
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
      if (message.id) {
        const pending = commands.get(message.id);
        if (!pending) return;
        commands.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
      }
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++commandId; commands.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await cdp("Runtime.enable"); await cdp("Network.enable");
    await cdp("Page.navigate", { url: `http://127.0.0.1:${port}` });
    await poll(() => evaluate("typeof currentUser !== 'undefined' && !authBusy"));
    assert.equal(await evaluate("startButton.disabled"), true);
    assert.equal(await evaluate("catSelectionElement.hidden"), true);
    assert.equal(await evaluate("document.querySelector('.field-wrap').getClientRects().length"), 0);
    assert.equal(await evaluate("document.querySelector('.ranking').getClientRects().length"), 0);
    assert.equal(await evaluate("document.querySelector('.status').getClientRects().length"), 0);
    assert.equal(await evaluate("document.getElementById('item-intro')"), null);
    const signIn = async (username, register) => {
      await evaluate(`document.getElementById('username').value=${JSON.stringify(username)}; document.getElementById('password').value='browser-password-12345'; document.getElementById(${JSON.stringify(register ? "register" : "login")}).click()`);
      await poll(() => evaluate(`currentUser?.username === ${JSON.stringify(username)} && !authBusy && !savingResults`));
    };
    await signIn(usernames[0], true);
    const aliceId = await evaluate("currentUser.id");
    assert.equal(await evaluate("catSelectionElement.hidden"), false);
    assert.ok(await evaluate("[...document.querySelectorAll('.cat-option small')].every(element => element.textContent.includes('5秒ごとに出現') && element.textContent.includes('5秒間スピードが2倍'))"));
    assert.ok(await evaluate("document.querySelector('.field-wrap').getClientRects().length > 0 && document.querySelector('.ranking').getClientRects().length > 0"));
    await evaluate("document.querySelector('input[value=leche]').click()");
    assert.equal(await evaluate("catElement.getAttribute('src')"), "images/leche.png");
    assert.equal(await evaluate("startCatElement.getAttribute('src')"), "images/leche.png");
    await poll(() => evaluate("startCatElement.complete && startCatElement.naturalWidth > 0 && catElement.complete && catElement.naturalWidth > 0"));
    // パスワード欄でもWASDが入力できる（ログインフォーム操作を妨げない）。
    assert.equal(await evaluate("document.cookie.includes('latte_session')"), false);
    await cdp("Network.setBlockedURLs", { urls: ["*/api/results"] });
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    assert.equal(await evaluate("catSelectionElement.disabled"), true);
    await evaluate("document.querySelector('input[value=latte]').click()");
    assert.equal(await evaluate("selectedCat"), "leche");
    const catX = await evaluate("cat.x");
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 });
    await delay(300);
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 });
    assert.ok(await evaluate(`cat.x > ${catX}`));
    await poll(() => evaluate("strawberries.length > 0"));
    assert.equal(await evaluate("strawberries[0].element.textContent"), "🐟");
    assert.equal(await evaluate("strawberries[0].element.getAttribute('aria-label')"), "鰹節：5秒間スピード2倍");
    await evaluate("cat.x = strawberries[0].x; cat.y = strawberries[0].y");
    await poll(() => evaluate("catElement.classList.contains('boosted')"));
    assert.ok(await evaluate("boostStatusElement.textContent.includes('🐟')"));
    await poll(() => evaluate("!playing && !gameOverElement.hidden && !savingResults"), 35000);
    assert.equal(await evaluate("pendingResults.length"), 1);
    assert.equal(await evaluate("timeElement.textContent"), "0");
    assert.equal(await evaluate("mice.length"), 6);
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/leche.png");
    assert.equal(await evaluate("catSelectionElement.disabled"), false);
    await evaluate("document.querySelector('input[value=latte]').click()");
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/leche.png");
    const aliceScore = await evaluate("Number(finalScoreElement.textContent)");
    await cdp("Page.reload");
    await poll(() => evaluate("typeof currentUser !== 'undefined' && currentUser !== null && !authBusy && !savingResults"));
    assert.equal(await evaluate("pendingResults.length"), 1);
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    assert.equal(await evaluate("document.querySelector('.field-wrap').getClientRects().length"), 0);
    assert.equal(await evaluate("document.querySelector('.ranking').getClientRects().length"), 0);
    await signIn(usernames[1], true);
    const bobId = await evaluate("currentUser.id");
    assert.equal(await evaluate("pendingResults.length"), 0);
    assert.equal(await evaluate("rankingBodyElement.children.length"), 0);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem(storageKey(${aliceId}))).length`), 1);
    // 別利用者で戻ったときに、Aの控えをBへ送らない。
    await cdp("Network.setBlockedURLs", { urls: [] });
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    assert.equal(await evaluate("catElement.getAttribute('src')"), "images/latte.png");
    await evaluate("startTime -= 5100");
    await poll(() => evaluate("strawberries.length > 0"));
    assert.equal(await evaluate("strawberries[0].element.textContent"), "🍓");
    await evaluate("score = 7; startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults && rankingBodyElement.children.length === 1"));
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/latte.png");
    assert.equal((await admin.query("SELECT score FROM game_results WHERE user_id = $1", [bobId])).rows[0].score, 7);
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [aliceId])).rows[0].count, "0");
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    // テキスト入力上のゲームキーはpreventDefaultしない。
    assert.equal(await evaluate("const input = document.getElementById('username'); const event = new KeyboardEvent('keydown', {key:'a', bubbles:true, cancelable:true}); input.dispatchEvent(event); event.defaultPrevented"), false);
    await signIn(usernames[0], false);
    await poll(() => evaluate("pendingResults.length === 0 && rankingBodyElement.children.length === 1"));
    const aliceRows = (await admin.query("SELECT score FROM game_results WHERE user_id = $1", [aliceId])).rows;
    assert.deepEqual(aliceRows.map(row => row.score), [aliceScore]);
    assert.equal(await evaluate(`localStorage.getItem(storageKey(${aliceId}))`), null);
    // 別タブでBへログインした状況：Cookieだけ変わり、Aのゲーム画面は残る。
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    assert.equal(await evaluate(`(async () => (await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:${JSON.stringify(usernames[1])},password:'browser-password-12345'})})).status)()`), 200);
    await evaluate("score = 9; startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults && pendingResults.length === 1"));
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [bobId])).rows[0].count, "1");
    await evaluate("refreshRankingButton.click()");
    await poll(() => evaluate("!refreshRankingButton.disabled"));
    assert.equal(await evaluate("rankingBodyElement.children.length"), 0);
    await cdp("Page.reload");
    await poll(() => evaluate(`currentUser?.id === ${bobId} && !authBusy`));
    assert.equal(await evaluate("pendingResults.length"), 0);
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    await signIn(usernames[0], false);
    await poll(() => evaluate("pendingResults.length === 0 && rankingBodyElement.children.length === 2"));
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [aliceId])).rows[0].count, "2");
    assert.deepEqual(errors, []);
    // スマホ幅で、実際のタッチ入力による移動と指を離した後の停止を確認。
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.touch-controls')).display"), "block");
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    await evaluate("document.querySelector('[data-direction=arrowright]').scrollIntoView({block:'center'})");
    const touchPosition = await evaluate("(() => { const rect=document.querySelector('[data-direction=arrowright]').getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()");
    const beforeTouch = await evaluate("cat.x");
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchPosition, id: 1 }] });
    await delay(150);
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(await evaluate(`cat.x > ${beforeTouch}`));
    assert.equal(await evaluate("touchKeys.size"), 0);
    const stoppedX = await evaluate("cat.x");
    await delay(150);
    assert.equal(await evaluate("cat.x"), stoppedX);
    await evaluate("startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults"));
    assert.ok(await evaluate("(() => { const button=restartButton.getBoundingClientRect(); const area=field.getBoundingClientRect(); return button.bottom <= area.bottom && button.top >= area.top; })()"));
    assert.deepEqual(errors, []);
    const mobileScreenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, ".local", "stage5-mobile-preview.png"), Buffer.from(mobileScreenshot.data, "base64"));
    await cdp("Emulation.clearDeviceMetricsOverride");
    // レビュー用のスクリーンショット。
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, ".local", "stage4-preview.png"), Buffer.from(screenshot.data, "base64"));
    console.log("Edge: real 30-second game, movement, reload, two users, queue retry, changed shared Cookie; no JavaScript exceptions.");
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: ++commandId, method: "Browser.close" }));
      await delay(500); socket.close();
    }
    if (browser && browser.exitCode === null) browser.kill();
    if (server && server.exitCode === null) { const exited = once(server, "exit"); server.kill(); await exited; }
    const users = (await admin.query("SELECT id FROM game_users WHERE username = ANY($1::text[])", [usernames])).rows.map(user => user.id);
    await admin.query("DELETE FROM game_results WHERE user_id = ANY($1::int[])", [users]);
    await admin.query("DELETE FROM game_users WHERE id = ANY($1::int[])", [users]);
    await admin.end();
    if (!wasRunning) spawnSync(process.execPath, ["scripts/database.js", "stop"], { cwd: root, windowsHide: true });
  }
});
