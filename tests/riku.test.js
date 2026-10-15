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
    strawberries: [], spawnedStrawberryCount: 6, boostUntil: 0, stunUntil: 0,
    parents: [], extraGameSeconds: 0, riku: null, momo: null, momoPointsUntil: 0, momoStrawberryUntil: 0, startTime: 0, previousTime: 0, lastDirectionTime: 30000,
    playing: true, countingDown: false, orientationPausedAt: null, score: 0,
    currentUser: null, finalScoreElement: element(),
    gameOverElement: element(), restartButton: { focus() {} },
    updateAccountControls() {}, clearMovement() {},
    countdownScreenElement: element()
  });
  vm.runInContext(source.match(/const catTypes = \{[\s\S]*?\n\};/)[0], context);
  vm.runInContext(source.slice(source.indexOf("const GAME_LENGTH"), source.indexOf("const keys")), context);
  vm.runInContext(source.slice(source.indexOf("function clamp("), source.indexOf("const movementKeys")), context);
  vm.runInContext(`var playCat = catTypes.${catType};`, context);
  vm.runInContext(`
    const originalPlaceMouse = placeMouse;
    placeMouse = (actor, radius) => {
      originalPlaceMouse(actor, radius);
      if (actor.name) { actor.x = 850; actor.y = 100; actor.dx = 0; actor.dy = 0; }
    };
  `, context);
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

test("Riku appears once with 20 seconds remaining, changes direction and stays inside the field", () => {
  const context = game();
  vm.runInContext("updateRiku(9999, 0)", context);
  assert.equal(context.riku, null);
  vm.runInContext("updateRiku(10000, 0)", context);
  const riku = context.riku;
  assert.equal(riku.element.src, "images/riku.png");
  assert.ok(Math.abs(Math.hypot(riku.dx, riku.dy) - 1) < 1e-12);
  riku.x = 500; riku.y = 250; riku.dx = 1; riku.dy = 0;
  vm.runInContext("updateRiku(10020, 0.02)", context);
  assert.equal(context.riku, riku);
  assert.equal(riku.x, 503);
  vm.runInContext("updateRiku(10850, 0)", context);
  assert.equal(riku.lastDirectionTime, 10850);
  riku.x = 864; riku.y = 474; riku.dx = 1; riku.dy = 1;
  vm.runInContext("updateRiku(10870, 0.05)", context);
  assert.equal(riku.x, 864);
  assert.equal(riku.y, 474);
  assert.equal(riku.dx, -1);
  assert.equal(riku.dy, -1);
});

test("Riku deducts cat-specific points once per contact and cancels simultaneous Momo effects", () => {
  for (const [type, penalty] of [['leche', 3], ['latte', 1]]) {
    for (const scale of [1, 0.6]) {
      const context = game(type, scale);
      vm.runInContext('updateRiku(10000, 0); updateMomo(10000, 0)', context);
      Object.assign(context.riku, {x:300,y:250,dx:0,dy:0,lastDirectionTime:15020});
      Object.assign(context.momo, {x:300,y:250,dx:0,dy:0,lastDirectionTime:15020});
      context.score = 10;
      context.boostUntil = 22000;
      context.momoPointsUntil = context.momoStrawberryUntil = 18020;
      context.previousTime = 15000;
      vm.runInContext('update(15020)', context);
      assert.equal(context.score, 10 - penalty);
      assert.equal(context.scoreElement.textContent, String(10 - penalty));
      assert.equal(context.momoPointsUntil, 0);
      assert.equal(context.momoStrawberryUntil, 0);
      assert.equal(context.boostUntil, 22000);
      if (type === 'leche') {
        assert.equal(context.stunUntil, 0);
        assert.ok(Math.abs(context.cat.x - (300 + 270 * scale * 2 * 0.02)) < 1e-10);
      } else {
        assert.equal(context.stunUntil, 16020);
        assert.equal(context.cat.x, 300);
      }
      context.previousTime = 15020;
      vm.runInContext('update(15040)', context);
      assert.equal(context.score, 10 - penalty);
      context.riku.x = 800;
      vm.runInContext('updateRiku(15050, 0)', context);
      context.riku.x = context.cat.x;
      vm.runInContext('updateRiku(15060, 0)', context);
      assert.equal(context.score, 10 - penalty * 2);
    }
  }
});

