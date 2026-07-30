import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const maximumLines = 1_200;
const includedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
]);
const ignoredDirectories = new Set([
  ".cache",
  ".component-atlas",
  ".git",
  ".nuxt",
  ".output",
  "coverage",
  "dist",
  "node_modules",
]);
const generatedFiles = new Set([
  "apps/viewer/app/i18n/generated.ts",
]);

// These pre-existing modules are tracked as bounded debt. They may shrink, but
// the audit rejects any growth and every new or extracted module must stay
// below the normal 1,200-line ceiling.
const legacyOversizedLimits = new Map([
  ["apps/viewer/app/i18n/messages.ts", 1_600],
  ["apps/viewer/app/pages/index.vue", 2_000],
  ["packages/design/src/ingest.ts", 1_650],
  ["packages/store/src/index.ts", 1_300],
]);

const oversized = [];
const legacy = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath);
      continue;
    }

    const relativePath = path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
    if (
      generatedFiles.has(relativePath)
      || !includedExtensions.has(path.extname(entry.name))
    ) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const lines = content.length === 0 ? 0 : content.split(/\r?\n/u).length;
    const limit = legacyOversizedLimits.get(relativePath) ?? maximumLines;
    if (lines > limit) {
      oversized.push({ relativePath, lines, limit });
    } else if (lines > maximumLines) {
      legacy.push({ relativePath, lines, limit });
    }
  }
}

for (const directory of ["apps", "packages", "scripts"]) {
  await walk(path.join(repositoryRoot, directory));
}

if (oversized.length > 0) {
  throw new Error(
    `Maintainability ceiling exceeded:\n${oversized
      .map(({ relativePath, lines, limit }) => `- ${relativePath}: ${lines} > ${limit}`)
      .join("\n")}`,
  );
}

console.log(
  `Maintainability audit passed. ${legacy.length} bounded legacy module(s) remain above ${maximumLines} lines.`,
);
for (const item of legacy) {
  console.log(`- ${item.relativePath}: ${item.lines}/${item.limit}`);
}
