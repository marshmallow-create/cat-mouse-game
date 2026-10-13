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
    setAttribute() {},
    classList: { add(name) { classes.add(name); }, toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
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
    riku: null, momo: null, momoPointsUntil: 0, momoStrawberryUntil: 0, startTime: 0, previousTime: 0, lastDirectionTime: 30000,
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
  vm.runInContext(`updateMomo(${now}, 0)`, context);
  Object.assign(context.momo, { x: 800, y: 100, dx: 0, dy: 0, lastDirectionTime: now });
  context.momoPointsUntil = 0;
  context.momoStrawberryUntil = 0;
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

function mouseGame() {
  const context = game();
  context.keys.clear();
  context.mice.splice(1);
  Object.assign(context.mice[0], { special: false, speedMultiplier: 1, points: 1 });
  vm.runInContext(`
    placeMouse = mouse => { mouse.x = 850; mouse.y = 450; mouse.dx = 0; mouse.dy = 0; };
    chooseMouseDirection = mouse => { mouse.dx = 0; mouse.dy = 0; };
  `, context);
  return context;
}

test("normal mice arrive every two seconds; special mice arrive at ten and five seconds remaining", () => {
  const context = mouseGame();
  for (const [elapsed, normal, special] of [
    [1999, 1, 0], [2000, 2, 0], [3999, 2, 0], [4000, 3, 0],
    [19999, 10, 0], [20000, 11, 1], [20001, 11, 1],
    [24999, 13, 1], [25000, 13, 2], [25001, 13, 2], [29999, 15, 2]
  ]) {
    context.previousTime = elapsed;
    vm.runInContext(`update(${elapsed})`, context);
    assert.equal(context.mice.filter(mouse => !mouse.special).length, normal, `normal mice at ${elapsed}ms`);
    assert.equal(context.mice.filter(mouse => mouse.special).length, special, `special mice at ${elapsed}ms`);
  }
  const specialMouse = context.mice.find(mouse => mouse.special);
  assert.equal(specialMouse.speedMultiplier, 3);
  assert.equal(specialMouse.points, 5);
  specialMouse.x = context.cat.x;
  specialMouse.y = context.cat.y;
  context.previousTime = 29999;
  vm.runInContext('update(29999)', context);
  assert.equal(context.score, 5);
  assert.equal(context.mice.filter(mouse => mouse.special).length, 2);
  vm.runInContext('resetMice()', context);
  assert.equal(context.mice.length, 1);
  assert.equal(context.mice[0].special, false);
});

test("a delayed frame adds both special mice without duplicates", () => {
  const context = mouseGame();
  context.previousTime = 26000;
  vm.runInContext('update(26000); update(26000)', context);
  assert.equal(context.mice.filter(mouse => !mouse.special).length, 14);
  assert.equal(context.mice.filter(mouse => mouse.special).length, 2);
});

test("Momo appears once with 15 seconds left, changes direction and bounces at scaled bounds", () => {
  for (const scale of [1, 0.6]) {
    const context = game("leche", scale);
    vm.runInContext("updateMomo(14999, 0)", context);
    assert.equal(context.momo, null);
    vm.runInContext("updateMomo(15000, 0)", context);
    const momo = context.momo;
    assert.equal(momo.element.src, "images/momo.png");
    assert.ok(Math.abs(Math.hypot(momo.dx, momo.dy) - 1) < 1e-12);
    Object.assign(momo, { x: 500, y: 250, dx: 1, dy: 0 });
    vm.runInContext("updateMomo(15020, 0.02)", context);
    assert.equal(context.momo, momo);
    assert.equal(momo.x, 500 + 3 * scale);
    vm.runInContext("updateMomo(15850, 0)", context);
    assert.equal(momo.lastDirectionTime, 15850);
    Object.assign(momo, { x: 900 - 36 * scale, y: 510 - 36 * scale, dx: 1, dy: 1 });
    vm.runInContext("updateMomo(15870, 0.05)", context);
    assert.equal(momo.x, 900 - 36 * scale);
    assert.equal(momo.y, 510 - 36 * scale);
    assert.equal(momo.dx, -1);
    assert.equal(momo.dy, -1);
  }
});

function momoGame(catType = "leche", scale = 1) {
  const context = game(catType, scale);
  context.keys.clear();
  vm.runInContext("updateRiku(15000, 0); updateMomo(15000, 0)", context);
  Object.assign(context.riku, { x: 800, y: 100, dx: 0, dy: 0 });
  Object.assign(context.momo, { x: 300, y: 250, dx: 0, dy: 0, touching: false });
  context.momoPointsUntil = context.momoStrawberryUntil = 0;
  return context;
}

function momoFrame(context, now) {
  context.previousTime = now - 20;
  context.riku.lastDirectionTime = context.momo.lastDirectionTime = now;
  vm.runInContext(`update(${now})`, context);
}

test("Leche doubles normal and special points for exactly three seconds; overlapping does not renew it", () => {
  for (const scale of [1, 0.6]) {
    const context = momoGame("leche", scale);
    const mouse = context.mice[0];
    Object.assign(mouse, { x: 300, y: 250, points: 1, speedMultiplier: 0 });
    momoFrame(context, 15020);
    assert.equal(context.momoPointsUntil, 18020);
    assert.equal(context.score, 2);
    assert.match(context.boostStatusElement.textContent, /ポイント2倍！ あと3秒/);
    Object.assign(mouse, { x: 300, y: 250, points: 5 });
    momoFrame(context, 18019);
    assert.equal(context.score, 12);
    assert.equal(context.momoPointsUntil, 18020);
    Object.assign(mouse, { x: 300, y: 250 });
    momoFrame(context, 18020);
    assert.equal(context.score, 17);
    assert.equal(context.boostStatusElement.hidden, true);
    context.momo.x = 800;
    vm.runInContext("updateMomo(18030, 0)", context);
    context.momo.x = 300;
    vm.runInContext("updateMomo(18040, 0)", context);
    assert.equal(context.momoPointsUntil, 21040);
  }
});

test("Latte adds one strawberry per contact and enhances only an active strawberry effect", () => {
  for (const scale of [1, 0.6]) {
    const context = momoGame("latte", scale);
    context.keys.add("d");
    momoFrame(context, 15020);
    assert.equal(context.strawberries.length, 1);
    assert.equal(context.spawnedStrawberryCount, 6);
    assert.equal(context.momoStrawberryUntil, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 0.02)) < 1e-10);
    context.cat.x = 300;
    context.boostUntil = 22000;
    momoFrame(context, 15040);
    assert.equal(context.strawberries.length, 1);
    assert.equal(context.momoStrawberryUntil, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 4 * 0.02)) < 1e-10);
    assert.match(context.boostStatusElement.textContent, /スピード4倍/);
    context.cat.x = 300;
    momoFrame(context, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 2.5 * 0.02)) < 1e-10);
    assert.equal(context.boostUntil, 22000);
    context.momo.x = 800;
    vm.runInContext("updateMomo(18030, 0)", context);
    context.momo.x = context.cat.x;
    vm.runInContext("updateMomo(18040, 0)", context);
    assert.equal(context.strawberries.length, 2);
    assert.equal(context.momoStrawberryUntil, 21040);
    context.keys.clear();
    Object.assign(context.strawberries[0], { x: context.cat.x, y: context.cat.y });
    momoFrame(context, 18050);
    assert.equal(context.strawberries.length, 1);
    assert.equal(context.boostUntil, 23050);
    assert.match(context.boostStatusElement.textContent, /スピード4倍/);
  }
});

