import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const packageDir = path.resolve(import.meta.dirname, "..");
const repositoryDir = path.resolve(packageDir, "../..");
const serverFile = path.join(packageDir, "dist/server.js");
const hookFile = path.join(packageDir, "dist/hook.js");

function cleanEnvironment(overrides) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      ([, value]) => value !== undefined,
    ),
  );
}

function runHook(input, env) {
  return spawnSync(process.execPath, [hookFile], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env,
  });
}

function runHookAsync(input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookFile], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function text(result) {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    cwd: packageDir,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "keepnow-codex-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

test("marketplace names make keepnow@keepnow-plugins unambiguous", async () => {
  const marketplace = JSON.parse(
    await readFile(
      path.join(repositoryDir, ".agents/plugins/marketplace.json"),
      "utf8",
    ),
  );
  assert.equal(marketplace.name, "keepnow-plugins");
  assert.equal(marketplace.plugins[0].name, "keepnow");
  assert.equal(marketplace.plugins[0].source.path, "./packages/codex");

  const manifest = JSON.parse(
    await readFile(path.join(packageDir, ".codex-plugin/plugin.json"), "utf8"),
  );
  assert.equal(manifest.name, "keepnow");
  assert.equal(manifest.repository, "https://github.com/loadshine/keepnow-plugins");
});

test("UserPromptSubmit stores apikey and handles help before the model", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "keepnow-codex-hook-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const env = cleanEnvironment({ HOME: homeDir, KEEPNOW_API_KEY: undefined });
  const apiKey = `kn-${"a".repeat(32)}`;

  const saved = runHook(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: `$keepnow --apikey ${apiKey}`,
    },
    env,
  );
  assert.equal(saved.status, 0, saved.stderr);
  const savedDecision = JSON.parse(saved.stdout);
  assert.equal(savedDecision.decision, "block");
  assert.doesNotMatch(saved.stdout, new RegExp(apiKey));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(homeDir, ".keepnow/config.json"), "utf8")),
    { apikey: apiKey },
  );

  const help = runHook(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "$keepnow",
    },
    env,
  );
  assert.equal(help.status, 0, help.stderr);
  assert.match(JSON.parse(help.stdout).reason, /\$keepnow --find/);

  const description = runHook(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-1",
      prompt: "$keepnow all important findings",
    },
    env,
  );
  assert.equal(description.stdout, "");
});

test("PreToolUse injects the real Codex session and cwd", () => {
  const result = runHook(
    {
      hook_event_name: "PreToolUse",
      session_id: "codex-session-1",
      cwd: "/tmp/example-project",
      tool_name: "mcp__plugin_keepnow_keepnow__keepnow_save",
      tool_input: { title: "Example" },
    },
    cleanEnvironment({}),
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(output.permissionDecision, "allow");
  assert.deepEqual(output.updatedInput, {
    title: "Example",
    sessionId: "codex-session-1",
    sessionCwd: "/tmp/example-project",
  });
});

test("search hook performs HTTP directly and saves its numbered listing", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "keepnow-codex-find-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(path.join(homeDir, ".keepnow"), { recursive: true });
  await writeFile(
    path.join(homeDir, ".keepnow/config.json"),
    `${JSON.stringify({ apikey: "test-key" })}\n`,
  );
  const note = {
    id: "note-1",
    slug: "auth-fix",
    title: "Authentication fix",
    summary: "Fixed the session cookie.",
    createdAt: "2026-08-18T00:00:00.000Z",
    webUrl: "https://keepnow.app/my/notes/note-1",
  };
  const apiServer = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer test-key");
    assert.equal(request.url, "/api/v1/notes?q=authentication");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ items: [note], total: 1 }));
  });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => apiServer.close(resolve)));
  const address = apiServer.address();
  const result = await runHookAsync(
    {
      hook_event_name: "UserPromptSubmit",
      session_id: "session-find",
      prompt: "$keepnow --find authentication",
    },
    cleanEnvironment({
      HOME: homeDir,
      KEEPNOW_API_KEY: undefined,
      KEEPNOW_API_URL: `http://127.0.0.1:${address.port}`,
    }),
  );
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /Authentication fix/);

  const sessionFiles = await import("node:fs/promises").then(({ readdir }) =>
    readdir(path.join(homeDir, ".keepnow/codex-sessions")),
  );
  assert.equal(sessionFiles.length, 1);
  const state = JSON.parse(
    await readFile(
      path.join(homeDir, ".keepnow/codex-sessions", sessionFiles[0]),
      "utf8",
    ),
  );
  assert.equal(state.lastListing[0].id, "note-1");
});

test("MCP rejects missing hook context and persists same-session notes", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "keepnow-codex-mcp-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(path.join(homeDir, ".keepnow"), { recursive: true });
  await writeFile(
    path.join(homeDir, ".keepnow/config.json"),
    `${JSON.stringify({ apikey: "test-key" })}\n`,
  );
  const note = {
    id: "note-1",
    title: "Codex plugin design",
    summary: "Codex plugin architecture.",
    content: "Original body",
    webUrl: "https://keepnow.app/my/notes/note-1",
  };
  const apiServer = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/notes" && request.method === "POST") {
      response.statusCode = 201;
      response.end(JSON.stringify(note));
      return;
    }
    if (request.url === "/api/v1/notes/note-1") {
      response.end(JSON.stringify(note));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found" }));
  });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => apiServer.close(resolve)));
  const address = apiServer.address();
  const connection = await connect(
    cleanEnvironment({
      HOME: homeDir,
      KEEPNOW_API_KEY: undefined,
      KEEPNOW_API_URL: `http://127.0.0.1:${address.port}`,
    }),
  );
  t.after(() => connection.transport.close().catch(() => {}));

  const missing = await connection.client.callTool({
    name: "keepnow_session_notes",
    arguments: {},
  });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /trust the KeepNow hooks/i);

  const saved = await connection.client.callTool({
    name: "keepnow_save",
    arguments: {
      sessionId: "session-1",
      sessionCwd: repositoryDir,
      topic: "codex plugin",
      title: note.title,
      summary: note.summary,
      keywords: "codex, plugin",
      content: note.content,
      tags: ["codex"],
    },
  });
  assert.match(text(saved), /^✓ Saved/);

  const listed = await connection.client.callTool({
    name: "keepnow_session_notes",
    arguments: { sessionId: "session-1" },
  });
  assert.match(text(listed), /note-1.*codex plugin/);

  const denied = await connection.client.callTool({
    name: "keepnow_get",
    arguments: { sessionId: "other-session", noteId: "note-1" },
  });
  assert.equal(denied.isError, true);
  assert.match(text(denied), /not created in this Codex session/);
});
