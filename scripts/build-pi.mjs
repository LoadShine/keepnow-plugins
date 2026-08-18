import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piDir = path.join(root, "packages/pi");
const distDir = path.join(piDir, "dist");

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await build({
  entryPoints: [path.join(piDir, "src/index.ts")],
  outfile: path.join(distDir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/pi-coding-agent", "typebox"],
  loader: { ".md": "text" },
  legalComments: "none",
  sourcemap: false,
});
