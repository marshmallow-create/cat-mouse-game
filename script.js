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
  element.textContent = "🍓";
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", "苺：5秒間スピード2倍");
  const area = bounds(STRAWBERRY_RADIUS);
  const strawberry = { element, x: 0, y: 0 };
  // ラテの真下に出現して即座に取得されるのを避ける。
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
    ? `🍓 スピード2倍！ あと${Math.ceil((boostUntil - now) / 1000)}秒`
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

function beginCountdown() {
  resetStrawberries();
  placeCharacters();
  score = 0;
  scoreElement.textContent = "0";
  timeElement.textContent = String(GAME_LENGTH);
  keys.clear();
  startScreenElement.hidden = true;
  gameOverElement.hidden = true;
  countdownNumberElement.textContent = "3";
  countdownScreenElement.hidden = false;
  playing = false;
  countingDown = true;
  countdownStartTime = performance.now();
}

function startGame(now) {
  countdownScreenElement.hidden = true;
  countingDown = false;
  playing = true;
  startTime = now;
  previousTime = now;
  lastDirectionTime = now;
}

function endGame() {
  playing = false;
  resetStrawberries();
  keys.clear();
  timeElement.textContent = "0";
  finalScoreElement.textContent = String(score);
  gameOverElement.hidden = false;
  restartButton.focus();
}

function update(now) {
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
      const horizontal = Number(keys.has("arrowright") || keys.has("d"))
        - Number(keys.has("arrowleft") || keys.has("a"));
      const vertical = Number(keys.has("arrowdown") || keys.has("s"))
        - Number(keys.has("arrowup") || keys.has("w"));
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
  if (movementKeys.has(key)) {
    event.preventDefault();
    if (playing) keys.add(key);
  }
});

window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

window.addEventListener("resize", () => {
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
});

startButton.addEventListener("click", beginCountdown);
restartButton.addEventListener("click", beginCountdown);
placeCharacters();
requestAnimationFrame(update);
