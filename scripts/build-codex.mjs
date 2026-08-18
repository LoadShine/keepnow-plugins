import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = path.join(root, "packages/codex");
const distDir = path.join(pluginDir, "dist");
const skillDir = path.join(pluginDir, "skills/keepnow");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await mkdir(skillDir, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(pluginDir, "src/server.ts")],
    outfile: path.join(distDir, "server.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    sourcemap: false,
  }),
  build({
    entryPoints: [path.join(pluginDir, "src/hook.ts")],
    outfile: path.join(distDir, "hook.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    sourcemap: false,
  }),
]);

const [template, prompt] = await Promise.all([
  readFile(path.join(pluginDir, "src/skill.md"), "utf8"),
  readFile(path.join(root, "packages/core/prompts/write-up.md"), "utf8"),
]);
await writeFile(
  path.join(skillDir, "SKILL.md"),
  template.replace("{{WRITE_UP_PROMPT}}", prompt.trimEnd()),
  "utf8",
);
