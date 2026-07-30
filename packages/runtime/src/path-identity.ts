import { realpathSync, statSync } from "node:fs";
import path from "node:path";

function normalizedText(value: string): string {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function canonicalFilesystemPath(value: string): string {
  return path.resolve(value);
}

export function filesystemPathKey(value: string): string {
  const resolved = canonicalFilesystemPath(value);
  let real: string;
  try {
    real = realpathSync.native(resolved);
  } catch {
    return normalizedText(resolved);
  }
  if (process.platform === "win32") {
    try {
      const stats = statSync(real, { bigint: true });
      if (stats.dev !== 0n || stats.ino !== 0n) {
        return `win32:${stats.dev.toString(16)}:${stats.ino.toString(16)}`;
      }
    } catch {
      // Fall back to the normalized native path below.
    }
  }
  return normalizedText(real);
}

export function filesystemPathsEquivalent(
  left: string,
  right: string,
): boolean {
  return filesystemPathKey(left) === filesystemPathKey(right);
}
