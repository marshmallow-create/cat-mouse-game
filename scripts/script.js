const field = document.getElementById("field");
const catElement = document.getElementById("cat");
const mouseElement = document.getElementById("mouse");
const scoreElement = document.getElementById("score");
const timeElement = document.getElementById("time");
const startScreenElement = document.getElementById("start-screen");
const startButton = document.getElementById("start");
const countdownScreenElement = document.getElementById("countdown-screen");
const countdownNumberElement = document.getElementById("countdown-number");
const gameOverElement = document.getElementById("game-over");
const finalScoreElement = document.getElementById("final-score");
const restartButton = document.getElementById("restart");
const boostStatusElement = document.getElementById("boost-status");
const rankingBodyElement = document.getElementById("ranking-body");
const rankingMessageElement = document.getElementById("ranking-message");
const saveStatusElement = document.getElementById("save-status");
const resultSaveMessageElement = document.getElementById("result-save-message");
const retrySaveButton = document.getElementById("retry-save");
const refreshRankingButton = document.getElementById("refresh-ranking");
const catSelectionElement = document.getElementById("cat-selection");
const catChoices = [...document.querySelectorAll('input[name="play-cat"]')];
const startCatElement = document.getElementById("start-cat");
const resultCatElement = document.getElementById("result-cat");
const catTypes = {
  latte: { name: "ラテ", image: "images/latte.png", item: "苺", emoji: "🍓" },
  leche: { name: "レチェ", image: "images/leche.png", item: "鰹節", emoji: "🐟" }
};
let selectedCat = "leche";
let playCat = catTypes[selectedCat];

function updateCatPreview() {
  const choice = catTypes[selectedCat];
  catElement.src = choice.image;
  catElement.alt = choice.name;
  startCatElement.src = choice.image;
}

for (const choice of catChoices) {
  choice.addEventListener("change", () => {
    if (!currentUser || authBusy || playing || countingDown || savingResults) return;
    selectedCat = choice.value;
    updateCatPreview();
  });
}

const GAME_LENGTH = 30; // 秒
const COUNTDOWN_LENGTH = 3000; // ミリ秒
const MOUSE_SPAWN_INTERVAL = 5000; // ミリ秒
const STRAWBERRY_SPAWN_INTERVAL = 5000;
const BOOST_DURATION = 5000;
const STRAWBERRY_RADIUS = 22;
const CAT_SPEED = 270; // 1秒に進むピクセル数
const MOUSE_SPEED = 115;
const CHARACTER_RADIUS = 27;
const CAT_RADIUS = 36;
const PICKUP_DISTANCE = CAT_RADIUS + STRAWBERRY_RADIUS;
const CATCH_DISTANCE = 48;
const DIRECTION_INTERVAL = 850; // ミリ秒

const keys = new Set();
const directionHeld = key => keys.has(key);
const touch = { pointerId: null, x: 0, y: 0, dx: 0, dy: 0 };
const touchOrigin = document.getElementById("touch-origin");
const touchStick = document.getElementById("touch-stick");
const rotateGuide = document.getElementById("rotate-guide");
const mobileControls = matchMedia("(pointer: coarse), (max-width: 680px)");
let mobilePlay = false;
let orientationPausedAt = null;
const cat = { x: 0, y: 0 };
const mice = [{ element: mouseElement, x: 0, y: 0, dx: 0, dy: 0 }];
const strawberries = [];
let spawnedStrawberryCount = 0;
let boostUntil = 0;
let score = 0;
let startTime = 0;
let previousTime = 0;
let lastDirectionTime = 0;
let playing = false;
let countingDown = false;
let countdownStartTime = 0;
let currentPlayId = null;
let lastSavedResultId = null;
let savingResults = false;
let rankingRequestNumber = 0;
let queueCanPersist = true;
let currentUser = null;
let csrfToken = null;
let playUserId = null;
let authBusy = false;
let authVersion = 0;
let pendingResults = [];
const accountForm = document.getElementById("account-form");
const accountMessage = document.getElementById("account-message");
const personalBestElement = document.getElementById("personal-best");
const logoutButton = document.getElementById("logout");
const storageKey = userId => `latte-game-pending-results-v2-user-${userId}`;

