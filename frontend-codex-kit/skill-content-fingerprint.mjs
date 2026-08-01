import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

async function entriesAt(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const manifest = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      const metadata = await lstat(absolute);
      manifest.push(`${relative}/|DIR|${(metadata.mode & 0o777).toString(8)}`);
      manifest.push(...(await entriesAt(root, absolute)));
      continue;
    }
    if (entry.isSymbolicLink()) {
      const metadata = await lstat(absolute);
      manifest.push(
        `${relative}|LINK|${(metadata.mode & 0o777).toString(8)}|${await readlink(absolute)}`,
      );
      continue;
    }
    if (!entry.isFile()) {
      const metadata = await lstat(absolute);
      manifest.push(
        `${relative}|OTHER|${(metadata.mode & 0o777).toString(8)}`,
      );
      continue;
    }
    const metadata = await lstat(absolute);
    const mode = (metadata.mode & 0o777).toString(8);
    const digest = createHash("sha256")
      .update(await readFile(absolute))
      .digest("hex")
      .toUpperCase();
    manifest.push(`${relative}|FILE|${mode}|${digest}`);
  }
  return manifest;
}

export async function getSkillContentFingerprint(root) {
  const absoluteRoot = path.resolve(root);
  const rootMetadata = await stat(absoluteRoot);
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Skill root is not a directory: ${absoluteRoot}`);
  }
  const entries = [
    `./|DIR|${(rootMetadata.mode & 0o777).toString(8)}`,
    ...(await entriesAt(absoluteRoot)),
  ].sort();
  return createHash("sha256")
    .update(entries.join("\n"), "utf8")
    .digest("hex")
    .toUpperCase();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) {
      throw new Error("Usage: node skill-content-fingerprint.mjs <skill-root>");
    }
    process.stdout.write(`${await getSkillContentFingerprint(process.argv[2])}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
