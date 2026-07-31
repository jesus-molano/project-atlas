import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  memoryItemMarkdown,
  type MemoryItem,
  type MemoryWriteTarget,
} from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { slash } from "./memory.js";

export interface MemoryFileRequest {
  destination: string;
  content: string;
  skipWhenMissing: boolean;
}

interface PreparedMemoryFile extends MemoryFileRequest {
  originalFingerprint?: string;
  stagePath?: string;
}

interface SwappedMemoryFile extends PreparedMemoryFile {
  backupPath?: string;
  originalMoved: boolean;
  installed: boolean;
}

function safeFileStem(id: string): string {
  return id.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function memoryFileName(id: string): string {
  const safe = safeFileStem(id);
  if (!safe) {
    throw new Error(`Memory item ${id} cannot be mapped to a safe filename.`);
  }
  return `${safe}.md`;
}

export function prepareMemoryItemWrite(
  item: MemoryItem,
  target: MemoryWriteTarget,
): { item: MemoryItem; request: MemoryFileRequest } {
  const storageRoot = projectStorageDirectory(item.projectId);
  const directory = path.join(
    storageRoot,
    "memory",
    target === "canonical" ? "canonical" : "local",
  );
  const filePath = path.join(directory, memoryFileName(item.id));
  const relativePath = `atlas-storage/${slash(
    path.relative(storageRoot, filePath),
  )}`;
  const next = { ...item, bodyPath: relativePath };
  return {
    item: next,
    request: {
      destination: filePath,
      content: memoryItemMarkdown(next),
      skipWhenMissing: false,
    },
  };
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

async function lstatIfExists(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function assertInsideStorage(storageRoot: string, candidate: string): void {
  const relative = path.relative(storageRoot, candidate);
  if (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  ) {
    return;
  }
  throw new Error(
    `Refusing to write memory outside Project Atlas storage: ${candidate}`,
  );
}

async function inspectManagedDirectory(
  storageRoot: string,
  directory: string,
): Promise<boolean> {
  assertInsideStorage(storageRoot, directory);
  const rootStats = await lstat(storageRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(
      `Project Atlas storage root is not a regular directory: ${storageRoot}`,
    );
  }
  const relative = path.relative(storageRoot, directory);
  let current = storageRoot;
  let missing = false;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (missing) continue;
    const stats = await lstatIfExists(current);
    if (!stats) {
      missing = true;
      continue;
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `Memory directory path contains a symlink or non-directory: ${current}`,
      );
    }
  }
  if (!missing) {
    const [realRoot, realDirectory] = await Promise.all([
      realpath(storageRoot),
      realpath(directory),
    ]);
    assertInsideStorage(realRoot, realDirectory);
  }
  return !missing;
}

async function createManagedDirectory(
  storageRoot: string,
  directory: string,
  createdDirectories: string[],
): Promise<void> {
  assertInsideStorage(storageRoot, directory);
  const relative = path.relative(storageRoot, directory);
  let current = storageRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stats = await lstatIfExists(current);
    if (!stats) {
      try {
        await mkdir(current);
        createdDirectories.push(current);
      } catch (error) {
        if (nodeErrorCode(error) !== "EEXIST") throw error;
      }
      stats = await lstat(current);
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `Memory directory path contains a symlink or non-directory: ${current}`,
      );
    }
  }
}

function fileFingerprint(
  stats: Awaited<ReturnType<typeof lstat>>,
): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeMs].join(":");
}