test("Riku penalties keep scores nonnegative", () => {
  for (const type of ['leche', 'latte']) {
    for (const initial of [0, 1, 2]) {
      const context = game(type);
      vm.runInContext('updateRiku(10000, 0)', context);
      Object.assign(context.riku, {x:300,y:250,dx:0,dy:0});
      context.score = initial;
      vm.runInContext('updateRiku(10001, 0)', context);
      assert.equal(context.score, Math.max(0, initial - (type === 'leche' ? 3 : 1)));
    }
  }
});

test("Latte stops for one second and resumes normal strawberry speed after Momo is cancelled", () => {
  const context = game('latte');
  vm.runInContext('updateRiku(10000, 0)', context);
  Object.assign(context.riku, { x: 300, y: 250, dx: 1, dy: 0 });
  context.score = 10;
  context.boostUntil = 20000;
  context.momoStrawberryUntil = 18000;
  frame(context, 15020);
  assert.equal(context.stunUntil, 16020);
  assert.equal(context.cat.x, 300);
  assert.equal(context.riku.x, 303);
  assert.equal(context.catElement.classList.contains('stunned'), true);
  frame(context, 16019);
  assert.equal(context.cat.x, 300);
  assert.equal(context.stunUntil, 16020);
  frame(context, 16020);
  assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * 2.5 * 0.02)) < 1e-10);
  assert.equal(context.catElement.classList.contains('stunned'), false);
  assert.equal(context.score, 9);
});

test("Riku and contact effects reset for the next game", () => {
  const context = game();
  vm.runInContext("updateRiku(10000, 0)", context);
  const image = context.riku.element;
  context.stunUntil = 16000;
  vm.runInContext("resetRiku()", context);
  assert.equal(image.removed, true);
  assert.equal(context.riku, null);
  assert.equal(context.stunUntil, 0);
  assert.equal(context.catElement.classList.contains("stunned"), false);
  vm.runInContext("updateRiku(9999, 0)", context);
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

test("extended games cap normal mice at twenty while keeping special mice separate", () => {
  const context = mouseGame();
  context.extraGameSeconds = 100;
  for (const [elapsed, expected] of [[37999, 19], [38000, 20], [40000, 20], [125001, 20]]) {
    context.previousTime = elapsed;
    vm.runInContext(`update(${elapsed})`, context);
    assert.equal(context.mice.filter(mouse => !mouse.special).length, expected);
  }
  assert.equal(context.mice.filter(mouse => mouse.special).length, 2);
  vm.runInContext('resetMice()', context);
  assert.equal(context.mice.length, 1);
});

test("Momo appears once with 20 seconds left, changes direction and bounces at scaled bounds", () => {
  for (const scale of [1, 0.6]) {
    const context = game("leche", scale);
    vm.runInContext("updateMomo(9999, 0)", context);
    assert.equal(context.momo, null);
    vm.runInContext("updateMomo(10000, 0)", context);
    const momo = context.momo;
    assert.equal(momo.element.src, "images/momo.png");
    assert.ok(Math.abs(Math.hypot(momo.dx, momo.dy) - 1) < 1e-12);
    Object.assign(momo, { x: 500, y: 250, dx: 1, dy: 0 });
    vm.runInContext("updateMomo(10020, 0.02)", context);
    assert.equal(context.momo, momo);
    assert.equal(momo.x, 500 + 3 * scale);
    vm.runInContext("updateMomo(10850, 0)", context);
    assert.equal(momo.lastDirectionTime, 10850);
    Object.assign(momo, { x: 900 - 36 * scale, y: 510 - 36 * scale, dx: 1, dy: 1 });
    vm.runInContext("updateMomo(10870, 0.05)", context);
    assert.equal(momo.x, 900 - 36 * scale);
    assert.equal(momo.y, 510 - 36 * scale);
    assert.equal(momo.dx, -1);
    assert.equal(momo.dy, -1);
  }
});

function momoGame(catType = "leche", scale = 1) {
  const context = game(catType, scale);
  context.keys.clear();
  vm.runInContext("updateRiku(10000, 0); updateMomo(10000, 0)", context);
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

test("Latte contact adds no strawberry and enhances only an active strawberry effect", () => {
  for (const scale of [1, 0.6]) {
    const context = momoGame("latte", scale);
    context.keys.add("d");
    momoFrame(context, 15020);
    assert.equal(context.strawberries.length, 0);
    assert.equal(context.spawnedStrawberryCount, 6);
    assert.equal(context.momoStrawberryUntil, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 0.02)) < 1e-10);
    context.cat.x = 300;
    context.boostUntil = 22000;
    momoFrame(context, 15040);
    assert.equal(context.strawberries.length, 0);
    assert.equal(context.momoStrawberryUntil, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 5 * 0.02)) < 1e-10);
    assert.match(context.boostStatusElement.textContent, /スピード5倍/);
    context.cat.x = 300;
    momoFrame(context, 18020);
    assert.ok(Math.abs(context.cat.x - (300 + 270 * 1.2 * scale * 2.5 * 0.02)) < 1e-10);
    assert.equal(context.boostUntil, 22000);
    context.momo.x = 800;
    vm.runInContext("updateMomo(18030, 0)", context);
    context.momo.x = context.cat.x;
    vm.runInContext("updateMomo(18040, 0)", context);
    assert.equal(context.strawberries.length, 0);
    assert.equal(context.momoStrawberryUntil, 21040);
    context.keys.clear();
    vm.runInContext('addStrawberry()', context);
    Object.assign(context.strawberries[0], { x: context.cat.x, y: context.cat.y });
    momoFrame(context, 18050);
    assert.equal(context.strawberries.length, 0);
    assert.equal(context.boostUntil, 23050);
    assert.match(context.boostStatusElement.textContent, /スピード5倍/);
  }
});

