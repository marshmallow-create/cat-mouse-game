const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../scripts/script.js"), "utf8");

function element() {
  const classes = new Set();
  return {
    style: { setProperty() {} }, hidden: true, removed: false,
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    remove() { this.removed = true; }
  };
}

function game(catType = "leche", scale = 1) {
  const context = vm.createContext({
    field: { clientWidth: 900, clientHeight: 510, style: { setProperty() {} }, appendChild() {} },
    document: { createElement: element }, catElement: element(), boostStatusElement: element(),
    timeElement: element(), scoreElement: element(), mobileControls: { matches: false },
    requestAnimationFrame() {}, characterScale: scale,
    cat: { x: 300, y: 250 }, touch: { pointerId: null }, keys: new Set(["d"]),
    directionHeld() { return false; },
    mice: Array.from({ length: 10 }, () => ({ element: element(), x: 850, y: 450, dx: 0, dy: 0 })),
    strawberries: [], spawnedStrawberryCount: 6, boostUntil: 0, rikuBoostUntil: 0, stunUntil: 0,
    riku: null, startTime: 0, previousTime: 0, lastDirectionTime: 30000,
    playing: true, countingDown: false, orientationPausedAt: null, score: 0
  });
  vm.runInContext(source.match(/const catTypes = \{[\s\S]*?\n\};/)[0], context);
  vm.runInContext(source.slice(source.indexOf("const GAME_LENGTH"), source.indexOf("const keys")), context);
  vm.runInContext(source.slice(source.indexOf("function clamp("), source.indexOf("const movementKeys")), context);
  vm.runInContext(`var playCat = catTypes.${catType};`, context);
  return context;
}

function frame(context, now) {
  context.previousTime = now - 20;
  context.riku.lastDirectionTime = now;
  vm.runInContext(`update(${now})`, context);
}

test("Riku appears once at 15 seconds, changes direction and stays inside the field", () => {
  const context = game();
  vm.runInContext("updateRiku(14999, 0)", context);
  assert.equal(context.riku, null);
  vm.runInContext("updateRiku(15000, 0)", context);
  const riku = context.riku;
  assert.equal(riku.element.src, "images/riku.png");
  assert.ok(Math.abs(Math.hypot(riku.dx, riku.dy) - 1) < 1e-12);
  riku.x = 500; riku.y = 250; riku.dx = 1; riku.dy = 0;
  vm.runInContext("updateRiku(15020, 0.02)", context);
  assert.equal(context.riku, riku);
  assert.equal(riku.x, 503);
  vm.runInContext("updateRiku(15850, 0)", context);
  assert.equal(riku.lastDirectionTime, 15850);
  riku.x = 864; riku.y = 474; riku.dx = 1; riku.dy = 1;
  vm.runInContext("updateRiku(15870, 0.05)", context);
  assert.equal(riku.x, 864);
  assert.equal(riku.y, 474);
  assert.equal(riku.dx, -1);
  assert.equal(riku.dy, -1);
});

test("Leche gets exactly one second of triple speed, without extending contact or shortening item boosts", () => {
  for (const scale of [1, 0.6]) {
    const context = game("leche", scale);
    vm.runInContext("updateRiku(15000, 0)", context);
    Object.assign(context.riku, { x: 300, y: 250, dx: 0, dy: 0 });
    frame(context, 15020);
    assert.equal(context.rikuBoostUntil, 16020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * scale * 3 * 0.02)) < 1e-10);
    assert.match(context.boostStatusElement.textContent, /リク： スピード3倍！ あと1秒/);
    assert.equal(context.catElement.classList.contains("boosted"), true);
    context.cat.x = 300;
    frame(context, 16020);
    assert.equal(context.rikuBoostUntil, 16020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * scale * 0.02)) < 1e-10);
    assert.equal(context.catElement.classList.contains("boosted"), false);
    context.boostUntil = 22000;
    context.riku.x = 700;
    vm.runInContext("updateRiku(16030, 0)", context);
    context.riku.x = context.cat.x;
    const beforeContact = context.cat.x;
    frame(context, 16040);
    assert.equal(context.rikuBoostUntil, 17040);
    assert.equal(context.boostUntil, 22000);
    assert.ok(Math.abs(context.cat.x - (beforeContact + 270 * scale * 3 * 0.02)) < 1e-10);
    assert.match(context.boostStatusElement.textContent, /リク： スピード3倍！ あと1秒/);
    const beforeExpiry = context.cat.x;
    frame(context, 17040);
    assert.ok(Math.abs(context.cat.x - (beforeExpiry + 270 * scale * 2 * 0.02)) < 1e-10);
    assert.match(context.boostStatusElement.textContent, /🐟 スピード2倍！ あと5秒/);
  }
});

test("Latte stops for one second and resumes held input; Riku moves during the stun", () => {
  const context = game("latte");
  vm.runInContext("updateRiku(15000, 0)", context);
  Object.assign(context.riku, { x: 300, y: 250, dx: 1, dy: 0 });
  context.boostUntil = 20000;
  frame(context, 15020);
  assert.equal(context.stunUntil, 16020);
  assert.equal(context.cat.x, 300);
  assert.equal(context.riku.x, 303);
  assert.equal(context.catElement.classList.contains("stunned"), true);
  frame(context, 16019);
  assert.equal(context.cat.x, 300);
  assert.equal(context.stunUntil, 16020);
  frame(context, 16020);
  assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * 2.5 * 0.02)) < 1e-10);
  assert.match(context.boostStatusElement.textContent, /🍓 スピード2\.5倍！/);
  assert.equal(context.catElement.classList.contains("stunned"), false);
  assert.equal(context.rikuBoostUntil, 0);
});

test("Riku and contact effects reset for the next game", () => {
  const context = game();
  vm.runInContext("updateRiku(15000, 0)", context);
  const image = context.riku.element;
  context.rikuBoostUntil = 16000;
  context.stunUntil = 16000;
  vm.runInContext("resetRiku()", context);
  assert.equal(image.removed, true);
  assert.equal(context.riku, null);
  assert.equal(context.rikuBoostUntil, 0);
  assert.equal(context.stunUntil, 0);
  assert.equal(context.catElement.classList.contains("stunned"), false);
  vm.runInContext("updateRiku(14999, 0)", context);
  assert.equal(context.riku, null);
});
