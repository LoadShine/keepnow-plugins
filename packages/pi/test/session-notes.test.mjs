import assert from "node:assert/strict";
import test from "node:test";
import keepnowExtension from "../dist/index.js";

test("persists note IDs in the Pi session and restricts reads and updates", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KEEPNOW_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KEEPNOW_API_KEY;
    else process.env.KEEPNOW_API_KEY = originalKey;
  });

  process.env.KEEPNOW_API_KEY = "test-key";
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    if (init.method === "POST") {
      return Response.json({ id: "note-1", title: "Authentication fix", webUrl: "https://keepnow.app/note-1" });
    }
    return Response.json({
      title: "Authentication fix",
      content: "Original body",
      webUrl: "https://keepnow.app/note-1",
    });
  };

  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const entries = [];
  const userMessages = [];
  const notifications = [];
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
    sendUserMessage(message) {
      userMessages.push(message);
    },
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
  };
  keepnowExtension(pi);

  const sessionContext = {
    sessionManager: { getBranch: () => entries },
  };
  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, sessionContext);

  const save = tools.get("keepnow_save");
  const saved = await save.execute(
    "save-1",
    {
      topic: "authentication",
      title: "Authentication fix",
      summary: "Fixed authentication.",
      keywords: "authentication, cookie",
      content: "Original body",
      tags: ["authentication"],
    },
    undefined,
    undefined,
    {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "pi-session-123" },
    },
  );
  assert.match(saved.content[0].text, /^✓ Saved/);
  assert.equal(requests[0].body.sourceMeta.cwd, process.cwd());
  assert.equal(requests[0].body.sourceMeta.sessionId, "pi-session-123");
  if (requests[0].body.sourceMeta.repo !== undefined) {
    assert.equal(typeof requests[0].body.sourceMeta.repo, "string");
  }
  if (requests[0].body.sourceMeta.branch !== undefined) {
    assert.equal(typeof requests[0].body.sourceMeta.branch, "string");
  }
  assert.deepEqual(entries, [
    {
      type: "custom",
      customType: "keepnow-note",
      data: { id: "note-1", topic: "authentication", title: "Authentication fix" },
    },
  ]);

  await handlers.get("session_start")({ type: "session_start", reason: "resume" }, sessionContext);

  await commands.get("keepnow").handler("summary", {
    ui: { notify(message) { notifications.push(message); } },
  });
  assert.match(userMessages.at(-1), /# Writing it up/);
  assert.match(userMessages.at(-1), /WRITE-UP DESCRIPTION: summary/);

  const get = tools.get("keepnow_get");
  const loaded = await get.execute("get-1", { noteId: "note-1" });
  assert.match(loaded.content[0].text, /Original body/);

  await commands.get("keepnow").handler("--open https://keepnow.app/my/notes/note-1", {
    ui: { notify(message) { notifications.push(message); } },
  });
  assert.match(userMessages.at(-1), /Original body/);

  await commands.get("keepnow").handler("--open https://keepnow.app/dashboard/notes/note-1", {
    ui: { notify(message) { notifications.push(message); } },
  });
  assert.match(notifications.at(-1), /doesn't contain a note ID/);

  const deniedRead = await get.execute("get-2", { noteId: "historical-note" });
  assert.match(deniedRead.content[0].text, /not created in this Pi session/);

  const deniedUpdate = await save.execute(
    "save-2",
    {
      noteId: "historical-note",
      topic: "authentication",
      title: "Wrong note",
      summary: "Should not update.",
      keywords: "authentication",
      content: "Replacement",
      tags: ["authentication"],
    },
    undefined,
    undefined,
    {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => "pi-session-123" },
    },
  );
  assert.match(deniedUpdate.content[0].text, /cannot be updated/);
  assert.equal(requests.length, 3, "denied operations must not reach the API");
});