async function preflightMemoryFiles(
  storageRoot: string,
  requests: MemoryFileRequest[],
): Promise<{
  files: PreparedMemoryFile[];
  directories: string[];
}> {
  const files: PreparedMemoryFile[] = [];
  const directories = new Set<string>();
  const destinations = new Set<string>();
  const directoryEntries = new Map<string, string[]>();
  for (const request of requests) {
    const destination = path.resolve(request.destination);
    assertInsideStorage(storageRoot, destination);
    const collisionKey = destination.toLowerCase();
    if (destinations.has(collisionKey)) {
      throw new Error(
        `Memory application maps multiple items to the same case-insensitive path: ${destination}`,
      );
    }
    destinations.add(collisionKey);
    const directory = path.dirname(destination);
    const directoryExists = await inspectManagedDirectory(
      storageRoot,
      directory,
    );
    if (!directoryExists) {
      if (request.skipWhenMissing) continue;
      directories.add(directory);
    }
    let entries = directoryEntries.get(directory);
    if (!entries && directoryExists) {
      entries = await readdir(directory);
      directoryEntries.set(directory, entries);
    }
    const fileName = path.basename(destination);
    const caseMatch = entries?.find(
      (entry) => entry.toLowerCase() === fileName.toLowerCase(),
    );
    if (caseMatch && caseMatch !== fileName) {
      throw new Error(
        `Memory filename collides case-insensitively with ${caseMatch}: ${fileName}`,
      );
    }
    const stats = directoryExists
      ? await lstatIfExists(destination)
      : undefined;
    if (!stats && request.skipWhenMissing) continue;
    if (stats && (stats.isSymbolicLink() || !stats.isFile())) {
      throw new Error(
        `Refusing to replace a symlink or non-regular memory file: ${destination}`,
      );
    }
    files.push({
      ...request,
      destination,
      ...(stats ? { originalFingerprint: fileFingerprint(stats) } : {}),
    });
  }
  return { files, directories: [...directories] };
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  const stats = await lstatIfExists(filePath);
  if (!stats) return;
  if (!stats.isFile() && !stats.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-file rollback path: ${filePath}`);
  }
  await unlink(filePath);
}

async function stageMemoryFile(file: PreparedMemoryFile): Promise<string> {
  const stagePath = path.join(
    path.dirname(file.destination),
    `.${path.basename(file.destination)}.${randomUUID()}.atlas-stage`,
  );
  const handle = await open(stagePath, "wx", 0o600);
  const failures: unknown[] = [];
  try {
    await handle.writeFile(file.content, "utf8");
    await handle.sync();
  } catch (error) {
    failures.push(error);
  }
  try {
    await handle.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    try {
      await removeFileIfPresent(stagePath);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        `Staging memory file failed and cleanup was incomplete: ${file.destination}`,
        { cause: failures[0] },
      );
    }
    throw failures[0];
  }
  return stagePath;
}

async function rollbackMemoryFiles(
  swapped: SwappedMemoryFile[],
  staged: PreparedMemoryFile[],
  createdDirectories: string[],
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const file of [...swapped].reverse()) {
    try {
      if (file.installed) await removeFileIfPresent(file.destination);
      if (file.originalMoved && file.backupPath) {
        await rename(file.backupPath, file.destination);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  for (const file of staged) {
    if (!file.stagePath) continue;
    try {
      await removeFileIfPresent(file.stagePath);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const directory of [...createdDirectories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export async function commitMemoryFiles(
  storageRoot: string,
  requests: MemoryFileRequest[],
  commitDatabase: () => void,
): Promise<void> {
  const { files, directories } = await preflightMemoryFiles(
    storageRoot,
    requests,
  );
  const createdDirectories: string[] = [];
  const staged: PreparedMemoryFile[] = [];
  const swapped: SwappedMemoryFile[] = [];
  try {
    for (const directory of directories.sort(
      (left, right) => left.length - right.length,
    )) {
      await createManagedDirectory(
        storageRoot,
        directory,
        createdDirectories,
      );
    }
    for (const file of files) {
      file.stagePath = await stageMemoryFile(file);
      staged.push(file);
    }
    for (const file of staged) {
      const current = await lstatIfExists(file.destination);
      if (current && (current.isSymbolicLink() || !current.isFile())) {
        throw new Error(
          `Memory destination changed to a symlink or non-regular file: ${file.destination}`,
        );
      }
      const currentFingerprint = current
        ? fileFingerprint(current)
        : undefined;
      if (currentFingerprint !== file.originalFingerprint) {
        throw new Error(
          `Memory destination changed after preflight: ${file.destination}`,
        );
      }
      const swappedFile: SwappedMemoryFile = {
        ...file,
        originalMoved: false,
        installed: false,
      };
      swapped.push(swappedFile);
      if (current) {
        swappedFile.backupPath = path.join(
          path.dirname(file.destination),
          `.${path.basename(file.destination)}.${randomUUID()}.atlas-backup`,
        );
        await rename(file.destination, swappedFile.backupPath);
        swappedFile.originalMoved = true;
      }
      await rename(file.stagePath!, file.destination);
      delete file.stagePath;
      delete swappedFile.stagePath;
      swappedFile.installed = true;
    }
    commitDatabase();
  } catch (error) {
    const rollbackErrors = await rollbackMemoryFiles(
      swapped,
      staged,
      createdDirectories,
    );
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Memory application failed and filesystem rollback was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }
  for (const file of swapped) {
    if (!file.backupPath) continue;
    try {
      await removeFileIfPresent(file.backupPath);
    } catch {
      // A stale hidden backup is safer than failing an already committed DB transaction.
    }
  }
}

export function supersededMemoryFileRequest(
  item: MemoryItem,
): MemoryFileRequest | undefined {
  if (!item.bodyPath) return undefined;
  if (!item.bodyPath.startsWith("atlas-storage/")) {
    // Repository-local memory is legacy read-only compatibility data.
    return undefined;
  }
  const storageRoot = projectStorageDirectory(item.projectId);
  const storageRelative = item.bodyPath.slice("atlas-storage/".length);
  const absolute = path.resolve(storageRoot, storageRelative);
  assertInsideStorage(storageRoot, absolute);
  return {
    destination: absolute,
    content: memoryItemMarkdown(item),
    skipWhenMissing: true,
  };
}

export async function writeMemoryItemFile(
  item: MemoryItem,
  target: MemoryWriteTarget,
): Promise<MemoryItem> {
  const prepared = prepareMemoryItemWrite(item, target);
  await commitMemoryFiles(
    projectStorageDirectory(item.projectId),
    [prepared.request],
    () => undefined,
  );
  return prepared.item;
}
