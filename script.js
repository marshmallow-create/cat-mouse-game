const field = document.getElementById("field");
const catElement = document.getElementById("cat");
const mouseElement = document.getElementById("mouse");
const scoreElement = document.getElementById("score");
const timeElement = document.getElementById("time");
const gameOverElement = document.getElementById("game-over");
const finalScoreElement = document.getElementById("final-score");
const restartButton = document.getElementById("restart");

const GAME_LENGTH = 30; // 秒
const CAT_SPEED = 270; // 1秒に進むピクセル数
const MOUSE_SPEED = 115;
const CHARACTER_RADIUS = 27;
const CATCH_DISTANCE = 43;
const DIRECTION_INTERVAL = 850; // ミリ秒

const keys = new Set();
const cat = { x: 0, y: 0 };
const mouse = { x: 0, y: 0, dx: 0, dy: 0 };
let score = 0;
let startTime = 0;
let previousTime = 0;
let lastDirectionTime = 0;
let playing = false;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function bounds() {
  return {
    minX: CHARACTER_RADIUS,
    maxX: Math.max(CHARACTER_RADIUS, field.clientWidth - CHARACTER_RADIUS),
    minY: CHARACTER_RADIUS,
    maxY: Math.max(CHARACTER_RADIUS, field.clientHeight - CHARACTER_RADIUS)
  };
}

function draw() {
  catElement.style.left = `${cat.x}px`;
  catElement.style.top = `${cat.y}px`;
  mouseElement.style.left = `${mouse.x}px`;
  mouseElement.style.top = `${mouse.y}px`;
}

function chooseMouseDirection() {
  const angle = Math.random() * Math.PI * 2;
  mouse.dx = Math.cos(angle);
  mouse.dy = Math.sin(angle);
}

function placeMouse() {
  const area = bounds();

  // できるだけ猫から離れた位置に出して、すぐ捕まるのを防ぐ。
  for (let attempt = 0; attempt < 30; attempt++) {
    mouse.x = area.minX + Math.random() * (area.maxX - area.minX);
    mouse.y = area.minY + Math.random() * (area.maxY - area.minY);
    if (Math.hypot(mouse.x - cat.x, mouse.y - cat.y) > 130) break;
  }
  chooseMouseDirection();
}

function startGame() {
  const area = bounds();
  cat.x = area.minX + (area.maxX - area.minX) * 0.23;
  cat.y = area.minY + (area.maxY - area.minY) * 0.5;
  score = 0;
  scoreElement.textContent = "0";
  timeElement.textContent = String(GAME_LENGTH);
  keys.clear();
  placeMouse();
  draw();
  gameOverElement.hidden = true;
  playing = true;
  startTime = performance.now();
  previousTime = startTime;
  lastDirectionTime = startTime;
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
  if (playing) {
    const remaining = Math.max(0, GAME_LENGTH - (now - startTime) / 1000);
    timeElement.textContent = String(Math.ceil(remaining));

    if (remaining === 0) {
      endGame();
    } else {
      // フレーム間の秒数を使うと、PCの描画速度が違っても同じ速さで動く。
      const seconds = Math.min((now - previousTime) / 1000, 0.05);
      const area = bounds();
      const horizontal = Number(keys.has("arrowright") || keys.has("d"))
        - Number(keys.has("arrowleft") || keys.has("a"));
      const vertical = Number(keys.has("arrowdown") || keys.has("s"))
        - Number(keys.has("arrowup") || keys.has("w"));
      const length = Math.hypot(horizontal, vertical) || 1;

      cat.x = clamp(cat.x + horizontal / length * CAT_SPEED * seconds, area.minX, area.maxX);
      cat.y = clamp(cat.y + vertical / length * CAT_SPEED * seconds, area.minY, area.maxY);

      if (now - lastDirectionTime >= DIRECTION_INTERVAL) {
        chooseMouseDirection();
        lastDirectionTime = now;
      }
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
        placeMouse();
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
  cat.x = clamp(cat.x, area.minX, area.maxX);
  cat.y = clamp(cat.y, area.minY, area.maxY);
  mouse.x = clamp(mouse.x, area.minX, area.maxX);
  mouse.y = clamp(mouse.y, area.minY, area.maxY);
  draw();
});

restartButton.addEventListener("click", startGame);
startGame();
requestAnimationFrame(update);
