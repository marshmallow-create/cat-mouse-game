const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

test("playable cat, Riku and Momo images are served as PNG files", { timeout: 10000 }, async () => {
  const root = path.resolve(__dirname, "..");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const server = spawn(process.execPath, ["scripts/server.js"], {
    cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.resume();
  try {
    await Promise.race([
      once(server.stdout, "data"),
      once(server, "exit").then(() => { throw new Error("Server exited before startup"); })
    ]);
    server.stdout.resume();
    for (const cat of ["leche", "latte", "riku", "momo", "mouse-busaiku"]) {
      const response = await fetch(`http://127.0.0.1:${port}/images/${cat}.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      const content = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(content, await fs.readFile(path.join(root, "images", `${cat}.png`)));
      assert.deepEqual([...content.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  }
});
