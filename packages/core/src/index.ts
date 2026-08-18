import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_BASE_URL = "https://keepnow.app";

/** KeepNow keys are `kn-` followed by 128 bits encoded as lowercase hex. */
export function isApiKey(value: string): boolean {
  return /^kn-[0-9a-f]{32}$/.test(value);
}

export function keepNowConfigFile(homeDir = os.homedir()): string {
  return path.join(homeDir, ".keepnow", "config.json");
}

export function readApiKey(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string | undefined {
  const env = options.env ?? process.env;
  if (env.KEEPNOW_API_KEY) return env.KEEPNOW_API_KEY;

  try {
    const config = JSON.parse(
      fs.readFileSync(keepNowConfigFile(options.homeDir), "utf8"),
    ) as { apikey?: unknown };
    return typeof config.apikey === "string" && config.apikey
      ? config.apikey
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeApiKey(key: string, homeDir = os.homedir()): string {
  if (!isApiKey(key)) {
    throw new Error(
      "API key must be kn- followed by 32 lowercase hexadecimal characters.",
    );
  }
  const configFile = keepNowConfigFile(homeDir);
  const configDir = path.dirname(configFile);
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  fs.writeFileSync(configFile, `${JSON.stringify({ apikey: key }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.chmodSync(configFile, 0o600);
  return configFile;
}

export function sourceMeta(
  cwd: string,
  extra: { model?: string; sessionId?: string } = {},
): Record<string, string> {
  const meta: Record<string, string> = { cwd, ...extra };
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };
  const root = git(["rev-parse", "--show-toplevel"]);
  if (root) meta.repo = path.basename(root);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch) meta.branch = branch;
  return meta;
}

export interface NoteSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  createdAt: string;
  webUrl: string;
}

export interface NoteBody {
  title: string;
  content: string;
  webUrl: string;
}

export interface SavedNote {
  id: string;
  title: string;
  webUrl: string;
}

export interface SessionNote {
  id: string;
  topic: string;
  title: string;
}

interface SessionData {
  sessionId: string;
  notes: SessionNote[];
  lastListing: NoteSummary[];
}

function validSessionNote(value: unknown): value is SessionNote {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<SessionNote>;
  return (
    typeof note.id === "string" &&
    typeof note.topic === "string" &&
    typeof note.title === "string"
  );
}

function validNoteSummary(value: unknown): value is NoteSummary {
  if (!value || typeof value !== "object") return false;
  const note = value as Partial<NoteSummary>;
  return (
    typeof note.id === "string" &&
    typeof note.title === "string" &&
    typeof note.createdAt === "string"
  );
}

/** Persistent, session-scoped note ownership and last-listing state. */
export class SessionStore {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  private file(sessionId: string): string {
    const digest = createHash("sha256").update(sessionId).digest("hex");
    return path.join(this.directory, `${digest}.json`);
  }

  read(sessionId: string): SessionData {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.file(sessionId), "utf8"),
      ) as Partial<SessionData>;
      if (parsed.sessionId !== sessionId) throw new Error("Session ID mismatch");
      return {
        sessionId,
        notes: Array.isArray(parsed.notes)
          ? parsed.notes.filter(validSessionNote)
          : [],
        lastListing: Array.isArray(parsed.lastListing)
          ? parsed.lastListing.filter(validNoteSummary)
          : [],
      };
    } catch {
      return { sessionId, notes: [], lastListing: [] };
    }
  }

  private write(data: SessionData): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    const target = this.file(data.sessionId);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  }

  remember(sessionId: string, note: SessionNote): void {
    const data = this.read(sessionId);
    const existing = data.notes.find((item) => item.id === note.id);
    if (existing) Object.assign(existing, note);
    else data.notes.push(note);
    this.write(data);
  }

  setListing(sessionId: string, items: NoteSummary[]): void {
    const data = this.read(sessionId);
    data.lastListing = items;
    this.write(data);
  }

  resolveListingReference(
    sessionId: string,
    reference: string,
  ): string | undefined {
    const index = Number(reference);
    if (!Number.isInteger(index) || index < 1) return undefined;
    return this.read(sessionId).lastListing[index - 1]?.id;
  }

  owns(sessionId: string, noteId: string): boolean {
    return this.read(sessionId).notes.some((note) => note.id === noteId);
  }
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface KeepNowClientOptions {
  getApiKey: () => string | undefined;
  getBaseUrl?: () => string;
  missingApiKeyMessage?: (baseUrl: string) => string;
}

export interface KeepNowClient {
  baseUrl(): string;
  request<T>(pathname: string, init?: RequestInit): Promise<ApiResult<T>>;
}

export function humanApiError(
  baseUrl: string,
  code: string | undefined,
  fallback: string | undefined,
  status: number,
): string {
  switch (code) {
    case "invalid_key":
      return `That API key is invalid or revoked. Generate a new one at ${baseUrl}/my/keys.`;
    case "quota_notes":
      return "You've hit your note limit. Upgrade, or delete some old notes.";
    case "quota_storage":
      return `Storage limit reached — usually version history. See ${baseUrl}/my.`;
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

export function createKeepNowClient(options: KeepNowClientOptions): KeepNowClient {
  const baseUrl = () => options.getBaseUrl?.() || DEFAULT_BASE_URL;

  return {
    baseUrl,
    async request<T>(pathname: string, init: RequestInit = {}): Promise<ApiResult<T>> {
      const key = options.getApiKey();
      if (!key) {
        return {
          ok: false,
          message:
            options.missingApiKeyMessage?.(baseUrl()) ??
            `KeepNow isn't connected. Get a key at ${baseUrl()}/my/install.`,
        };
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl()}${pathname}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
          },
        });
      } catch (error) {
        return {
          ok: false,
          message: `Couldn't reach ${baseUrl()}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; code?: string }
          | null;
        return {
          ok: false,
          message: humanApiError(baseUrl(), body?.code, body?.error, response.status),
        };
      }

      return { ok: true, data: (await response.json()) as T };
    },
  };
}

/** Extract a note ID from the current KeepNow web/API URL, or accept a raw ID. */
export function noteIdFromReference(reference: string): string | undefined {
  try {
    const url = new URL(reference);
    const match = /^\/(?:my\/notes|api\/v1\/notes)\/([^/]+)(?:\/edit)?\/?$/.exec(
      url.pathname,
    );
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return reference;
  }
}
