import { isApiKey, keepNowConfigFile, writeApiKey } from "@keepnow/plugin-core";

interface PromptExpansionInput {
  hook_event_name?: unknown;
  command_name?: unknown;
  command_args?: unknown;
}

function block(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

  let input: PromptExpansionInput;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PromptExpansionInput;
  } catch {
    return;
  }

  if (
    input.hook_event_name !== "UserPromptExpansion" ||
    typeof input.command_name !== "string" ||
    !/(?:^|:)keepnow$/.test(input.command_name) ||
    typeof input.command_args !== "string"
  ) {
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
        "That API key is not valid. Expected kn- followed by 32 lowercase hexadecimal characters.",
      ),
    );
    return;
  }

  try {
    writeApiKey(key);
    process.stdout.write(
      block(
        `API key saved to ${keepNowConfigFile()}.${
          process.env.KEEPNOW_API_KEY
            ? " KEEPNOW_API_KEY is currently set and takes precedence over the saved key."
            : ""
        }`,
      ),
    );
  } catch (error) {
    process.stdout.write(
      block(
        `Couldn't save the API key to ${keepNowConfigFile()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
  }
}

void main();