function updateAccountControls() {
  const busy = authBusy || playing || countingDown || savingResults;
  for (const element of document.querySelectorAll("[data-game-only]")) element.hidden = !currentUser;
  for (const input of accountForm.elements) input.disabled = busy;
  logoutButton.disabled = busy;
  catSelectionElement.hidden = !currentUser;
  catSelectionElement.disabled = busy || !currentUser;
  startButton.disabled = authBusy || savingResults || !currentUser;
  restartButton.disabled = authBusy || savingResults || !currentUser;
  const immersive = mobilePlay && (playing || countingDown);
  const changed = document.body.classList.contains("mobile-play") !== immersive;
  document.body.classList.toggle("mobile-play", immersive);
  updateOrientationState();
  if (changed) resizeCharacters();
}

function updateOrientationState() {
  const paused = mobilePlay && (playing || countingDown) && matchMedia("(orientation: portrait)").matches;
  rotateGuide.hidden = !paused;
  if (paused && orientationPausedAt === null) {
    orientationPausedAt = performance.now();
    clearMovement();
  } else if (!paused && orientationPausedAt !== null) {
    const now = performance.now();
    const duration = now - orientationPausedAt;
    countdownStartTime += duration;
    startTime += duration;
    lastDirectionTime += duration;
    if (boostUntil) boostUntil += duration;
    previousTime = now;
    orientationPausedAt = null;
  }
}

function applySession(data) {
  const changed = currentUser?.id !== data.user?.id;
  currentUser = data.user;
  csrfToken = data.csrfToken || null;
  if (changed) {
    authVersion++;
    rankingRequestNumber++;
    rankingBodyElement.replaceChildren();
    personalBestElement.textContent = "自己ベスト：読み込み中…";
    lastSavedResultId = null;
    queueCanPersist = true;
    pendingResults = currentUser ? restorePendingResults(currentUser.id) : [];
    resultSaveMessageElement.textContent = "";
    saveStatusElement.textContent = "";
  }
  accountForm.hidden = !!currentUser;
  document.getElementById("account-title").textContent = currentUser ? "利用者アカウント" : "ログイン";
  logoutButton.hidden = !currentUser;
  personalBestElement.hidden = !currentUser;
  accountMessage.textContent = currentUser ? `${currentUser.username} でログイン中です。` : "新規登録またはログインしてから遊んでください。";
  retrySaveButton.hidden = !pendingResults.length;
  updateAccountControls();
  if (changed && currentUser && !playing && !countingDown) placeCharacters();
}

async function checkSession() {
  if (authBusy || savingResults || playing || countingDown) return;
  authBusy = true;
  updateAccountControls();
  try {
    applySession(await requestApi("/api/auth/me"));
    await loadRankings();
  } catch (error) {
    accountMessage.textContent = `ログイン状態を確認できませんでした。${error.message}`;
    return;
  } finally {
    authBusy = false;
    updateAccountControls();
  }
  if (currentUser && pendingResults.length) await savePendingResults();
}

accountForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (authBusy || playing || countingDown || savingResults) return;
  authBusy = true;
  updateAccountControls();
  try {
    const data = await requestApi(event.submitter?.id === "register" ? "/api/auth/register" : "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: document.getElementById("username").value, password: document.getElementById("password").value })
    });
    document.getElementById("password").value = "";
    applySession(data);
    await loadRankings();
  } catch (error) { accountMessage.textContent = error.message; }
  finally { authBusy = false; updateAccountControls(); }
  if (currentUser) await savePendingResults();
});

logoutButton.addEventListener("click", async () => {
  if (authBusy || playing || countingDown || savingResults) return;
  authBusy = true;
  updateAccountControls();
  try {
    await requestApi("/api/auth/logout", { method: "POST", headers: { "X-CSRF-Token": csrfToken } });
    applySession({ user: null });
    rankingMessageElement.textContent = "ログインするとみんなのランキングが表示されます。";
  } catch (error) { accountMessage.textContent = error.message; }
  finally { authBusy = false; updateAccountControls(); }
});

