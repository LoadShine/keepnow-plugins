import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const hookFile = path.join(packageDir, "dist/apikey-hook.js");

function text(result) {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function cleanEnvironment(overrides) {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(([, value]) => value !== undefined),
  );
}

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverFile],
    cwd: packageDir,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "keepnow-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

test("marketplace names make keepnow@keepnow-plugins unambiguous", async () => {
  const marketplace = JSON.parse(
    await readFile(
      path.join(repositoryDir, ".claude-plugin/marketplace.json"),
      "utf8",
    ),
  );
  assert.equal(marketplace.name, "keepnow-plugins");
  assert.equal(marketplace.plugins[0].name, "keepnow");
  assert.equal(marketplace.plugins[0].source.package, "keepnow-claude-code");
});

test("API-key hook stores apikey and blocks the key before model expansion", async (t) => {
  const homeDir = await mkdtemp(path.join(tmpdir(), "keepnow-hook-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const apiKey = `kn-${"a".repeat(32)}`;

  const input = JSON.stringify({
    hook_event_name: "UserPromptExpansion",
    command_name: "keepnow:keepnow",
    command_args: `--apikey ${apiKey}`,
  });
  const result = spawnSync(process.execPath, [hookFile], {
    input,
    encoding: "utf8",
    env: cleanEnvironment({ HOME: homeDir, KEEPNOW_API_KEY: undefined }),
  });
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.decision, "block");
  assert.doesNotMatch(result.stdout, new RegExp(apiKey));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(homeDir, ".keepnow/config.json"), "utf8")),
    { apikey: apiKey },
  );

  const ignored = spawnSync(process.execPath, [hookFile], {
    input: JSON.stringify({
      hook_event_name: "UserPromptExpansion",
      command_name: "keepnow:keepnow",
      command_args: "--status",
    }),
    encoding: "utf8",
    env: cleanEnvironment({ HOME: homeDir, KEEPNOW_API_KEY: undefined }),
  });
  assert.equal(ignored.stdout, "");
});

test("MCP tools persist session notes and restrict update reads to that session", async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "keepnow-claude-"));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  await mkdir(path.join(tempDir, ".keepnow"), { recursive: true });
  await writeFile(
    path.join(tempDir, ".keepnow/config.json"),
    `${JSON.stringify({ apikey: "test-key" })}\n`,
  );

  const requests = [];
  const note = {
    id: "note-1",
    slug: "authentication-fix-1234",
    title: "Authentication fix",
    summary: "Fixed the authentication cookie.",
    createdAt: "2026-08-18T00:00:00.000Z",
    webUrl: "https://keepnow.app/my/notes/note-1",
    content: "Original body",
  };
  const apiServer = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push({ pathname: url.pathname, search: url.search, method: request.method });
    assert.equal(request.headers.authorization, "Bearer test-key");
    response.setHeader("content-type", "application/json");

    if (url.pathname === "/api/v1/me") {
      response.end(JSON.stringify({
        email: "person@example.com",
        plan: "free",
        usage: { notes: 1, bytesStored: 1024 },
        limits: { maxNotes: 100, maxBytes: 10485760 },
      }));
      return;
    }
    if (url.pathname === "/api/v1/notes" && request.method === "POST") {
      response.statusCode = 201;
      response.end(JSON.stringify(note));
      return;
    }
    if (url.pathname === "/api/v1/notes/note-1" && request.method === "PATCH") {
      response.end(JSON.stringify(note));
      return;
    }
    if (url.pathname === "/api/v1/notes/note-1") {
      response.end(JSON.stringify(note));
      return;
    }
    if (url.pathname === "/api/v1/notes") {
      response.end(JSON.stringify({ items: [note], total: 1 }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found" }));
  });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => apiServer.close(resolve)));
  const address = apiServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const env = cleanEnvironment({
    HOME: tempDir,
    KEEPNOW_API_KEY: undefined,
    KEEPNOW_API_URL: baseUrl,
    KEEPNOW_SESSION_DIR: path.join(tempDir, "sessions"),
    KEEPNOW_PROJECT_DIR: packageDir,
  });

  let connection = await connect(env);
  t.after(async () => {
    await connection.transport.close().catch(() => {});
  });

  const tools = await connection.client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "keepnow_find",
      "keepnow_get",
      "keepnow_open",
      "keepnow_recent",
      "keepnow_save",
      "keepnow_session_notes",
      "keepnow_status",
    ],
  );

  const empty = await connection.client.callTool({
    name: "keepnow_session_notes",
    arguments: { sessionId: "session-1" },
  });
  assert.equal(text(empty), "(none yet)");

  const saved = await connection.client.callTool({
    name: "keepnow_save",
    arguments: {
      sessionId: "session-1",
      topic: "authentication",
      title: note.title,
      summary: note.summary,
      keywords: "authentication, cookie",
      content: note.content,
      tags: ["authentication"],
    },
  });
  assert.match(text(saved), /^✓ Saved/);

  const deniedRequestCount = requests.length;
  const denied = await connection.client.callTool({
    name: "keepnow_get",
    arguments: { sessionId: "session-1", noteId: "other-note" },
  });
  assert.equal(denied.isError, true);
  assert.match(text(denied), /not created in this Claude Code session/);
  assert.equal(requests.length, deniedRequestCount);

  await connection.transport.close();
  connection = await connect(env);

  const restored = await connection.client.callTool({
    name: "keepnow_session_notes",
    arguments: { sessionId: "session-1" },
  });
  assert.match(text(restored), /note-1.*authentication/);

  const loaded = await connection.client.callTool({
    name: "keepnow_get",
    arguments: { sessionId: "session-1", noteId: "note-1" },
  });
  assert.match(text(loaded), /Original body/);

  const found = await connection.client.callTool({
    name: "keepnow_find",
    arguments: { sessionId: "session-1", description: "authentication" },
  });
  assert.match(text(found), /Authentication fix/);
  assert.match(text(found), /not note bodies/);

  const opened = await connection.client.callTool({
    name: "keepnow_open",
    arguments: { sessionId: "session-1", reference: "1" },
  });
  assert.match(text(opened), /^Loaded "Authentication fix" into context/);
  assert.match(text(opened), /Original body/);

  const status = await connection.client.callTool({
    name: "keepnow_status",
    arguments: { sessionId: "session-1" },
  });
  assert.match(text(status), /person@example.com · free/);
  assert.match(text(status), /this session: authentication/);

  const badUrl = await connection.client.callTool({
    name: "keepnow_open",
    arguments: {
      sessionId: "session-1",
      reference: "https://keepnow.app/dashboard/notes/note-1",
    },
  });
  assert.equal(badUrl.isError, true);
  assert.match(text(badUrl), /doesn't contain a note ID/);
});