test("Latte triples only normal mouse points for three seconds and renews on a new contact", () => {
  for (const scale of [1, 0.6]) {
    const context = momoGame('latte', scale);
    vm.runInContext('placeMouse = mouse => { mouse.x = 850; mouse.y = 450; mouse.dx = 0; mouse.dy = 0; }', context);
    const mouse = context.mice[0];
    Object.assign(mouse, { x: 300, y: 250, points: 1, special: false, speedMultiplier: 0 });
    momoFrame(context, 15020);
    assert.equal(context.momoPointsUntil, 18020);
    assert.equal(context.score, 3);
    assert.match(context.boostStatusElement.textContent, /通常ネズミの得点3倍/);
    Object.assign(mouse, { x: 300, y: 250, points: 5, special: true });
    momoFrame(context, 18019);
    assert.equal(context.score, 8);
    assert.equal(context.momoPointsUntil, 18020);
    Object.assign(mouse, { x: 300, y: 250, points: 1, special: false });
    momoFrame(context, 18020);
    assert.equal(context.score, 9);
    assert.doesNotMatch(context.boostStatusElement.textContent, /通常ネズミの得点3倍/);
    context.momo.x = 800;
    vm.runInContext('updateMomo(18030, 0)', context);
    context.momo.x = 300;
    vm.runInContext('updateMomo(18040, 0)', context);
    assert.equal(context.momoPointsUntil, 21040);
    assert.equal(context.strawberries.length, 0);
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
  vm.runInContext('updateParents(20000, 0, 10)', context);
  context.extraGameSeconds = 5;
  context.momoPointsUntil = context.momoStrawberryUntil = 18000;
  vm.runInContext("updateOrientationState()", context);
  assert.equal(context.orientationPausedAt, 16000);
  context.performance.now = () => 21000;
  context.matchMedia = () => ({ matches: false });
  vm.runInContext("updateOrientationState()", context);
  assert.equal(context.momoPointsUntil, 23000);
  assert.equal(context.momoStrawberryUntil, 23000);
  assert.equal(context.momo.lastDirectionTime, 15000);
  assert.equal(context.startTime, 5000);
  assert.equal(context.orientationPausedAt, null);
  assert.equal(context.extraGameSeconds, 5);
  assert.ok(context.parents.every(parent => parent.lastDirectionTime === 25000));
});

test("parents appear once at ten seconds left and use Leche's base speed at both scales", () => {
  for (const scale of [1, 0.6]) {
    const context = game('leche', scale);
    vm.runInContext('updateParents(19999, 0, 10.001)', context);
    assert.equal(context.parents.length, 0);
    vm.runInContext('updateParents(20000, 0, 10)', context);
    assert.equal(context.parents.length, 2);
    const [mama, papa] = context.parents;
    assert.equal(mama.element.src, 'images/mama.png');
    assert.equal(papa.element.src, 'images/papa.png');
    Object.assign(mama, { x: 500, y: 100, dx: 1, dy: 0 });
    Object.assign(papa, { x: 500, y: 400, dx: 1, dy: 0 });
    vm.runInContext('updateParents(20020, 0.02, 9.98)', context);
    assert.equal(mama.x, 500 + 270 * 0.5 * scale * 0.02);
    assert.equal(papa.x, 500 + 270 * 2 * scale * 0.02);
    assert.equal(context.parents.length, 2);
    vm.runInContext('updateParents(20850, 0, 9.15)', context);
    assert.equal(mama.lastDirectionTime, 20850);
    assert.equal(papa.lastDirectionTime, 20850);
    const maxX = 900 - 36 * scale, maxY = 510 - 36 * scale;
    for (const parent of context.parents) Object.assign(parent, {x:maxX,y:maxY,dx:1,dy:1});
    vm.runInContext('updateParents(20870, 0.05, 9.13)', context);
    for (const parent of context.parents) {
      assert.equal(parent.x, maxX); assert.equal(parent.y, maxY);
      assert.equal(parent.dx, -1); assert.equal(parent.dy, -1);
    }
  }
});

test("Mama extends time and gives exactly three cat-specific items per new contact", () => {
  for (const type of ['leche', 'latte']) {
    const context = game(type);
    context.keys.clear();
    vm.runInContext('updateParents(20000, 0, 10)', context);
    const mama = context.parents[0];
    Object.assign(mama, {x:300,y:250});
    vm.runInContext('updateParents(20001, 0, 9.999)', context);
    assert.equal(context.extraGameSeconds, 3);
    assert.equal(context.strawberries.length, 3);
    assert.ok(context.strawberries.every(item => item.element.textContent === (type === 'leche' ? '🐟' : '🍓')));
    assert.equal(context.spawnedStrawberryCount, 6);
    vm.runInContext('updateParents(20002, 0, 12.998)', context);
    assert.equal(context.extraGameSeconds, 3);
    assert.equal(context.strawberries.length, 3);
    mama.x = 850;
    vm.runInContext('updateParents(20003, 0, 12.997)', context);
    mama.x = 300;
    vm.runInContext('updateParents(20004, 0, 12.996)', context);
    assert.equal(context.extraGameSeconds, 6);
    assert.equal(context.strawberries.length, 6);
    assert.equal(context.parents.length, 2);
    mama.x = 850;
    context.previousTime = 30001;
    vm.runInContext('update(30001)', context);
    assert.equal(context.playing, true);
    assert.equal(context.timeElement.textContent, '6');
    const images = context.parents.map(parent => parent.element);
    context.previousTime = 36000;
    vm.runInContext('update(36000)', context);
    assert.equal(context.playing, false);
    assert.equal(context.parents.length, 0);
    assert.equal(context.extraGameSeconds, 0);
    assert.ok(images.every(image => image.removed));
  }
});

test("Papa ends immediately before Mama rewards or mouse scoring and preserves the result", () => {
  const context = game();
  context.keys.clear();
  context.score = 42;
  vm.runInContext('updateParents(20000, 0, 10)', context);
  for (const parent of context.parents) Object.assign(parent, {x:300,y:250});
  context.extraGameSeconds = 20;
  context.previousTime = 20001;
  Object.assign(context.mice[0], {x:300,y:250,points:5,speedMultiplier:0});
  vm.runInContext('update(20001)', context);
  assert.equal(context.playing, false);
  assert.equal(context.score, 42);
  assert.equal(context.finalScoreElement.textContent, '42');
  assert.equal(context.gameOverElement.hidden, false);
  assert.equal(context.timeElement.textContent, '0');
  assert.equal(context.parents.length, 0);
  assert.equal(context.strawberries.length, 0);
  vm.runInContext('update(20002)', context);
  assert.equal(context.score, 42);
});

test("starting another game resets parent characters and extra seconds", () => {
  const context = game();
  vm.runInContext('updateParents(20000, 0, 10)', context);
  context.extraGameSeconds = 5;
  vm.runInContext('startGame(21000)', context);
  assert.equal(context.parents.length, 0);
  assert.equal(context.extraGameSeconds, 0);
  assert.equal(context.startTime, 21000);
  vm.runInContext('updateParents(40999, 0, 10.001)', context);
  assert.equal(context.parents.length, 0);
});
