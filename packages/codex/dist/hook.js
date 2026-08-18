// src/hook.ts
import * as os2 from "node:os";
import * as path2 from "node:path";

// ../core/src/index.ts
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
var DEFAULT_BASE_URL = "https://keepnow.app";
function isApiKey(value) {
  return /^kn-[0-9a-f]{32}$/.test(value);
}
function keepNowConfigFile(homeDir = os.homedir()) {
  return path.join(homeDir, ".keepnow", "config.json");
}
function readApiKey(options = {}) {
  const env = options.env ?? process.env;
  if (env.KEEPNOW_API_KEY) return env.KEEPNOW_API_KEY;
  try {
    const config = JSON.parse(
      fs.readFileSync(keepNowConfigFile(options.homeDir), "utf8")
    );
    return typeof config.apikey === "string" && config.apikey ? config.apikey : void 0;
  } catch {
    return void 0;
  }
}
function writeApiKey(key, homeDir = os.homedir()) {
  if (!isApiKey(key)) {
    throw new Error(
      "API key must be kn- followed by 32 lowercase hexadecimal characters."
    );
  }
  const configFile = keepNowConfigFile(homeDir);
  const configDir = path.dirname(configFile);
  fs.mkdirSync(configDir, { recursive: true, mode: 448 });
  fs.chmodSync(configDir, 448);
  fs.writeFileSync(configFile, `${JSON.stringify({ apikey: key }, null, 2)}
`, {
    encoding: "utf8",
    mode: 384
  });
  fs.chmodSync(configFile, 384);
  return configFile;
}
function validSessionNote(value) {
  if (!value || typeof value !== "object") return false;
  const note = value;
  return typeof note.id === "string" && typeof note.topic === "string" && typeof note.title === "string";
}
function validNoteSummary(value) {
  if (!value || typeof value !== "object") return false;
  const note = value;
  return typeof note.id === "string" && typeof note.title === "string" && typeof note.createdAt === "string";
}
var SessionStore = class {
  directory;
  constructor(directory) {
    this.directory = directory;
  }
  file(sessionId) {
    const digest = createHash("sha256").update(sessionId).digest("hex");
    return path.join(this.directory, `${digest}.json`);
  }
  read(sessionId) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.file(sessionId), "utf8")
      );
      if (parsed.sessionId !== sessionId) throw new Error("Session ID mismatch");
      return {
        sessionId,
        notes: Array.isArray(parsed.notes) ? parsed.notes.filter(validSessionNote) : [],
        lastListing: Array.isArray(parsed.lastListing) ? parsed.lastListing.filter(validNoteSummary) : []
      };
    } catch {
      return { sessionId, notes: [], lastListing: [] };
    }
  }
  write(data) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 448 });
    fs.chmodSync(this.directory, 448);
    const target = this.file(data.sessionId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}
`, {
      encoding: "utf8",
      mode: 384
    });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 384);
  }
  remember(sessionId, note) {
    const data = this.read(sessionId);
    const existing = data.notes.find((item) => item.id === note.id);
    if (existing) Object.assign(existing, note);
    else data.notes.push(note);
    this.write(data);
  }
  setListing(sessionId, items) {
    const data = this.read(sessionId);
    data.lastListing = items;
    this.write(data);
  }
  resolveListingReference(sessionId, reference) {
    const index = Number(reference);
    if (!Number.isInteger(index) || index < 1) return void 0;
    return this.read(sessionId).lastListing[index - 1]?.id;
  }
  owns(sessionId, noteId) {
    return this.read(sessionId).notes.some((note) => note.id === noteId);
  }
};
function humanApiError(baseUrl, code, fallback, status) {
  switch (code) {
    case "invalid_key":
      return `That API key is invalid or revoked. Generate a new one at ${baseUrl}/my/keys.`;
    case "quota_notes":
      return "You've hit your note limit. Upgrade, or delete some old notes.";
    case "quota_storage":
      return `Storage limit reached \u2014 usually version history. See ${baseUrl}/my.`;
    case "too_large":
      return "That note is over 256 KB. Split it, or trim the body.";
    case "rate_limited":
      return "Too many requests. Wait a minute and try again.";
    case "not_found":
      return "That note is gone.";
    default:
      return fallback ?? `KeepNow returned ${status}.`;
  }
}
function createKeepNowClient(options) {
  const baseUrl = () => options.getBaseUrl?.() || DEFAULT_BASE_URL;
  return {
    baseUrl,
    async request(pathname, init = {}) {
      const key = options.getApiKey();
      if (!key) {
        return {
          ok: false,
          message: options.missingApiKeyMessage?.(baseUrl()) ?? `KeepNow isn't connected. Get a key at ${baseUrl()}/my/install.`
        };
      }
      let response;
      try {
        response = await fetch(`${baseUrl()}${pathname}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            ...init.headers ?? {}
          }
        });
      } catch (error) {
        return {
          ok: false,
          message: `Couldn't reach ${baseUrl()}: ${error instanceof Error ? error.message : String(error)}`
        };
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        return {
          ok: false,
          message: humanApiError(baseUrl(), body?.code, body?.error, response.status)
        };
      }
      return { ok: true, data: await response.json() };
    }
  };
}

