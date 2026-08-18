// ../core/src/index.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
function isApiKey(value) {
  return /^kn-[0-9a-f]{32}$/.test(value);
}
function keepNowConfigFile(homeDir = os.homedir()) {
  return path.join(homeDir, ".keepnow", "config.json");
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

// src/apikey-hook.ts
function block(reason) {
  return JSON.stringify({ decision: "block", reason });
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
  if (input.hook_event_name !== "UserPromptExpansion" || typeof input.command_name !== "string" || !/(?:^|:)keepnow$/.test(input.command_name) || typeof input.command_args !== "string") {
    return;
  }
  const match = /^--apikey(?:\s+(.+))?$/.exec(input.command_args.trim());
  if (!match) return;
  const key = match[1]?.trim();
  if (!key) {
    process.stdout.write(block("Usage: /keepnow --apikey <key>"));
    return;
  }
  if (!isApiKey(key)) {
    process.stdout.write(
      block(
        "That API key is not valid. Expected kn- followed by 32 lowercase hexadecimal characters."
      )
    );
    return;
  }
  try {
    writeApiKey(key);
    process.stdout.write(
      block(
        `API key saved to ${keepNowConfigFile()}.${process.env.KEEPNOW_API_KEY ? " KEEPNOW_API_KEY is currently set and takes precedence over the saved key." : ""}`
      )
    );
  } catch (error) {
    process.stdout.write(
      block(
        `Couldn't save the API key to ${keepNowConfigFile()}: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}
void main();
