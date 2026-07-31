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

const oversized = [];

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
    if (lines > maximumLines) {
      oversized.push({ relativePath, lines, limit: maximumLines });
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

console.log(`Maintainability audit passed. Every checked module is at or below ${maximumLines} lines.`);
