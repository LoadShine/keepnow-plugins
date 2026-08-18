import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as os from "node:os";
import * as path from "node:path";
import * as z from "zod/v4";
import {
  createKeepNowClient,
  DEFAULT_BASE_URL,
  noteIdFromReference,
  readApiKey,
  SessionStore,
  sourceMeta,
  type NoteBody,
  type NoteSummary,
  type SavedNote,
} from "@keepnow/plugin-core";

const injectedSessionId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe("Injected by the KeepNow Codex hook. Do not invent this value.");
const injectedSessionCwd = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe("Injected by the KeepNow Codex hook. Do not invent this value.");
const sessionFields = {
  sessionId: injectedSessionId,
  sessionCwd: injectedSessionCwd,
};

const store = new SessionStore(
  process.env.KEEPNOW_SESSION_DIR ||
    path.join(os.homedir(), ".keepnow", "codex-sessions"),
);
const client = createKeepNowClient({
  getApiKey: () => readApiKey(),
  getBaseUrl: () => process.env.KEEPNOW_API_URL || DEFAULT_BASE_URL,
  missingApiKeyMessage: (url) =>
    `KeepNow isn't connected. Get a key at ${url}/my/install, then run $keepnow --apikey <key>.`,
});

const server = new McpServer({ name: "keepnow", version: "0.1.0" });
const resultText = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

function requireSession(sessionId: string | undefined): string | undefined {
  return sessionId?.trim() || undefined;
}

function missingSessionResult() {
  return resultText(
    "KeepNow could not identify this Codex session. Trust the KeepNow hooks in /hooks, then retry.",
    true,
  );
}

function formatListing(items: NoteSummary[]): string {
  if (items.length === 0) return "No matching notes.";
  return items
    .flatMap((note, index) => [
      `${String(index + 1).padStart(2)}. ${note.title}  ·  ${note.createdAt.slice(0, 10)}`,
      ...(note.summary ? [`    ${note.summary}`] : []),
    ])
    .join("\n");
}

server.registerTool(
  "keepnow_session_notes",
  {
    title: "KeepNow session notes",
    description:
      "List notes created through KeepNow in this Codex session. Call this before deciding whether a write-up updates an existing note.",
    inputSchema: sessionFields,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const notes = store.read(currentSession).notes;
    return resultText(
      notes.length
        ? notes
            .map(
              (note) =>
                `- id: ${note.id} · topic: ${note.topic} · title: ${note.title}`,
            )
            .join("\n")
        : "(none yet)",
    );
  },
);

