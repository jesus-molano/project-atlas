import { constants, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const START_MARKER = "<!-- project-atlas:frontend-task:start -->";
export const END_MARKER = "<!-- project-atlas:frontend-task:end -->";

function countOccurrences(source, marker) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(marker, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + marker.length;
  }
}

async function readTarget(targetPath) {
  try {
    const source = await readFile(targetPath, "utf8");
    // File.ReadAllText, used by the PowerShell implementation, consumes a
    // leading UTF-8 BOM. Match that behavior so a migrated file is UTF-8
    // without a BOM as well.
    return source.startsWith("\uFEFF") ? source.slice(1) : source;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function createBackup(targetPath) {
  const backupBase = `${targetPath}.project-atlas.bak`;
  for (let index = 0; ; index += 1) {
    const backupPath = index === 0 ? backupBase : `${backupBase}.${index}`;
    try {
      await copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
  }
}

export async function removeAgentsInstructions({
  targetPath,
  dryRun = false,
  writeLine = console.log,
}) {
  if (!targetPath) throw new Error("A target path is required.");

  const absoluteTarget = path.resolve(targetPath);
  const source = await readTarget(absoluteTarget);
  if (source === undefined) {
    writeLine(
      "[frontend-codex-kit] No legacy Atlas AGENTS.md block to migrate.",
    );
    return { status: "missing", targetPath: absoluteTarget };
  }

  const starts = countOccurrences(source, START_MARKER);
  const ends = countOccurrences(source, END_MARKER);
  if (starts !== ends || starts > 1) {
    throw new Error(
      `Refusing to edit ${absoluteTarget} because its Atlas markers are malformed or duplicated.`,
    );
  }
  if (starts === 0) {
    writeLine(
      "[frontend-codex-kit] No legacy Atlas AGENTS.md block to migrate.",
    );
    return { status: "unchanged", targetPath: absoluteTarget };
  }

  const start = source.indexOf(START_MARKER);
  const endMarkerStart = source.indexOf(END_MARKER, start + START_MARKER.length);
  if (endMarkerStart === -1) {
    throw new Error(
      `Refusing to edit ${absoluteTarget} because its Atlas markers are malformed or duplicated.`,
    );
  }

  let end = endMarkerStart + END_MARKER.length;
  if (source[end] === "\r") end += 1;
  if (source[end] === "\n") end += 1;
  const next = source.slice(0, start) + source.slice(end);

  if (dryRun) {
    writeLine(
      `[frontend-codex-kit] DRY RUN: remove legacy Atlas routing block from ${absoluteTarget}`,
    );
    return { status: "would-remove", targetPath: absoluteTarget };
  }

  const backupPath = await createBackup(absoluteTarget);
  try {
    await writeFile(absoluteTarget, next, "utf8");
  } catch (error) {
    throw new Error(
      `AGENTS.md migration failed. The original backup remains at ${backupPath}. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  writeLine(
    `[frontend-codex-kit] Removed legacy Atlas routing block from ${absoluteTarget}`,
  );
  writeLine(`[frontend-codex-kit] Backup: ${backupPath}`);
  return {
    status: "removed",
    targetPath: absoluteTarget,
    backupPath,
  };
}

function readArguments(argv) {
  let targetPath;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      if (dryRun) throw new Error("Duplicate --dry-run flag.");
      dryRun = true;
      continue;
    }
    if (argument === "--target") {
      if (targetPath !== undefined) throw new Error("Duplicate --target option.");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --target.");
      }
      targetPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (!targetPath) {
    throw new Error(
      "Usage: node remove-agents-instructions.mjs --target <path> [--dry-run]",
    );
  }
  return { targetPath, dryRun };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await removeAgentsInstructions(readArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