// 未送信の結果だけをブラウザに一時保管します。ランキングの保存先はPostgreSQLです。
function restorePendingResults(userId) {
  try {
    const records = JSON.parse(localStorage.getItem(storageKey(userId)) || "[]");
    if (!Array.isArray(records)) return [];
    return records.filter(record => record && typeof record.playId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.playId)
      && Number.isInteger(record.score) && record.score >= 0 && record.score <= 2147483647)
      .map(record => ({ playId: record.playId, score: record.score }));
  } catch {
    queueCanPersist = false;
    return [];
  }
}

function persistPendingResults(userId = currentUser.id, records = pendingResults) {
  try {
    if (records.length) localStorage.setItem(storageKey(userId), JSON.stringify(records));
    else localStorage.removeItem(storageKey(userId));
  } catch { queueCanPersist = false; }
}

async function requestApi(url, options = {}) {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    throw new Error("http://localhost:3000 からゲームを開いてください。");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "記録の処理に失敗しました。"), { status: response.status });
    return data;
  } finally { clearTimeout(timeout); }
}

async function loadRankings() {
  const requestNumber = ++rankingRequestNumber;
  if (!currentUser) {
    rankingBodyElement.replaceChildren();
    rankingMessageElement.textContent = "ログインするとみんなのランキングが表示されます。";
    refreshRankingButton.disabled = false;
    return;
  }
  rankingMessageElement.textContent = "記録を読み込んでいます…";
  refreshRankingButton.disabled = true;
  try {
    const data = await requestApi("/api/rankings", { headers: { "X-Game-User": String(currentUser.id) } });
    if (requestNumber !== rankingRequestNumber) return;
    rankingBodyElement.replaceChildren();
    const formatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    data.results.forEach((result, index) => {
      const row = document.createElement("tr");
      if (result.id === lastSavedResultId) row.className = "current-result";
      const values = [`${index + 1}位`, result.username, `${result.score}匹`, formatter.format(new Date(result.played_at))];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      rankingBodyElement.appendChild(row);
    });
    personalBestElement.textContent = data.personalBest
      ? `自己ベスト：${data.personalBest.score}匹`
      : "自己ベスト：まだ記録がありません。";
    rankingMessageElement.textContent = data.results.length ? "" : "まだ記録がありません。最初の1回を遊んでみよう！";
  } catch (error) {
    if (requestNumber === rankingRequestNumber) {
      rankingBodyElement.replaceChildren();
      personalBestElement.textContent = "自己ベスト：取得できませんでした。「更新する」で再試行してください。";
      rankingMessageElement.textContent = `記録を読み込めませんでした。「更新する」で再試行できます。${error.message}`;
    }
  } finally {
    if (requestNumber === rankingRequestNumber) refreshRankingButton.disabled = false;
  }
}

async function savePendingResults() {
  if (savingResults || !pendingResults.length || !currentUser) return;
  const ownerId = currentUser.id;
  const version = authVersion;
  const records = pendingResults;
  const token = csrfToken;
  savingResults = true;
  updateAccountControls();
  retrySaveButton.hidden = false;
  retrySaveButton.disabled = true;
  saveStatusElement.textContent = "記録を保存しています…";
  let savedAny = false;
  try {
    while (records.length && version === authVersion) {
      const record = records[0];
      const data = await requestApi("/api/results", { method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token, "X-Game-User": String(ownerId) }, body: JSON.stringify(record) });
      records.shift();
      persistPendingResults(ownerId, records);
      savedAny = true;
      lastSavedResultId = data.result.id;
      if (record.playId === currentPlayId) resultSaveMessageElement.textContent = "記録を保存しました！";
    }
    saveStatusElement.textContent = "記録を保存しました。";
  } catch (error) {
    const reminder = queueCanPersist ? "未保存の記録を保持しています。" : "この画面を閉じずに再試行してください。";
    saveStatusElement.textContent = `未保存の記録が${pendingResults.length}件あります。${reminder} ${error.message}`;
    if (pendingResults.some(record => record.playId === currentPlayId)) {
      resultSaveMessageElement.textContent = "保存できませんでした。下の「保存を再試行する」を押してください。";
    }
  } finally {
    savingResults = false;
    updateAccountControls();
    retrySaveButton.disabled = false;
    retrySaveButton.hidden = pendingResults.length === 0;
    if (savedAny) await loadRankings();
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function bounds(radius = CHARACTER_RADIUS) {
  return {
    minX: radius,
    maxX: Math.max(radius, field.clientWidth - radius),
    minY: radius,
    maxY: Math.max(radius, field.clientHeight - radius)
  };
}

function draw() {
  catElement.style.left = `${cat.x}px`;
  catElement.style.top = `${cat.y}px`;
  for (const mouse of mice) {
    mouse.element.style.left = `${mouse.x}px`;
    mouse.element.style.top = `${mouse.y}px`;
  }
  for (const strawberry of strawberries) {
    strawberry.element.style.left = `${strawberry.x}px`;
    strawberry.element.style.top = `${strawberry.y}px`;
  }
}

function addStrawberry() {
  const element = document.createElement("span");
  element.className = "character strawberry";
  element.textContent = playCat.emoji;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `${playCat.item}：5秒間スピード2倍`);
  const area = bounds(STRAWBERRY_RADIUS);
  const strawberry = { element, x: 0, y: 0 };
  // 猫の真下に出現して即座に取得されるのを避ける。
  for (let attempt = 0; attempt < 30; attempt++) {
    strawberry.x = area.minX + Math.random() * (area.maxX - area.minX);
    strawberry.y = area.minY + Math.random() * (area.maxY - area.minY);
    if (Math.hypot(strawberry.x - cat.x, strawberry.y - cat.y) > PICKUP_DISTANCE + 20) break;
  }
  strawberries.push(strawberry);
  field.appendChild(element);
}

