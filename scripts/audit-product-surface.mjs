import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const roots = [
  "README.md",
  "docs",
  "frontend-codex-kit",
  "skills",
  "apps",
  "packages/cli",
  "packages/mcp",
];
const ignoredDirectories = new Set([
  ".git",
  ".nuxt",
  ".output",
  "dist",
  "node_modules",
]);
const textExtensions = new Set([
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".vue",
  ".yaml",
  ".yml",
]);
const forbidden = [
  new RegExp(`\\b${"pre" + "view"}`, "i"),
  new RegExp(`\\b${"play" + "ground"}\\b`, "i"),
  new RegExp(`\\b${"L" + "ab"}\\b`),
  new RegExp(`${41}${74}`),
];
const discardedPackage = path.join(root, "packages", "pre" + "view");

async function filesAt(target) {
  const absolute = path.join(root, target);
  const statEntries = await readdir(absolute, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!statEntries) return [absolute];
  const files = [];
  for (const entry of statEntries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...(await filesAt(path.relative(root, child))));
    else if (textExtensions.has(path.extname(entry.name))) files.push(child);
  }
  return files;
}

const files = (await Promise.all(roots.map(filesAt))).flat();
const findings = [];
if (await access(discardedPackage).then(() => true).catch(() => false)) {
  findings.push("discarded package directory still exists");
}
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      findings.push(`${path.relative(root, file)} matches ${pattern}`);
    }
  }
}
if (findings.length) {
  throw new Error(
    `Discarded product-surface terminology found:\n${findings.join("\n")}`,
  );
}
console.log(`Product-surface audit passed across ${files.length} source files.`);
