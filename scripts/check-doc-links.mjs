import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const roots = ["README.md", "docs", "frontend-codex-kit", "skills"];
const ignored = new Set([".git", "node_modules", "dist"]);

async function markdownFiles(target) {
  const absolute = path.join(root, target);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!entries) return absolute.endsWith(".md") ? [absolute] : [];
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await markdownFiles(path.relative(root, child))));
    } else if (entry.name.endsWith(".md")) {
      files.push(child);
    }
  }
  return files;
}

const files = (await Promise.all(roots.map(markdownFiles))).flat();
const missing = [];
let checked = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    }
    if (
      !target ||
      target.startsWith("#") ||
      /^[a-z]+:/i.test(target) ||
      path.isAbsolute(target)
    ) {
      continue;
    }
    const relativeTarget = decodeURIComponent(target.split("#", 1)[0]);
    if (!relativeTarget) continue;
    checked += 1;
    const absoluteTarget = path.resolve(path.dirname(file), relativeTarget);
    const exists = await access(absoluteTarget)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      missing.push(
        `${path.relative(root, file)} -> ${relativeTarget}`,
      );
    }
  }
}

if (missing.length) {
  throw new Error(`Broken relative documentation links:\n${missing.join("\n")}`);
}

console.log(
  `Documentation link audit passed: ${checked} relative links across ${files.length} Markdown files.`,
);