function updateBoostStatus(now) {
  const active = now < boostUntil;
  catElement.classList.toggle("boosted", active);
  boostStatusElement.hidden = !active;
  boostStatusElement.textContent = active
    ? `${playCat.emoji} スピード2倍！ あと${Math.ceil((boostUntil - now) / 1000)}秒`
    : "";
}

function resetStrawberries() {
  while (strawberries.length) strawberries.pop().element.remove();
  spawnedStrawberryCount = 0;
  boostUntil = 0;
  updateBoostStatus(0);
}

function chooseMouseDirection(mouse) {
  const angle = Math.random() * Math.PI * 2;
  mouse.dx = Math.cos(angle);
  mouse.dy = Math.sin(angle);
}

function placeMouse(mouse) {
  const area = bounds();

  // できるだけ猫から離れた位置に出して、すぐ捕まるのを防ぐ。
  for (let attempt = 0; attempt < 30; attempt++) {
    mouse.x = area.minX + Math.random() * (area.maxX - area.minX);
    mouse.y = area.minY + Math.random() * (area.maxY - area.minY);
    if (Math.hypot(mouse.x - cat.x, mouse.y - cat.y) > 130) break;
  }
  chooseMouseDirection(mouse);
}

function addMouse() {
  const element = document.createElement("img");
  element.className = "character mouse";
  element.src = "images/mouse.png";
  element.alt = "ネズミ";
  element.draggable = false;
  field.appendChild(element);

  const mouse = { element, x: 0, y: 0, dx: 0, dy: 0 };
  mice.push(mouse);
  placeMouse(mouse);
}

function resetMice() {
  // 再挑戦時は追加されたネズミを消し、最初の1匹に戻す。
  while (mice.length > 1) mice.pop().element.remove();
  placeMouse(mice[0]);
}

function placeCharacters() {
  const area = bounds(CAT_RADIUS);
  cat.x = area.minX + (area.maxX - area.minX) * 0.23;
  cat.y = area.minY + (area.maxY - area.minY) * 0.5;
  resetMice();
  draw();
}

async function beginCountdown() {
  if (playing || countingDown || authBusy || savingResults || !currentUser) return;
  authBusy = true;
  updateAccountControls();
  try {
    const previousUserId = currentUser.id;
    applySession(await requestApi("/api/auth/me"));
    if (previousUserId !== currentUser?.id) await loadRankings();
  }
  catch (error) { accountMessage.textContent = error.message; return; }
  finally { authBusy = false; updateAccountControls(); }
  if (!currentUser) return;
  playCat = catTypes[selectedCat];
  updateCatPreview();
  playUserId = currentUser.id;
  currentPlayId = crypto.randomUUID();
  resultSaveMessageElement.textContent = "";
  resetStrawberries();
  placeCharacters();
  score = 0;
  scoreElement.textContent = "0";
  timeElement.textContent = String(GAME_LENGTH);
  clearMovement();
  startScreenElement.hidden = true;
  gameOverElement.hidden = true;
  countdownNumberElement.textContent = "3";
  countdownScreenElement.hidden = false;
  playing = false;
  countingDown = true;
  mobilePlay = mobileControls.matches;
  countdownStartTime = performance.now();
  previousTime = countdownStartTime;
  updateAccountControls();
  placeCharacters();
}

