const test = require("node:test");
const assert = require("node:assert/strict");
const { databaseConfig } = require("../scripts/database-config");

test("local mode takes priority over an inherited cloud URL", () => {
  const config = databaseConfig({ DATABASE_MODE: "local", DATABASE_URL: "postgresql://unused:unused@cloud.example/postgres" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.connectionString, undefined);
});

test("cloud connections require TLS certificate verification even with URL SSL options", () => {
  const config = databaseConfig({ DATABASE_MODE: "supabase", DATABASE_URL: "postgresql://test:test@cloud.example/postgres?sslmode=no-verify&application_name=cat-game" });
  assert.equal(config.ssl.rejectUnauthorized, true);
  const url = new URL(config.connectionString);
  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.get("application_name"), "cat-game");
});

test("explicit cloud mode fails rather than falling back to local data", () => {
  assert.throws(() => databaseConfig({ DATABASE_MODE: "supabase" }), /DATABASE_URL/);
  assert.throws(() => databaseConfig({ DATABASE_MODE: "unknown" }), /DATABASE_MODE/);
});

test("hosting can pass a CA certificate as an environment variable", () => {
  const config = databaseConfig({ DATABASE_MODE: "supabase", DATABASE_URL: "postgresql://test:test@cloud.example/postgres",
    DATABASE_SSL_CA: "certificate\\nsecond-line", DATABASE_SSL_CA_FILE: "does-not-exist" });
  assert.equal(config.ssl.ca, "certificate\nsecond-line");
  assert.equal(config.ssl.rejectUnauthorized, true);
});