// src/hook.ts
var HELP = `KeepNow commands:

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
var store = new SessionStore(
  process.env.KEEPNOW_SESSION_DIR || path2.join(os2.homedir(), ".keepnow", "codex-sessions")
);
var client = createKeepNowClient({
  getApiKey: () => readApiKey(),
  getBaseUrl: () => process.env.KEEPNOW_API_URL || DEFAULT_BASE_URL,
  missingApiKeyMessage: (url) => `KeepNow isn't connected. Get a key at ${url}/my/install, then run $keepnow --apikey <key>.`
});
function block(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
function formatListing(items) {
  if (items.length === 0) return "No matching notes.";
  return items.flatMap((note, index) => [
    `${String(index + 1).padStart(2)}. ${note.title}  \xB7  ${note.createdAt.slice(0, 10)}`,
    ...note.summary ? [`    ${note.summary}`] : []
  ]).join("\n");
}
function parseKeepNowPrompt(prompt) {
  const match = /^\$(?:(?:keepnow):)?keepnow(?:\s+([\s\S]*))?\s*$/.exec(prompt);
  return match ? (match[1] ?? "").trim() : void 0;
}
async function handlePrompt(input) {
  if (typeof input.prompt !== "string") return;
  const args = parseKeepNowPrompt(input.prompt);
  if (args === void 0) return;
  const sessionId = typeof input.session_id === "string" && input.session_id ? input.session_id : void 0;
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
        "That API key is not valid. Expected kn- followed by 32 lowercase hexadecimal characters."
      );
      return;
    }
    try {
      writeApiKey(key);
      block(
        `API key saved to ${keepNowConfigFile()}.${process.env.KEEPNOW_API_KEY ? " KEEPNOW_API_KEY is currently set and takes precedence over the saved key." : ""}`
      );
    } catch (error) {
      block(
        `Couldn't save the API key to ${keepNowConfigFile()}: ${error instanceof Error ? error.message : String(error)}`
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
    const response = await client.request(
      `/api/v1/notes?q=${encodeURIComponent(description)}`
    );
    if (!response.ok) {
      block(response.message);
      return;
    }
    if (sessionId) store.setListing(sessionId, response.data.items);
    block(
      `${formatListing(response.data.items)}

Searched titles, summaries and keywords \u2014 not note bodies.`
    );
    return;
  }
  if (args === "--recent") {
    const response = await client.request(
      "/api/v1/notes?pageSize=10"
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
    const response = await client.request("/api/v1/me");
    if (!response.ok) {
      block(response.message);
      return;
    }
    const { email, plan, usage, limits } = response.data;
    block(
      [
        `${email ?? "KeepNow account"} \xB7 ${plan}`,
        `notes    ${usage.notes}${limits.maxNotes === null ? "" : ` / ${limits.maxNotes}`}`,
        `storage  ${(usage.bytesStored / 1024 / 1024).toFixed(1)} MB / ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`
      ].join("\n")
    );
    return;
  }
  if (/^--open(?:\s|$)/.test(args)) return;
  if (args.startsWith("--")) block(HELP);
}
function handlePreToolUse(input) {
  if (typeof input.tool_name !== "string" || !/^mcp__.*keepnow.*__keepnow_/.test(input.tool_name) || !input.tool_input || typeof input.tool_input !== "object" || Array.isArray(input.tool_input) || typeof input.session_id !== "string" || !input.session_id) {
    return;
  }
  const updatedInput = {
    ...input.tool_input,
    sessionId: input.session_id,
    ...typeof input.cwd === "string" && input.cwd ? { sessionCwd: input.cwd } : {}
  };
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput
      }
    })
  );
}
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
