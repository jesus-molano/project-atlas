import { createHash } from "node:crypto";
import path from "node:path";

const LEGACY_FILE_TASK_ID = /^[A-Za-z0-9_.-]{1,160}$/u;

export function normalizedWorkspaceRoot(rootPath: string): string {
  const resolved = path.resolve(rootPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function sameWorkspaceRoot(left: string, right: string): boolean {
  return normalizedWorkspaceRoot(left) === normalizedWorkspaceRoot(right);
}

export function taskStateFileName(
  rootPath: string,
  taskId: string,
  extension: "json" | "ndjson",
): string {
  return `${createHash("sha256")
    .update(`${normalizedWorkspaceRoot(rootPath)}\0${taskId}`)
    .digest("hex")}.${extension}`;
}

export function legacyTaskFilePath(
  directory: string,
  taskId: string,
  extension: "json" | "ndjson",
): string | undefined {
  return LEGACY_FILE_TASK_ID.test(taskId)
    ? path.join(directory, `${taskId}.${extension}`)
    : undefined;
}