test("Momo and both effects are removed on reset", () => {
  const context = momoGame();
  const image = context.momo.element;
  context.momoPointsUntil = context.momoStrawberryUntil = 18000;
  vm.runInContext("resetMomo()", context);
  assert.equal(image.removed, true);
  assert.equal(context.momo, null);
  assert.equal(context.momoPointsUntil, 0);
  assert.equal(context.momoStrawberryUntil, 0);
  assert.equal(context.boostStatusElement.hidden, true);
});

test("orientation pause preserves Momo effect durations and direction timer", () => {
  const context = momoGame("latte");
  Object.assign(context, {
    mobilePlay: true, rotateGuide: element(), countdownStartTime: 0,
    performance: { now: () => 16000 },
    matchMedia: () => ({ matches: true }), clearMovement() {}
  });
  vm.runInContext(source.slice(source.indexOf("function updateOrientationState("), source.indexOf("function applySession(")), context);
  context.momoPointsUntil = context.momoStrawberryUntil = 18000;
  vm.runInContext("updateOrientationState()", context);
  assert.equal(context.orientationPausedAt, 16000);
  context.performance.now = () => 21000;
  context.matchMedia = () => ({ matches: false });
  vm.runInContext("updateOrientationState()", context);
  assert.equal(context.momoPointsUntil, 23000);
  assert.equal(context.momoStrawberryUntil, 23000);
  assert.equal(context.momo.lastDirectionTime, 20000);
  assert.equal(context.startTime, 5000);
  assert.equal(context.orientationPausedAt, null);
});
