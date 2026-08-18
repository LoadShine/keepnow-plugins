import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createKeepNowClient,
  humanApiError,
  isApiKey,
  readApiKey,
  noteIdFromReference,
  writeApiKey,
} from "../src/index.ts";

test("extracts note IDs from current KeepNow URLs", () => {
  assert.equal(noteIdFromReference("note-1"), "note-1");
  assert.equal(noteIdFromReference("https://keepnow.app/my/notes/note-1"), "note-1");
  assert.equal(noteIdFromReference("https://keepnow.app/my/notes/note-1/edit"), "note-1");
  assert.equal(noteIdFromReference("https://keepnow.app/api/v1/notes/note-1"), "note-1");
  assert.equal(noteIdFromReference("https://keepnow.app/dashboard/notes/note-1"), undefined);
});

test("translates API errors with current product routes", () => {
  assert.match(humanApiError("https://keepnow.app", "invalid_key", undefined, 401), /\/my\/keys/);
  assert.match(humanApiError("https://keepnow.app", "quota_storage", undefined, 402), /\/my\./);
});

test("adds authentication and returns typed JSON", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-key");
    return Response.json({ ok: true });
  };

  const client = createKeepNowClient({ getApiKey: () => "test-key" });
  assert.deepEqual(await client.request("/api/v1/me"), {
    ok: true,
    data: { ok: true },
  });
});

test("stores a lowercase apikey in a private shared config", async (t) => {
  const homeDir = await mkdtemp(join(tmpdir(), "keepnow-core-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  const key = `kn-${"a".repeat(32)}`;
  const configFile = writeApiKey(key, homeDir);
  assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), {
    apikey: key,
  });
  assert.equal(readApiKey({ homeDir, env: {} }), key);
  assert.equal(
    readApiKey({ homeDir, env: { KEEPNOW_API_KEY: "environment-key" } }),
    "environment-key",
  );
  assert.equal(isApiKey(key), true);
  assert.equal(isApiKey(`kn_live_${"a".repeat(32)}`), false);
  assert.throws(() => writeApiKey("test-key", homeDir), /must be kn-/);
});
