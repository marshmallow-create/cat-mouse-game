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

const GAME_LENGTH = 30; // 秒
const COUNTDOWN_LENGTH = 3000; // ミリ秒
const MOUSE_SPAWN_INTERVAL = 5000; // ミリ秒
const CAT_SPEED = 270; // 1秒に進むピクセル数
const MOUSE_SPEED = 115;
const CHARACTER_RADIUS = 27;
const CAT_RADIUS = 36;
const CATCH_DISTANCE = 48;
const DIRECTION_INTERVAL = 850; // ミリ秒

const keys = new Set();
const cat = { x: 0, y: 0 };
const mice = [{ element: mouseElement, x: 0, y: 0, dx: 0, dy: 0 }];
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
  element.src = "images/ネズミ.png";
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

      cat.x = clamp(cat.x + horizontal / length * CAT_SPEED * seconds, catArea.minX, catArea.maxX);
      cat.y = clamp(cat.y + vertical / length * CAT_SPEED * seconds, catArea.minY, catArea.maxY);

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
  draw();
});

startButton.addEventListener("click", beginCountdown);
restartButton.addEventListener("click", beginCountdown);
placeCharacters();
requestAnimationFrame(update);
