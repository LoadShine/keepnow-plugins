import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  createKeepNowClient,
  DEFAULT_BASE_URL,
  noteIdFromReference,
  readApiKey,
  sourceMeta,
  type NoteBody,
  type NoteSummary,
  type SavedNote,
} from "@keepnow/plugin-core";
import { SessionStore } from "./session-store.js";

const sessionId = z.string().trim().min(1).max(200).describe("The current Claude Code session ID.");
const store = new SessionStore();
const client = createKeepNowClient({
  getApiKey: () => readApiKey(),
  getBaseUrl: () => process.env.KEEPNOW_API_URL || DEFAULT_BASE_URL,
  missingApiKeyMessage: (url) =>
    `KeepNow isn't connected. Get a key at ${url}/my/install, then run /keepnow --apikey <key>.`,
});

const server = new McpServer({ name: "keepnow", version: "0.1.0" });
const resultText = (text: string, isError = false) => ({
  content: [{ type: "text" as const, text }],
  ...(isError ? { isError: true } : {}),
});

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
      "List notes created through KeepNow in this Claude Code session. Call this before deciding whether a write-up updates an existing note.",
    inputSchema: { sessionId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const notes = store.read(sessionId).notes;
    return resultText(
      notes.length
        ? notes.map((note) => `- id: ${note.id} · topic: ${note.topic} · title: ${note.title}`).join("\n")
        : "(none yet)",
    );
  },
);

server.registerTool(
  "keepnow_get",
  {
    title: "Read a same-session KeepNow note",
    description:
      "Read a note created in this Claude Code session before updating it. Notes outside the session are rejected.",
    inputSchema: {
      sessionId,
      noteId: z.string().trim().min(1).describe("ID returned by keepnow_session_notes."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId, noteId }) => {
    if (!store.owns(sessionId, noteId)) {
      return resultText(
        "That note was not created in this Claude Code session, so it cannot be read for an update.",
        true,
      );
    }
    const response = await client.request<NoteBody>(`/api/v1/notes/${encodeURIComponent(noteId)}`);
    if (!response.ok) return resultText(response.message, true);
    return resultText([`# ${response.data.title}`, "", response.data.content].join("\n"));
  },
);

server.registerTool(
  "keepnow_save",
  {
    title: "Save a KeepNow note",
    description:
      "Create a KeepNow note, or update a note created in this Claude Code session. The user-facing write-up must be shown before calling this tool.",
    inputSchema: {
      sessionId,
      noteId: z.string().trim().min(1).optional().describe("Same-session note ID to update."),
      topic: z.string().trim().min(1).max(200).describe("Short semantic identity for this note in the session."),
      title: z.string().trim().min(1).max(200),
      summary: z.string().trim().min(1).max(1000),
      keywords: z.string().trim().min(1).max(500),
      content: z.string().min(1),
      tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  async ({ sessionId, noteId, topic, title, summary, keywords, content, tags }) => {
    const isUpdate = Boolean(noteId);
    if (noteId && !store.owns(sessionId, noteId)) {
      return resultText(
        "That note was not created in this Claude Code session, so it cannot be updated. Create a new note instead.",
        true,
      );
    }

    const cwd = process.env.KEEPNOW_PROJECT_DIR || process.cwd();
    const payload = {
      title,
      summary,
      keywords,
      content,
      tags,
      source: "claude-code",
      sourceMeta: sourceMeta(cwd, { sessionId }),
    };
    const response = await client.request<SavedNote>(
      isUpdate ? `/api/v1/notes/${encodeURIComponent(noteId!)}` : "/api/v1/notes",
      { method: isUpdate ? "PATCH" : "POST", body: JSON.stringify(payload) },
    );
    if (!response.ok) return resultText(response.message, true);

    const savedId = noteId ?? response.data.id;
    store.remember(sessionId, { id: savedId, topic, title });
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
      sessionId,
      description: z.string().trim().min(1).max(200),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId, description }) => {
    const response = await client.request<{ items: NoteSummary[]; total: number }>(
      `/api/v1/notes?q=${encodeURIComponent(description)}`,
    );
    if (!response.ok) return resultText(response.message, true);
    store.setListing(sessionId, response.data.items);
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
    inputSchema: { sessionId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const response = await client.request<{ items: NoteSummary[] }>("/api/v1/notes?pageSize=10");
    if (!response.ok) return resultText(response.message, true);
    store.setListing(sessionId, response.data.items);
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
      sessionId,
      reference: z.string().trim().min(1).describe("A list number, note ID, or /my/notes URL."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    _meta: { "anthropic/maxResultSizeChars": 300000 },
  },
  async ({ sessionId, reference }) => {
    const isListNumber = /^\d+$/.test(reference);
    const noteId = isListNumber
      ? store.resolveListingReference(sessionId, reference)
      : noteIdFromReference(reference);
    if (!noteId) {
      return resultText(
        isListNumber
          ? `There is no note ${reference} in the last search or recent list.`
          : `That URL doesn't contain a note ID. Use a URL like ${client.baseUrl()}/my/notes/<id>.`,
        true,
      );
    }
    const response = await client.request<NoteBody>(`/api/v1/notes/${encodeURIComponent(noteId)}`);
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
    inputSchema: { sessionId },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ sessionId }) => {
    const response = await client.request<{
      email: string | null;
      plan: string;
      usage: { notes: number; bytesStored: number };
      limits: { maxNotes: number | null; maxBytes: number };
    }>("/api/v1/me");
    if (!response.ok) return resultText(response.message, true);
    const { email, plan, usage, limits } = response.data;
    const notes = store.read(sessionId).notes;
    return resultText(
      [
        `${email ?? "KeepNow account"} · ${plan}`,
        `notes    ${usage.notes}${limits.maxNotes === null ? "" : ` / ${limits.maxNotes}`}`,
        `storage  ${(usage.bytesStored / 1024 / 1024).toFixed(1)} MB / ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`,
        ...(notes.length ? ["", `this session: ${notes.map((note) => note.topic).join(", ")}`] : []),
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
