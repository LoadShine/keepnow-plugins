import * as os from "node:os";
import * as path from "node:path";
import {
  createKeepNowClient,
  DEFAULT_BASE_URL,
  isApiKey,
  keepNowConfigFile,
  readApiKey,
  SessionStore,
  writeApiKey,
  type NoteSummary,
} from "@keepnow/plugin-core";

interface HookInput {
  hook_event_name?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  prompt?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
}

const HELP = `KeepNow commands:

$keepnow <description>        Write up the session following your description
$keepnow --help               Show this help
$keepnow --find <description> Search titles, summaries and keywords
$keepnow --open <number|id|url> Load a note into context
$keepnow --recent             Show the last 10 notes
$keepnow --status             Show account and usage
$keepnow --apikey <key>       Save the API key

Examples:
$keepnow summary
$keepnow all important findings
$keepnow the authentication bug and its fix`;

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

function block(reason: string): void {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
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

function parseKeepNowPrompt(prompt: string): string | undefined {
  const match = /^\$(?:(?:keepnow):)?keepnow(?:\s+([\s\S]*))?\s*$/.exec(prompt);
  return match ? (match[1] ?? "").trim() : undefined;
}

async function handlePrompt(input: HookInput): Promise<void> {
  if (typeof input.prompt !== "string") return;
  const args = parseKeepNowPrompt(input.prompt);
  if (args === undefined) return;

  const sessionId =
    typeof input.session_id === "string" && input.session_id
      ? input.session_id
      : undefined;

  if (!args || args === "--help") {
    block(HELP);
    return;
  }

  const apikey = /^--apikey(?:\s+(.+))?$/.exec(args);
  if (apikey) {
    const key = apikey[1]?.trim();
    if (!key) {
      block("Usage: $keepnow --apikey <key>");
      return;
    }
    if (!isApiKey(key)) {
      block(
        "That API key is not valid. Expected kn- followed by 32 lowercase hexadecimal characters.",
      );
      return;
    }
    try {
      writeApiKey(key);
      block(
        `API key saved to ${keepNowConfigFile()}.${
          process.env.KEEPNOW_API_KEY
            ? " KEEPNOW_API_KEY is currently set and takes precedence over the saved key."
            : ""
        }`,
      );
    } catch (error) {
      block(
        `Couldn't save the API key to ${keepNowConfigFile()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return;
  }

  const find = /^--find(?:\s+([\s\S]+))?$/.exec(args);
  if (find) {
    const description = find[1]?.trim();
    if (!description) {
      block("Usage: $keepnow --find <description>");
      return;
    }
    const response = await client.request<{ items: NoteSummary[]; total: number }>(
      `/api/v1/notes?q=${encodeURIComponent(description)}`,
    );
    if (!response.ok) {
      block(response.message);
      return;
    }
    if (sessionId) store.setListing(sessionId, response.data.items);
    block(
      `${formatListing(response.data.items)}\n\nSearched titles, summaries and keywords — not note bodies.`,
    );
    return;
  }

  if (args === "--recent") {
    const response = await client.request<{ items: NoteSummary[] }>(
      "/api/v1/notes?pageSize=10",
    );
    if (!response.ok) {
      block(response.message);
      return;
    }
    if (sessionId) store.setListing(sessionId, response.data.items);
    block(formatListing(response.data.items));
    return;
  }

  if (args === "--status") {
    const response = await client.request<{
      email: string | null;
      plan: string;
      usage: { notes: number; bytesStored: number };
      limits: { maxNotes: number | null; maxBytes: number };
    }>("/api/v1/me");
    if (!response.ok) {
      block(response.message);
      return;
    }
    const { email, plan, usage, limits } = response.data;
    block(
      [
        `${email ?? "KeepNow account"} · ${plan}`,
        `notes    ${usage.notes}${limits.maxNotes === null ? "" : ` / ${limits.maxNotes}`}`,
        `storage  ${(usage.bytesStored / 1024 / 1024).toFixed(1)} MB / ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`,
      ].join("\n"),
    );
    return;
  }

  // Opening a note must reach the model because the body becomes model context.
  if (/^--open(?:\s|$)/.test(args)) return;

  if (args.startsWith("--")) block(HELP);
}

function handlePreToolUse(input: HookInput): void {
  if (
    typeof input.tool_name !== "string" ||
    !/^mcp__.*keepnow.*__keepnow_/.test(input.tool_name) ||
    !input.tool_input ||
    typeof input.tool_input !== "object" ||
    Array.isArray(input.tool_input) ||
    typeof input.session_id !== "string" ||
    !input.session_id
  ) {
    return;
  }

  const updatedInput = {
    ...(input.tool_input as Record<string, unknown>),
    sessionId: input.session_id,
    ...(typeof input.cwd === "string" && input.cwd
      ? { sessionCwd: input.cwd }
      : {}),
  };
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    }),
  );
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

  let input: HookInput;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
  } catch {
    return;
  }

  if (input.hook_event_name === "UserPromptSubmit") {
    await handlePrompt(input);
  } else if (input.hook_event_name === "PreToolUse") {
    handlePreToolUse(input);
  }
}

void main();