function startGame(now) {
  countdownScreenElement.hidden = true;
  countingDown = false;
  playing = true;
  updateAccountControls();
  placeCharacters();
  startTime = now;
  previousTime = now;
  lastDirectionTime = now;
}

function endGame() {
  if (!playing) return;
  playing = false;
  resetStrawberries();
  clearMovement();
  timeElement.textContent = "0";
  finalScoreElement.textContent = String(score);
  resultCatElement.src = playCat.image;
  gameOverElement.hidden = false;
  updateAccountControls();
  restartButton.focus();
  // スコアをコピーしてから送信し、再挑戦のリセットに影響されないようにします。
  if (!currentUser || currentUser.id !== playUserId) return;
  pendingResults.push({ playId: currentPlayId, score });
  persistPendingResults(playUserId);
  resultSaveMessageElement.textContent = "記録を保存しています…";
  savePendingResults();
}

function update(now) {
  if (orientationPausedAt !== null) {
    previousTime = now;
    requestAnimationFrame(update);
    return;
  }
  if (countingDown) {
    const elapsed = now - countdownStartTime;
    if (elapsed >= COUNTDOWN_LENGTH) {
      startGame(now);
    } else {
      countdownNumberElement.textContent = String(3 - Math.floor(elapsed / 1000));
    }
  }

  if (playing) {
    const remaining = Math.max(0, GAME_LENGTH - (now - startTime) / 1000);
    timeElement.textContent = String(Math.ceil(remaining));

    if (remaining === 0) {
      endGame();
    } else {
      // フレーム間の秒数を使うと、PCの描画速度が違っても同じ速さで動く。
      const seconds = Math.min((now - previousTime) / 1000, 0.05);
      const area = bounds();
      const catArea = bounds(CAT_RADIUS);
      const horizontal = touch.pointerId !== null ? touch.dx : Number(directionHeld("arrowright") || keys.has("d"))
        - Number(directionHeld("arrowleft") || keys.has("a"));
      const vertical = touch.pointerId !== null ? touch.dy : Number(directionHeld("arrowdown") || keys.has("s"))
        - Number(directionHeld("arrowup") || keys.has("w"));
      const length = Math.hypot(horizontal, vertical) || 1;
      const catSpeed = CAT_SPEED * (now < boostUntil ? 2 : 1);

      cat.x = clamp(cat.x + horizontal / length * catSpeed * seconds, catArea.minX, catArea.maxX);
      cat.y = clamp(cat.y + vertical / length * catSpeed * seconds, catArea.minY, catArea.maxY);

      const targetStrawberryCount = Math.floor((now - startTime) / STRAWBERRY_SPAWN_INTERVAL);
      while (spawnedStrawberryCount < targetStrawberryCount) {
        addStrawberry();
        spawnedStrawberryCount++;
      }
      for (let index = strawberries.length - 1; index >= 0; index--) {
        const strawberry = strawberries[index];
        if (Math.hypot(cat.x - strawberry.x, cat.y - strawberry.y) < PICKUP_DISTANCE) {
          strawberry.element.remove();
          strawberries.splice(index, 1);
          // 効果は重ねず、最後に取得してから5秒間に更新する。
          boostUntil = now + BOOST_DURATION;
        }
      }
      updateBoostStatus(now);

      // 開始から5秒ごとにネズミを1匹追加する。
      const targetMouseCount = 1 + Math.floor((now - startTime) / MOUSE_SPAWN_INTERVAL);
      while (mice.length < targetMouseCount) addMouse();

      if (now - lastDirectionTime >= DIRECTION_INTERVAL) {
        for (const mouse of mice) chooseMouseDirection(mouse);
        lastDirectionTime = now;
      }
      for (const mouse of mice) {
        mouse.x += mouse.dx * MOUSE_SPEED * seconds;
        mouse.y += mouse.dy * MOUSE_SPEED * seconds;

        // 壁に当たったネズミは向きを変える。
        if (mouse.x < area.minX || mouse.x > area.maxX) mouse.dx *= -1;
        if (mouse.y < area.minY || mouse.y > area.maxY) mouse.dy *= -1;
        mouse.x = clamp(mouse.x, area.minX, area.maxX);
        mouse.y = clamp(mouse.y, area.minY, area.maxY);

        if (Math.hypot(cat.x - mouse.x, cat.y - mouse.y) < CATCH_DISTANCE) {
          score++;
          scoreElement.textContent = String(score);
          placeMouse(mouse);
        }
      }
      draw();
    }
  }

  previousTime = now;
  requestAnimationFrame(update);
}