server.registerTool(
  "keepnow_get",
  {
    title: "Read a same-session KeepNow note",
    description:
      "Read a note created in this Codex session before updating it. Notes outside the session are rejected.",
    inputSchema: {
      ...sessionFields,
      noteId: z.string().trim().min(1).describe("ID returned by keepnow_session_notes."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId, noteId }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    if (!store.owns(currentSession, noteId)) {
      return resultText(
        "That note was not created in this Codex session, so it cannot be read for an update.",
        true,
      );
    }
    const response = await client.request<NoteBody>(
      `/api/v1/notes/${encodeURIComponent(noteId)}`,
    );
    if (!response.ok) return resultText(response.message, true);
    return resultText([`# ${response.data.title}`, "", response.data.content].join("\n"));
  },
);

server.registerTool(
  "keepnow_save",
  {
    title: "Save a KeepNow note",
    description:
      "Create a KeepNow note, or update a note created in this Codex session. Show the complete write-up before calling this tool.",
    inputSchema: {
      ...sessionFields,
      noteId: z.string().trim().min(1).optional().describe("Same-session note ID to update."),
      topic: z.string().trim().min(1).max(200),
      title: z.string().trim().min(1).max(200),
      summary: z.string().trim().min(1).max(1000),
      keywords: z.string().trim().min(1).max(500),
      content: z.string().min(1),
      tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async ({
    sessionId,
    sessionCwd,
    noteId,
    topic,
    title,
    summary,
    keywords,
    content,
    tags,
  }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const isUpdate = Boolean(noteId);
    if (noteId && !store.owns(currentSession, noteId)) {
      return resultText(
        "That note was not created in this Codex session, so it cannot be updated. Create a new note instead.",
        true,
      );
    }

    const cwd = sessionCwd || process.cwd();
    const payload = {
      title,
      summary,
      keywords,
      content,
      tags,
      source: "codex",
      sourceMeta: sourceMeta(cwd, { sessionId: currentSession }),
    };
    const response = await client.request<SavedNote>(
      isUpdate
        ? `/api/v1/notes/${encodeURIComponent(noteId!)}`
        : "/api/v1/notes",
      {
        method: isUpdate ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) return resultText(response.message, true);

    const savedId = noteId ?? response.data.id;
    store.remember(currentSession, { id: savedId, topic, title });
    return resultText(
      `${isUpdate ? "✓ Updated" : "✓ Saved"} · "${response.data.title}" · ${response.data.webUrl}`,
    );
  },
);

server.registerTool(
  "keepnow_find",
  {
    title: "Search KeepNow notes",
    description: "Search note titles, summaries and keywords. Note bodies are not searched.",
    inputSchema: {
      ...sessionFields,
      description: z.string().trim().min(1).max(200),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId, description }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const response = await client.request<{ items: NoteSummary[]; total: number }>(
      `/api/v1/notes?q=${encodeURIComponent(description)}`,
    );
    if (!response.ok) return resultText(response.message, true);
    store.setListing(currentSession, response.data.items);
    return resultText(
      `${formatListing(response.data.items)}\n\nSearched titles, summaries and keywords — not note bodies.`,
    );
  },
);

server.registerTool(
  "keepnow_recent",
  {
    title: "Recent KeepNow notes",
    description: "List the 10 most recent KeepNow notes.",
    inputSchema: sessionFields,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const response = await client.request<{ items: NoteSummary[] }>(
      "/api/v1/notes?pageSize=10",
    );
    if (!response.ok) return resultText(response.message, true);
    store.setListing(currentSession, response.data.items);
    return resultText(formatListing(response.data.items));
  },
);

server.registerTool(
  "keepnow_open",
  {
    title: "Open a KeepNow note",
    description:
      "Load a KeepNow note by ID, current /my/notes URL, or number from the last search/recent listing. The returned body becomes model context.",
    inputSchema: {
      ...sessionFields,
      reference: z.string().trim().min(1),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId, reference }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const isListNumber = /^\d+$/.test(reference);
    const noteId = isListNumber
      ? store.resolveListingReference(currentSession, reference)
      : noteIdFromReference(reference);
    if (!noteId) {
      return resultText(
        isListNumber
          ? `There is no note ${reference} in the last search or recent list.`
          : `That URL doesn't contain a note ID. Use a URL like ${client.baseUrl()}/my/notes/<id>.`,
        true,
      );
    }
    const response = await client.request<NoteBody>(
      `/api/v1/notes/${encodeURIComponent(noteId)}`,
    );
    if (!response.ok) return resultText(response.message, true);
    return resultText(
      [
        `Loaded "${response.data.title}" into context.`,
        "",
        `# ${response.data.title}`,
        "",
        response.data.content,
      ].join("\n"),
    );
  },
);

server.registerTool(
  "keepnow_status",
  {
    title: "KeepNow account status",
    description: "Show the KeepNow account, plan, note count and storage usage.",
    inputSchema: sessionFields,
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const currentSession = requireSession(sessionId);
    if (!currentSession) return missingSessionResult();
    const response = await client.request<{
      email: string | null;
      plan: string;
      usage: { notes: number; bytesStored: number };
      limits: { maxNotes: number | null; maxBytes: number };
    }>("/api/v1/me");
    if (!response.ok) return resultText(response.message, true);
    const { email, plan, usage, limits } = response.data;
    const notes = store.read(currentSession).notes;
    return resultText(
      [
        `${email ?? "KeepNow account"} · ${plan}`,
        `notes    ${usage.notes}${limits.maxNotes === null ? "" : ` / ${limits.maxNotes}`}`,
        `storage  ${(usage.bytesStored / 1024 / 1024).toFixed(1)} MB / ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`,
        ...(notes.length
          ? ["", `this session: ${notes.map((note) => note.topic).join(", ")}`]
          : []),
      ].join("\n"),
    );
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
