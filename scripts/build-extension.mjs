import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["src/extension/badges.js"],
  outfile: "extension/badges.js",
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  charset: "utf8",
  legalComments: "none",
});
await copyFile(new URL("../LICENSE", import.meta.url), new URL("../extension/LICENSE", import.meta.url));