const movementKeys = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]);

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (event.target.closest("input, textarea")) return;
  if (movementKeys.has(key)) {
    event.preventDefault();
    if (playing && orientationPausedAt === null) keys.add(key);
  }
});

window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
function clearMovement() {
  keys.clear();
  const pointerId = touch.pointerId;
  touch.pointerId = null;
  touch.dx = touch.dy = 0;
  touchOrigin.hidden = touchStick.hidden = true;
  if (pointerId !== null && field.hasPointerCapture(pointerId)) field.releasePointerCapture(pointerId);
}
window.addEventListener("blur", clearMovement);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearMovement(); });
field.addEventListener("pointerdown", event => {
  if (!playing || orientationPausedAt !== null || touch.pointerId !== null || event.button !== 0) return;
  event.preventDefault();
  touch.pointerId = event.pointerId;
  touch.x = event.clientX;
  touch.y = event.clientY;
  touch.dx = touch.dy = 0;
  field.setPointerCapture(event.pointerId);
  const rect = field.getBoundingClientRect();
  touchOrigin.style.left = touchStick.style.left = `${touch.x - rect.left - field.clientLeft}px`;
  touchOrigin.style.top = touchStick.style.top = `${touch.y - rect.top - field.clientTop}px`;
  touchOrigin.hidden = touchStick.hidden = false;
});
field.addEventListener("pointermove", event => {
  if (event.pointerId !== touch.pointerId) return;
  const dx = event.clientX - touch.x;
  const dy = event.clientY - touch.y;
  const length = Math.hypot(dx, dy);
  touch.dx = length > 8 ? dx / length : 0;
  touch.dy = length > 8 ? dy / length : 0;
  const scale = length ? Math.min(length, 36) / length : 0;
  const rect = field.getBoundingClientRect();
  touchStick.style.left = `${touch.x - rect.left - field.clientLeft + dx * scale}px`;
  touchStick.style.top = `${touch.y - rect.top - field.clientTop + dy * scale}px`;
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
  field.addEventListener(name, event => { if (event.pointerId === touch.pointerId) clearMovement(); });
}

function resizeCharacters() {
  const area = bounds();
  const catArea = bounds(CAT_RADIUS);
  cat.x = clamp(cat.x, catArea.minX, catArea.maxX);
  cat.y = clamp(cat.y, catArea.minY, catArea.maxY);
  for (const mouse of mice) {
    mouse.x = clamp(mouse.x, area.minX, area.maxX);
    mouse.y = clamp(mouse.y, area.minY, area.maxY);
  }
  const strawberryArea = bounds(STRAWBERRY_RADIUS);
  for (const strawberry of strawberries) {
    strawberry.x = clamp(strawberry.x, strawberryArea.minX, strawberryArea.maxX);
    strawberry.y = clamp(strawberry.y, strawberryArea.minY, strawberryArea.maxY);
  }
  draw();
}
window.addEventListener("resize", () => {
  clearMovement();
  updateOrientationState();
  resizeCharacters();
});

startButton.addEventListener("click", beginCountdown);
restartButton.addEventListener("click", beginCountdown);
refreshRankingButton.addEventListener("click", loadRankings);
retrySaveButton.addEventListener("click", savePendingResults);
updateCatPreview();
placeCharacters();
requestAnimationFrame(update);
checkSession();
