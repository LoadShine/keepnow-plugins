/**
 * keepnow — pi extension
 *
 * Pi's extension API keeps browsing outside the model and persists saved-note
 * identity in the Pi session, even when the model context is compacted.
 *
 * Shared API contracts, error translation and URL parsing live in
 * `@keepnow/plugin-core`; Pi-specific commands and session state stay here.
 */
import {
  createKeepNowClient,
  DEFAULT_BASE_URL,
  isApiKey,
  keepNowConfigFile,
  noteIdFromReference,
  readApiKey,
  sourceMeta,
  writeApiKey,
  type ApiResult,
  type NoteBody,
  type NoteSummary,
  type SavedNote,
} from "@keepnow/plugin-core";
import writeUpPrompt from "@keepnow/plugin-core/prompt";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
const CONFIG_FILE = keepNowConfigFile();
const SESSION_NOTE_ENTRY = "keepnow-note";

/** Notes written during this session, in creation order. */
interface SessionNote {
  id: string;
  topic: string;
  title: string;
}

const sessionNotes: SessionNote[] = [];
/** Last list shown to the user, so `open 2` means the second line they saw. */
let lastListing: NoteSummary[] = [];

function isSessionNote(value: unknown): value is SessionNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<SessionNote>;
  return (
    typeof note.id === "string" &&
    typeof note.topic === "string" &&
    typeof note.title === "string"
  );
}

function rememberSessionNote(note: SessionNote): void {
  const existing = sessionNotes.find((item) => item.id === note.id);
  if (existing) {
    existing.topic = note.topic;
    existing.title = note.title;
  } else {
    sessionNotes.push({ ...note });
  }
}

function restoreSessionNotes(ctx: ExtensionContext): void {
  sessionNotes.length = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === SESSION_NOTE_ENTRY && isSessionNote(entry.data)) {
      rememberSessionNote(entry.data);
    }
  }
}

function apiKey(): string | undefined {
  return readApiKey();
}

const keepNowClient = createKeepNowClient({
  getApiKey: apiKey,
  getBaseUrl: () => process.env.KEEPNOW_API_URL || DEFAULT_BASE_URL,
  missingApiKeyMessage: (url) =>
    `KeepNow isn't connected. Get a key at ${url}/my/install, then run /keepnow --apikey <key>.`,
});

function baseUrl(): string {
  return keepNowClient.baseUrl();
}

function saveApiKey(key: string): void {
  writeApiKey(key);
}

async function api<T>(
  pathname: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  return keepNowClient.request<T>(pathname, init);
}

function formatListing(items: NoteSummary[]): string[] {
  if (items.length === 0) return ["No matching notes."];
  lastListing = items;
  return items.flatMap((note, index) => [
    `${String(index + 1).padStart(2)}. ${note.title}  ·  ${note.createdAt.slice(0, 10)}`,
    ...(note.summary ? [`    ${note.summary}`] : []),
  ]);
}

