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
    assert.equal(await evaluate("selectedCat"), "leche");
    assert.equal(await evaluate("document.querySelector('input[name=play-cat]:checked').value"), "leche");
    assert.equal(await evaluate("personalBestElement.hidden"), false);
    assert.equal(await evaluate("personalBestElement.textContent"), "自己ベスト：まだ記録がありません。");
    assert.equal(await evaluate("catSelectionElement.hidden"), false);
    assert.ok(await evaluate("[...document.querySelectorAll('.cat-details')].every(element => element.querySelectorAll('[role=listitem]').length === 4 && !element.textContent.includes('出現'))"));
    assert.ok(await evaluate("document.querySelector('input[value=leche]').closest('label').textContent.includes('🐟：7秒間スピード2倍')"));
    assert.ok(await evaluate("document.querySelector('input[value=latte]').closest('label').textContent.includes('🍓：5秒間スピード2.5倍')"));
    assert.equal(await evaluate("document.getElementById('account-title').hidden"), true);
    assert.equal(await evaluate("accountMessage.textContent"), `ログイン名：${usernames[0]}`);
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
    // 保存・再送テストでは親の接触効果を分離し、別のテストで確認する。
    await evaluate("updateParents = () => false");
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
    assert.equal(await evaluate("strawberries[0].element.getAttribute('aria-label')"), "鰹節：7秒間スピード2倍");
    await evaluate("cat.x = strawberries[0].x; cat.y = strawberries[0].y");
    await poll(() => evaluate("catElement.classList.contains('boosted')"));
    assert.ok(await evaluate("boostUntil - performance.now() > 6500 && boostUntil - performance.now() <= 7000"));
    assert.ok(await evaluate("boostStatusElement.textContent.includes('🐟')"));
    await poll(() => evaluate("!playing && !gameOverElement.hidden && !savingResults"), 35000);
    assert.equal(await evaluate("pendingResults.length"), 1);
    assert.equal(await evaluate("selectedCat"), "leche");
    assert.equal(await evaluate("timeElement.textContent"), "0");
    assert.equal(await evaluate("mice.filter(mouse => !mouse.special).length"), 15);
    assert.equal(await evaluate("mice.filter(mouse => mouse.special).length"), 2);
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/leche.png");
    assert.equal(await evaluate("catSelectionElement.disabled"), false);
    await evaluate("document.querySelector('input[value=latte]').click()");
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/leche.png");
    const aliceScore = await evaluate("Number(finalScoreElement.textContent)");
    await cdp("Page.reload");
    await poll(() => evaluate("typeof currentUser !== 'undefined' && currentUser !== null && !authBusy && !savingResults"));
    assert.equal(await evaluate("pendingResults.length"), 1);
    assert.equal(await evaluate("document.querySelector('input[name=play-cat]:checked').value"), "leche");
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    assert.equal(await evaluate("personalBestElement.hidden"), true);
    assert.equal(await evaluate("document.querySelector('.field-wrap').getClientRects().length"), 0);
    assert.equal(await evaluate("document.querySelector('.ranking').getClientRects().length"), 0);
    await signIn(usernames[1], true);
    const bobId = await evaluate("currentUser.id");
    assert.equal(await evaluate("pendingResults.length"), 0);
    assert.equal(await evaluate("personalBestElement.textContent"), "自己ベスト：まだ記録がありません。");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem(storageKey(${aliceId}))).length`), 1);
    // 別利用者で戻ったときに、Aの控えをBへ送らない。
    await cdp("Network.setBlockedURLs", { urls: [] });
    await evaluate("document.querySelector('input[value=latte]').click()");
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    await evaluate("updateParents = () => false");
    assert.equal(await evaluate("catElement.getAttribute('src')"), "images/latte.png");
    assert.equal(await evaluate("mice.some(mouse => mouse.special)"), false);
    await evaluate("startTime -= 5100");
    await poll(() => evaluate("strawberries.length > 0"));
    assert.equal(await evaluate("strawberries[0].element.textContent"), "🍓");
    assert.equal(await evaluate("strawberries[0].element.getAttribute('aria-label')"), "苺：5秒間スピード2.5倍");
    await evaluate("cat.x = strawberries[0].x; cat.y = strawberries[0].y");
    await poll(() => evaluate("catElement.classList.contains('boosted')"));
    assert.ok(await evaluate("boostUntil - performance.now() > 4500 && boostUntil - performance.now() <= 5000"));
    // 残り11秒では不在、残り10秒で1匹だけ出現する。
    await evaluate("startTime = performance.now() - 19000");
    await delay(100);
    assert.equal(await evaluate("mice.some(mouse => mouse.special)"), false);
    await evaluate("startTime = performance.now() - 20001");
    await poll(() => evaluate("mice.some(mouse => mouse.special)"));
    assert.equal(await evaluate("mice.filter(mouse => mouse.special).length"), 1);
    assert.equal(await evaluate("mice.find(mouse => mouse.special).element.getAttribute('src')"), "images/mouse-busaiku.png");
    await poll(() => evaluate("mice.find(mouse => mouse.special).element.complete && mice.find(mouse => mouse.special).element.naturalWidth === 180"));
    // 次の実フレームの移動距離が通常速度115px/秒の3倍になる。
    const movement = await evaluate(`new Promise(resolve => requestAnimationFrame(() => {
      const special = mice.find(mouse => mouse.special);
      cat.x = bounds().minX; cat.y = bounds().minY;
      special.x = field.clientWidth / 2; special.y = field.clientHeight / 2;
      special.dx = 1; special.dy = 0; lastDirectionTime = performance.now();
      const x = special.x; const before = previousTime;
      requestAnimationFrame(() => resolve({distance: special.x - x,
        expected: 115 * 3 * characterScale * Math.min((previousTime - before) / 1000, 0.05)}));
    }))`);
    assert.ok(movement.distance > 0);
    assert.ok(Math.abs(movement.distance - movement.expected) < 0.001);
    // 捕獲で5P加点。通常ネズミの加点は1P。
    await evaluate("resetRiku(); resetMomo(); updateRiku = () => {}; updateMomo = () => {}");
    const beforeSpecial = await evaluate("for (const mouse of mice.filter(mouse => !mouse.special)) { mouse.x = bounds().maxX; mouse.y = bounds().maxY; } const special = mice.find(mouse => mouse.special); cat.x = special.x; cat.y = special.y; score");
    await poll(() => evaluate(`score === ${beforeSpecial + 5}`));
    const beforeNormal = await evaluate("const normal = mice.find(mouse => !mouse.special); cat.x = normal.x; cat.y = normal.y; for (const mouse of mice.filter(mouse => mouse !== normal)) { mouse.x = bounds().minX; mouse.y = bounds().minY; } score");
    await poll(() => evaluate(`score === ${beforeNormal + 1}`));
    await evaluate("startTime = performance.now() - 27001");
    await poll(() => evaluate("mice.filter(mouse => !mouse.special).length === 14"));
    assert.equal(await evaluate("mice.filter(mouse => mouse.special).length"), 2);
    await evaluate("score = 7; startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults && personalBestElement.textContent === '自己ベスト：7P'"));
    assert.equal(await evaluate("personalBestElement.querySelector('img').getAttribute('src')"), "images/latte.png");
    assert.equal(await evaluate("personalBestElement.querySelector('img').alt"), "ラテ");
    assert.ok(await evaluate("[...rankingBodyElement.rows].some(row => row.cells[3].textContent === 'ラテ')"));
    assert.ok(await evaluate(`rankingBodyElement.textContent.includes(${JSON.stringify(usernames[1])})`));
    assert.equal(await evaluate("resultCatElement.getAttribute('src')"), "images/latte.png");
    assert.equal((await admin.query("SELECT score FROM game_results WHERE user_id = $1", [bobId])).rows[0].score, 7);
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [aliceId])).rows[0].count, "0");
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    // テキスト入力上のゲームキーはpreventDefaultしない。
    assert.equal(await evaluate("const input = document.getElementById('username'); const event = new KeyboardEvent('keydown', {key:'a', bubbles:true, cancelable:true}); input.dispatchEvent(event); event.defaultPrevented"), false);
    await signIn(usernames[0], false);
    await poll(() => evaluate(`pendingResults.length === 0 && personalBestElement.textContent === '自己ベスト：${aliceScore}P'`));
    assert.equal(await evaluate("personalBestElement.querySelector('img').getAttribute('src')"), "images/leche.png");
    assert.equal(await evaluate("personalBestElement.querySelector('img').alt"), "レチェ");
    assert.ok(await evaluate("[...rankingBodyElement.rows].some(row => row.cells[3].textContent === 'レチェ')"));
    assert.ok(await evaluate(`rankingBodyElement.textContent.includes(${JSON.stringify(usernames[0])}) && rankingBodyElement.textContent.includes(${JSON.stringify(usernames[1])})`));
    const aliceRows = (await admin.query("SELECT score FROM game_results WHERE user_id = $1", [aliceId])).rows;
    assert.deepEqual(aliceRows.map(row => row.score), [aliceScore]);
    assert.equal(await evaluate(`localStorage.getItem(storageKey(${aliceId}))`), null);
    // 別タブでBへログインした状況：Cookieだけ変わり、Aのゲーム画面は残る。
    await evaluate("startButton.click()");
    await poll(() => evaluate("playing"));
    await evaluate("updateParents = () => false");
    assert.equal(await evaluate("mice.some(mouse => mouse.special)"), false);
    assert.equal(await evaluate(`(async () => (await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:${JSON.stringify(usernames[1])},password:'browser-password-12345'})})).status)()`), 200);
    await evaluate("score = 9; startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults && pendingResults.length === 1"));
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [bobId])).rows[0].count, "1");
    await evaluate("refreshRankingButton.click()");
    await poll(() => evaluate("!refreshRankingButton.disabled"));
    assert.equal(await evaluate("rankingBodyElement.children.length"), 0);
    assert.ok(await evaluate("personalBestElement.textContent.includes('取得できませんでした')"));
    await cdp("Page.reload");
    await poll(() => evaluate(`typeof currentUser !== 'undefined' && currentUser?.id === ${bobId} && !authBusy`));
    assert.equal(await evaluate("pendingResults.length"), 0);
    await evaluate("logoutButton.click()");
    await poll(() => evaluate("currentUser === null && !authBusy"));
    await signIn(usernames[0], false);
    await poll(() => evaluate(`pendingResults.length === 0 && personalBestElement.textContent === '自己ベスト：${Math.max(aliceScore, 9)}P'`));
    assert.equal(await evaluate("personalBestElement.querySelector('img').alt"), aliceScore > 9 ? "レチェ" : "ラテ");
    assert.equal((await admin.query("SELECT count(*) FROM game_results WHERE user_id = $1", [aliceId])).rows[0].count, "2");
    assert.deepEqual(errors, []);
    // 縦向きでは開始を待ち、横向きで実際のタッチ入力を確認。
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
    assert.equal(await evaluate("innerWidth"), 390);
    assert.ok(await evaluate("document.documentElement.scrollWidth <= innerWidth"));
    assert.equal(await evaluate("document.querySelector('.touch-controls')"), null);
    await evaluate("startButton.click()");
    await poll(() => evaluate("countingDown && !rotateGuide.hidden"));
    await delay(350);
    assert.equal(await evaluate("countdownNumberElement.textContent"), "3");
    assert.equal(await evaluate("playing"), false);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await poll(() => evaluate("playing"));
    await evaluate("updateParents = () => false");
    assert.equal(await evaluate("rotateGuide.hidden"), true);
    assert.ok(await evaluate("(() => { const rect=field.getBoundingClientRect(); return rect.width > innerWidth * .9 && rect.height > innerHeight * .8 && rect.bottom <= innerHeight; })()"));
    assert.equal(await evaluate("document.querySelector('.ranking').getClientRects().length"), 0);
    assert.equal(await evaluate("document.querySelector('.account').getClientRects().length"), 0);
    const touchPosition = await evaluate("(() => { const rect=field.getBoundingClientRect(); return {x:rect.x+80,y:rect.y+100}; })()");
    const beforeTouch = await evaluate("cat.x");
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchPosition, id: 1 }] });
    await delay(100);
    assert.equal(await evaluate("cat.x"), beforeTouch);
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchPosition.x + 40, y: touchPosition.y + 40, id: 1 }] });
    const beforeDiagonalY = await evaluate("cat.y");
    await delay(150);
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.ok(await evaluate(`cat.x > ${beforeTouch}`));
    assert.ok(await evaluate(`cat.y > ${beforeDiagonalY}`));
    assert.equal(await evaluate("touch.pointerId"), null);
    const stoppedX = await evaluate("cat.x");
    await delay(150);
    assert.equal(await evaluate("cat.x"), stoppedX);
    // キャンセル時にも停止し、画面回転中は時間とアイテム効果を保持する。
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touchPosition, id: 1 }] });
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchPosition.x + 40, y: touchPosition.y, id: 1 }] });
    await cdp("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    assert.equal(await evaluate("touch.pointerId"), null);
    await evaluate("boostUntil = performance.now() + 5000");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await poll(() => evaluate("!rotateGuide.hidden"));
    const frozenTime = await evaluate("timeElement.textContent");
    await delay(1200);
    assert.equal(await evaluate("timeElement.textContent"), frozenTime);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await poll(() => evaluate("rotateGuide.hidden"));
    assert.ok(await evaluate("boostUntil - performance.now() > 4500"));
    const landscapeScreenshot = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(root, ".local", "landscape-touch-preview.png"), Buffer.from(landscapeScreenshot.data, "base64"));
    const scrollBeforeEnd = await evaluate("scrollY");
    await evaluate("startTime = performance.now() - 30001");
    await poll(() => evaluate("!playing && !savingResults"));
    assert.equal(await evaluate("document.body.classList.contains('mobile-play')"), true);
    assert.ok(await evaluate("document.querySelector('.ranking').getClientRects().length === 0 && document.querySelector('.account').getClientRects().length === 0"));
    assert.ok(await evaluate("(() => { const area=field.getBoundingClientRect(); const card=gameOverElement.querySelector('.result-card').getBoundingClientRect(); return area.top >= 0 && area.bottom <= innerHeight && card.top >= area.top && card.bottom <= area.bottom && card.left >= area.left && card.right <= area.right; })()"));
    assert.equal(await evaluate("scrollY"), scrollBeforeEnd);
    // 高さの小さい横画面でも、長い保存エラーとボタンはカード内に収める。
    await cdp("Emulation.setDeviceMetricsOverride", { width: 667, height: 280, deviceScaleFactor: 1, mobile: true });
    await evaluate("resultSaveMessageElement.textContent = '保存できませんでした。接続を確認し、猫の選択・ランキング画面から保存を再試行してください。'.repeat(3)");
    assert.ok(await evaluate("(() => { const area=field.getBoundingClientRect(); const card=gameOverElement.querySelector('.result-card'); const rect=card.getBoundingClientRect(); card.scrollTop=card.scrollHeight; const button=returnMenuButton.getBoundingClientRect(); return rect.top >= area.top && rect.bottom <= area.bottom && button.top >= rect.top && button.bottom <= rect.bottom; })()"));
    await evaluate("resultSaveMessageElement.textContent = '記録を保存しました！'; gameOverElement.querySelector('.result-card').scrollTop = 0");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate("(() => { const button=restartButton.getBoundingClientRect(); const area=field.getBoundingClientRect(); return button.bottom <= area.bottom && button.top >= area.top; })()"));
    assert.deepEqual(errors, []);
    const mobileScreenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, ".local", "stage5-mobile-preview.png"), Buffer.from(mobileScreenshot.data, "base64"));
    await evaluate("returnMenuButton.click()");
    assert.equal(await evaluate("document.body.classList.contains('mobile-play')"), false);
    assert.ok(await evaluate("document.querySelector('.ranking').getClientRects().length > 0 && document.querySelector('.account').getClientRects().length > 0"));
    await cdp("Emulation.clearDeviceMetricsOverride");
    // レビュー用のスクリーンショット。
    const screenshot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(root, ".local", "stage4-preview.png"), Buffer.from(screenshot.data, "base64"));
    console.log("Edge: default Leche, shared ranking with usernames, personal best, real 30-second game, queue retry and changed shared Cookie; no JavaScript exceptions.");
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
