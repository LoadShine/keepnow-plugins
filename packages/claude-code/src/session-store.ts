import * as os from "node:os";
import * as path from "node:path";
import { SessionStore as SharedSessionStore } from "@keepnow/plugin-core";

export type { SessionNote } from "@keepnow/plugin-core";

export class SessionStore extends SharedSessionStore {
  constructor(
    directory =
      process.env.KEEPNOW_SESSION_DIR ||
      path.join(os.homedir(), ".keepnow", "claude-code-sessions"),
  ) {
    super(directory);
  }
}