function show(ctx: ExtensionCommandContext, lines: string[]): void {
  ctx.ui.notify(lines.join("\n"), "info");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    restoreSessionNotes(ctx);
    lastListing = [];
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreSessionNotes(ctx);
    lastListing = [];
  });

  pi.registerTool({
    name: "keepnow_get",
    label: "KeepNow",
    description:
      "Read a KeepNow note created in this Pi session before updating it. Only IDs recorded in the current session are allowed.",
    parameters: Type.Object({
      noteId: Type.String({ description: "ID of a note created in this Pi session." }),
    }),
    execute: async (_toolCallId, params) => {
      const text = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: undefined,
      });

      if (!sessionNotes.some((note) => note.id === params.noteId)) {
        return text("That note was not created in this Pi session, so it cannot be read for an update.");
      }

      const result = await api<NoteBody>(
        `/api/v1/notes/${encodeURIComponent(params.noteId)}`,
      );
      if (!result.ok) return text(result.message);

      return text([`# ${result.data.title}`, ``, result.data.content].join("\n"));
    },
  });

  /**
   * The model calls this instead of shelling out to curl. Typed parameters mean
   * no JSON-in-shell quoting, which is where the other two environments are
   * most likely to mangle a note body containing backticks or newlines.
   */
  pi.registerTool({
    name: "keepnow_save",
    label: "KeepNow",
    description:
      "Save the write-up to KeepNow. Pass noteId to update a note created earlier in this session; omit it to create a new one.",
    parameters: Type.Object({
      noteId: Type.Optional(
        Type.String({ description: "Update this note instead of creating a new one." }),
      ),
      topic: Type.String({ description: "Short topic label — this note's identity in this session." }),
      title: Type.String(),
      summary: Type.String({ description: "1–2 sentences. Also the search index — include real error text and API names." }),
      keywords: Type.String({ description: "5–10 comma-separated retrieval terms." }),
      content: Type.String({ description: "The note body, in Markdown." }),
      tags: Type.Array(Type.String(), { description: "3–5 lowercase hyphenated tags." }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const text = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: undefined,
      });

      const isUpdate = Boolean(params.noteId);
      if (params.noteId && !sessionNotes.some((note) => note.id === params.noteId)) {
        return text(
          "That note was not created in this Pi session, so it cannot be updated. Create a new note instead.",
        );
      }

      const payload = {
        title: params.title,
        summary: params.summary,
        keywords: params.keywords,
        content: params.content,
        tags: params.tags,
        source: "pi",
        sourceMeta: sourceMeta(ctx.cwd, {
          sessionId: ctx.sessionManager.getSessionId(),
        }),
      };

      const result = await api<SavedNote>(
        isUpdate ? `/api/v1/notes/${params.noteId}` : "/api/v1/notes",
        { method: isUpdate ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );

      if (!result.ok) return text(result.message);

      if (isUpdate) {
        const note = { id: params.noteId!, topic: params.topic, title: params.title };
        rememberSessionNote(note);
        pi.appendEntry(SESSION_NOTE_ENTRY, note);
        return text(`✓ Updated · "${result.data.title}" · ${result.data.webUrl}`);
      }

      const note = { id: result.data.id, topic: params.topic, title: params.title };
      rememberSessionNote(note);
      pi.appendEntry(SESSION_NOTE_ENTRY, note);
      return text(`✓ Saved · "${result.data.title}" · ${result.data.webUrl}`);
    },
  });

  pi.registerCommand("keepnow", {
    description: "Show help, or write up the session from a description",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      const [verb, ...rest] = input.split(/\s+/);
      const remainder = rest.join(" ");

      switch (verb) {
        case "":
        case "--help": {
          return show(ctx, [
            "/keepnow <description>       Write up the session following your description",
            "/keepnow --help                Show this help",
            "/keepnow --find <description>  Search notes",
            "/keepnow --open <number|id|url> Load a note into context",
            "/keepnow --recent            Show the last 10 notes",
            "/keepnow --status            Show account and usage",
            "/keepnow --apikey <key>      Save the API key",
            "",
            "Examples:",
            "/keepnow summary",
            "/keepnow all important findings",
            "/keepnow the authentication bug and its fix",
          ]);
        }

        case "--apikey": {
          if (!remainder) return show(ctx, ["Usage: /keepnow --apikey <key>"]);
          if (!isApiKey(remainder)) {
            return show(ctx, [
              "That API key is not valid. Expected kn- followed by 32 lowercase hexadecimal characters.",
            ]);
          }
          try {
            saveApiKey(remainder);
            return show(ctx, [
              `API key saved to ${CONFIG_FILE}.`,
              ...(process.env.KEEPNOW_API_KEY
                ? ["KEEPNOW_API_KEY is currently set and takes precedence over the saved key."]
                : []),
            ]);
          } catch (error) {
            return show(ctx, [
              `Couldn't save the API key to ${CONFIG_FILE}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ]);
          }
        }

        case "--status": {
          const result = await api<{
            email: string;
            plan: string;
            usage: { notes: number; bytesStored: number };
            limits: { maxNotes: number | null; maxBytes: number };
          }>("/api/v1/me");
          if (!result.ok) return show(ctx, [result.message]);

          const { email, plan, usage, limits } = result.data;
          return show(ctx, [
            `${email} · ${plan}`,
            `notes    ${usage.notes}${limits.maxNotes === null ? "" : ` / ${limits.maxNotes}`}`,
            `storage  ${(usage.bytesStored / 1024 / 1024).toFixed(1)} MB / ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`,
            ...(sessionNotes.length
              ? [``, `this session: ${sessionNotes.map((n) => n.topic).join(", ")}`]
              : []),
          ]);
        }

        case "--find": {
          if (!remainder) return show(ctx, ["Usage: /keepnow --find <description>"]);
          const result = await api<{ items: NoteSummary[]; total: number }>(
            `/api/v1/notes?q=${encodeURIComponent(remainder)}`,
          );
          if (!result.ok) return show(ctx, [result.message]);
          return show(ctx, [
            ...formatListing(result.data.items),
            // Say this every time: an empty result otherwise reads as "the note
            // isn't there" when it may only mean "the words are in the body".
            ``,
            `Searched titles, summaries and keywords — not note bodies.`,
          ]);
        }

        case "--recent": {
          const result = await api<{ items: NoteSummary[] }>("/api/v1/notes?pageSize=10");
          if (!result.ok) return show(ctx, [result.message]);
          return show(ctx, formatListing(result.data.items));
        }

        case "--open": {
          if (!remainder) return show(ctx, ["Usage: /keepnow --open <number|id|url>"]);
          const index = Number(remainder);
          const noteId =
            Number.isInteger(index) && lastListing[index - 1]
              ? lastListing[index - 1].id
              : noteIdFromReference(remainder);

          if (!noteId) {
            return show(ctx, [
              `That URL doesn't contain a note ID. Use a URL like ${baseUrl()}/my/notes/<id>.`,
            ]);
          }

          const result = await api<NoteBody>(
            `/api/v1/notes/${encodeURIComponent(noteId)}`,
          );
          if (!result.ok) return show(ctx, [result.message]);

          // Deliver as a message so the body lands in the model's context —
          // that is the entire point of `open`.
          pi.sendUserMessage(
            [
              `Here is a note I saved earlier. Use it as context for what follows.`,
              ``,
              `# ${result.data.title}`,
              ``,
              result.data.content,
            ].join("\n"),
            { deliverAs: "followUp" },
          );
          return show(ctx, [`Loaded "${result.data.title}" into context.`]);
        }

        default: {
          if (!apiKey()) {
            return show(ctx, [
              `KeepNow isn't connected. Get a key at ${baseUrl()}/my/install, then run /keepnow --apikey <key>.`,
            ]);
          }

          // Anything other than a recognised `--option` is a natural-language
          // description, so words such as "find" and "status" remain valid.
          const description = input;
          const known = sessionNotes.length
            ? sessionNotes
                .map((n) => `- id: ${n.id} · topic: ${n.topic} · title: ${n.title}`)
                .join("\n")
            : "(none yet)";

          pi.sendUserMessage(
            [
              writeUpPrompt,
              ``,
              `---`,
              ``,
              `WRITE-UP DESCRIPTION: ${description}`,
              ``,
              // Supplied by the extension rather than recalled from context, so
              // compaction cannot cause a duplicate note.
              `Notes already saved in this session:`,
              known,
              ``,
              `If this belongs to a note listed above, call \`keepnow_get\` with its`,
              `id first, merge the old body with the new material, then call`,
              `\`keepnow_save\` with that \`noteId\`. Otherwise call \`keepnow_save\``,
              `without \`noteId\` to create a new note.`,
            ].join("\n"),
            { deliverAs: "followUp" },
          );
        }
      }
    },

    getArgumentCompletions: (prefix) => {
      const verbs = ["--apikey", "--find", "--help", "--open", "--recent", "--status"];
      const matches = verbs.filter((v) => v.startsWith(prefix));
      return matches.length ? matches.map((v) => ({ value: v, label: v })) : null;
    },
  });
}
