import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  projectAtlasStorageRoot,
  projectStorageDirectory,
} from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";

const execFileAsync = promisify(execFile);
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const BASELINE_HANDLE =
  /^git-baseline:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{16})$/u;
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_LINES = 20_000;
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_UNTRACKED_TEXT_BYTES = 1_000_000;
const DEFAULT_MAX_FILE_HASH_BYTES = 64 * 1024 * 1024;
const TEXT_FILE =
  /\.(?:astro|css|graphql|gql|html|jsx?|json|less|mdx?|sass|scss|svelte|tsx?|txt|vue|ya?ml)$/iu;

export type GitDeltaStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unmerged"
  | "restored"
  | "unknown";

export interface GitDeltaCaptureLimits {
  maxFiles?: number;
  maxLines?: number;
  maxBufferBytes?: number;
  maxUntrackedTextBytes?: number;
  maxFileHashBytes?: number;
}

export interface GitBaselineReference {
  schemaVersion: 1;
  handle: string;
  snapshotHash: string;
  capturedAt: string;
  head: string;
  checkoutId?: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  files: number;
  additions: number;
  deletions: number;
  renames: number;
  truncated: boolean;
  truncationReasons: string[];
}

export interface GitDeltaEntry {
  path: string;
  previousPath?: string;
  status: GitDeltaStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  additions: number;
  deletions: number;
}

export interface GitDeltaLine {
  kind: "addition" | "deletion";
  file: string;
  line: number;
  hash: string;
  text?: string;
}

export interface GitDeltaResult {
  schemaVersion: 1;
  deltaHash: string;
  baseline?: GitBaselineReference;
  head: string;
  headChanged: boolean;
  files: number;
  additions: number;
  deletions: number;
  renames: number;
  entries: GitDeltaEntry[];
  lines: GitDeltaLine[];
  truncated: boolean;
  truncationReasons: string[];
}

interface SnapshotEntry {
  path: string;
  previousPath?: string;
  status: Exclude<GitDeltaStatus, "restored">;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  contentHash?: string;
}

interface SnapshotLine extends GitDeltaLine {
  text: string;
}

interface CapturedSnapshot {
  head: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  entries: SnapshotEntry[];
  lines: SnapshotLine[];
  truncated: boolean;
  truncationReasons: string[];
}

type StoredSnapshotLine = Omit<GitDeltaLine, "text">;

interface StoredGitBaseline {
  schemaVersion: 1;
  taskId: string;
  capturedAt: string;
  rootPath: string;
  checkoutId?: string;
  head: string;
  indexFingerprint: string;
  worktreeFingerprint: string;
  entries: SnapshotEntry[];
  lines: StoredSnapshotLine[];
  truncated: boolean;
  truncationReasons: string[];
  handle: string;
  snapshotHash: string;
}

interface GitOutput {
  stdout: string;
  truncated: boolean;
}

interface EffectiveLimits {
  maxFiles: number;
  maxLines: number;
  maxBufferBytes: number;
  maxUntrackedTextBytes: number;
  maxFileHashBytes: number;
}

function limits(input: GitDeltaCaptureLimits = {}): EffectiveLimits {
  return {
    maxFiles: Math.max(1, Math.min(10_000, input.maxFiles ?? DEFAULT_MAX_FILES)),
    maxLines: Math.max(1, Math.min(100_000, input.maxLines ?? DEFAULT_MAX_LINES)),
    maxBufferBytes: Math.max(
      64 * 1024,
      Math.min(64 * 1024 * 1024, input.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES),
    ),
    maxUntrackedTextBytes: Math.max(
      1_024,
      Math.min(
        16 * 1024 * 1024,
        input.maxUntrackedTextBytes ?? DEFAULT_MAX_UNTRACKED_TEXT_BYTES,
      ),
    ),
    maxFileHashBytes: Math.max(
      1_024,
      Math.min(
        256 * 1024 * 1024,
        input.maxFileHashBytes ?? DEFAULT_MAX_FILE_HASH_BYTES,
      ),
    ),
  };
}

function slash(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function lineHash(text: string): string {
  return digest(text).slice(0, 16);
}

async function gitOutput(
  rootPath: string,
  args: string[],
  maxBuffer: number,
): Promise<GitOutput> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", ...args],
      {
        cwd: rootPath,
        encoding: "utf8",
        maxBuffer,
        timeout: 15_000,
        windowsHide: true,
      },
    );
    return { stdout, truncated: false };
  } catch (error) {
    const detail = error as Error & {
      code?: string;
      stdout?: string | Buffer;
    };
    if (detail.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return {
        stdout:
          typeof detail.stdout === "string"
            ? detail.stdout
            : detail.stdout?.toString("utf8") ?? "",
        truncated: true,
      };
    }
    throw error;
  }
}

async function gitHead(rootPath: string): Promise<string> {
  try {
    return (
      await gitOutput(
        rootPath,
        ["rev-parse", "--verify", "HEAD"],
        128 * 1024,
      )
    ).stdout.trim();
  } catch {
    return "unborn";
  }
}

interface InspectedRepositoryFile {
  absolutePath: string;
  size: number;
}

function containedPath(rootPath: string, candidate: string): boolean {
  const relative = path.relative(rootPath, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function inspectRepositoryFile(
  rootPath: string,
  resolvedRootPath: string,
  relativePath: string,
): Promise<{ file?: InspectedRepositoryFile; reason?: string }> {
  const absolutePath = path.resolve(rootPath, relativePath);
  if (!containedPath(rootPath, absolutePath)) return { reason: "external-path" };
  try {
    const segments = path.relative(rootPath, absolutePath).split(path.sep).filter(Boolean);
    let cursor = rootPath;
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      const detail = await lstat(cursor);
      if (detail.isSymbolicLink()) return { reason: "symlink-path" };
    }
    const detail = await lstat(absolutePath);
    if (!detail.isFile()) return { reason: "unsupported-file-type" };
    const resolved = await realpath(absolutePath);
    if (!containedPath(resolvedRootPath, resolved)) {
      return { reason: "external-realpath" };
    }
    return { file: { absolutePath: resolved, size: detail.size } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function hashInspectedFile(
  file: InspectedRepositoryFile,
  maximumBytes: number,
): Promise<string | undefined> {
  if (file.size > maximumBytes) return undefined;
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file.absolutePath)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (bytes > maximumBytes) return undefined;
    hash.update(buffer);
  }
  return hash.digest("hex");
}

async function readInspectedText(
  file: InspectedRepositoryFile,
  maximumBytes: number,
): Promise<string | undefined> {
  if (file.size > maximumBytes) return undefined;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of createReadStream(file.absolutePath)) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (bytes > maximumBytes) return undefined;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function statusFromCode(code: string): Exclude<GitDeltaStatus, "restored"> {
  switch (code[0]) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

function parseNameStatus(source: string): SnapshotEntry[] {
  const fields = source.split("\0");
  const entries: SnapshotEntry[] = [];
  let index = 0;
  while (index < fields.length) {
    const code = fields[index++];
    if (!code) continue;
    const status = statusFromCode(code);
    if (status === "renamed" || status === "copied") {
      const previousPath = fields[index++];
      const nextPath = fields[index++];
      if (!previousPath || !nextPath) break;
      entries.push({
        path: slash(nextPath),
        previousPath: slash(previousPath),
        status,
        staged: false,
        unstaged: false,
        untracked: false,
      });
      continue;
    }
    const file = fields[index++];
    if (!file) break;
    entries.push({
      path: slash(file),
      status,
      staged: false,
      unstaged: false,
      untracked: false,
    });
  }
  return entries;
}

function decodePatchPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return undefined;
  const unquoted =
    trimmed.startsWith("\"") && trimmed.endsWith("\"")
      ? trimmed.slice(1, -1).replaceAll("\\\"", "\"")
      : trimmed;
  return slash(unquoted.replace(/^[ab]\//u, ""));
}

function parsePatch(source: string): SnapshotLine[] {
  const records: SnapshotLine[] = [];
  let previousFile: string | undefined;
  let nextFile: string | undefined;
  let previousLine = 0;
  let nextLine = 0;
  let inHunk = false;
  for (const value of source.split(/\r?\n/u)) {
    if (value.startsWith("--- ")) {
      previousFile = decodePatchPath(value.slice(4));
      inHunk = false;
      continue;
    }
    if (value.startsWith("+++ ")) {
      nextFile = decodePatchPath(value.slice(4));
      inHunk = false;
      continue;
    }
    const hunk = value.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u,
    );
    if (hunk) {
      previousLine = Number(hunk[1]);
      nextLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || value.startsWith("\\ No newline")) continue;
    if (value.startsWith("-") && !value.startsWith("---")) {
      if (previousFile) {
        const text = value.slice(1);
        records.push({
          kind: "deletion",
          file: previousFile,
          line: previousLine,
          hash: lineHash(text),
          text,
        });
      }
      previousLine += 1;
      continue;
    }
    if (value.startsWith("+") && !value.startsWith("+++")) {
      if (nextFile) {
        const text = value.slice(1);
        records.push({
          kind: "addition",
          file: nextFile,
          line: nextLine,
          hash: lineHash(text),
          text,
        });
      }
      nextLine += 1;
      continue;
    }
    previousLine += 1;
    nextLine += 1;
  }
  return records;
}

function pathSet(source: string): Set<string> {
  return new Set(source.split("\0").filter(Boolean).map(slash));
}

function entryIdentity(entry: Pick<SnapshotEntry, "path" | "previousPath">): string {
  return `${entry.previousPath ?? ""}\0${entry.path}`;
}

function entryContentIdentity(entry: SnapshotEntry): string {
  return JSON.stringify({
    path: entry.path,
    ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
    status: entry.status,
    contentHash: entry.contentHash ?? "",
  });
}

function mergeLayerEntries(
  stagedLayer: SnapshotEntry[],
  unstagedLayer: SnapshotEntry[],
): SnapshotEntry[] {
  const entries = [...stagedLayer];
  for (const incoming of unstagedLayer) {
    const existingIndex = entries.findIndex((entry) => {
      const existingPaths = new Set([entry.path, entry.previousPath].filter(Boolean));
      return (
        existingPaths.has(incoming.path) ||
        Boolean(incoming.previousPath && existingPaths.has(incoming.previousPath))
      );
    });
    if (existingIndex < 0) {
      entries.push(incoming);
      continue;
    }
    const existing = entries[existingIndex]!;
    const structural = new Set(["renamed", "copied"]);
    const preferIncoming =
      structural.has(incoming.status) ||
      (!structural.has(existing.status) &&
        ["deleted", "type-changed", "unmerged"].includes(incoming.status));
    const preferred = preferIncoming ? incoming : existing;
    const previousPath = existing.previousPath ?? incoming.previousPath;
    entries[existingIndex] = {
      ...preferred,
      ...(previousPath ? { previousPath } : {}),
      staged: existing.staged || incoming.staged,
      unstaged: existing.unstaged || incoming.unstaged,
      untracked: existing.untracked || incoming.untracked,
    };
  }
  return entries;
}

async function ignoredRepositoryPrefixes(rootPath: string): Promise<string[]> {
  const prefixes = [".component-atlas"];
  const identity = await resolveProjectIdentity(rootPath);
  for (const storagePath of [
    projectAtlasStorageRoot(),
    projectStorageDirectory(identity.logicalId),
  ]) {
    const relativeStorage = slash(path.relative(rootPath, storagePath));
    if (
      relativeStorage &&
      relativeStorage !== ".." &&
      !relativeStorage.startsWith("../") &&
      !path.isAbsolute(relativeStorage)
    ) {
      prefixes.push(relativeStorage);
    }
  }
  return [...new Set(prefixes)];
}

function ignoredRepositoryPath(file: string, prefixes: string[]): boolean {
  const normalized = slash(file);
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function worktreeFingerprint(
  entries: SnapshotEntry[],
  lines: Array<Pick<GitDeltaLine, "kind" | "file" | "hash">>,
): string {
  return digest(
    JSON.stringify({
      entries: entries
        .map(entryContentIdentity)
        .sort((left, right) => left.localeCompare(right)),
      lines: lines
        .map((line) => `${line.kind}\0${line.file}\0${line.hash}`)
        .sort((left, right) => left.localeCompare(right)),
    }),
  );
}

async function capturedSnapshot(
  rootPath: string,
  baseHead: string,
  captureLimits: GitDeltaCaptureLimits = {},
): Promise<CapturedSnapshot> {
  const effective = limits(captureLimits);
  const truncationReasons = new Set<string>();
  const ignoredPrefixes = await ignoredRepositoryPrefixes(rootPath);
  const resolvedRootPath = await realpath(rootPath);
  const head = await gitHead(rootPath);
  const index = await gitOutput(
    rootPath,
    ["ls-files", "--stage", "-z"],
    effective.maxBufferBytes,
  );
  if (index.truncated) truncationReasons.add("index-output");

  const stagedBase = baseHead === "unborn" ? [] : [baseHead];
  const [
    stagedNames,
    stagedPatch,
    unstagedNames,
    unstagedPatch,
    stagedOutput,
    unstagedOutput,
    untrackedOutput,
  ] = await Promise.all([
    gitOutput(
      rootPath,
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--find-renames",
        "--name-status",
        "-z",
        ...stagedBase,
        "--",
        ".",
      ],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--find-renames",
        "--unified=0",
        "--no-color",
        ...stagedBase,
        "--",
        ".",
      ],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      ["diff", "--no-ext-diff", "--find-renames", "--name-status", "-z", "--", "."],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      [
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "--unified=0",
        "--no-color",
        "--",
        ".",
      ],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      ["diff", "--cached", "--name-only", "-z", "--", "."],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      ["diff", "--name-only", "-z", "--", "."],
      effective.maxBufferBytes,
    ),
    gitOutput(
      rootPath,
      ["ls-files", "--others", "--exclude-standard", "-z"],
      effective.maxBufferBytes,
    ),
  ]);
  if (stagedNames.truncated) truncationReasons.add("staged-name-status-output");
  if (stagedPatch.truncated) truncationReasons.add("staged-patch-output");
  if (unstagedNames.truncated) truncationReasons.add("unstaged-name-status-output");
  if (unstagedPatch.truncated) truncationReasons.add("unstaged-patch-output");
  if (stagedOutput.truncated) truncationReasons.add("staged-output");
  if (unstagedOutput.truncated) truncationReasons.add("unstaged-output");
  if (untrackedOutput.truncated) truncationReasons.add("untracked-output");
  const staged = pathSet(stagedOutput.stdout);
  const unstaged = pathSet(unstagedOutput.stdout);
  const untracked = [...pathSet(untrackedOutput.stdout)]
    .filter((file) => !ignoredRepositoryPath(file, ignoredPrefixes))
    .sort();

  const includeEntry = (entry: SnapshotEntry): boolean =>
    !ignoredRepositoryPath(entry.path, ignoredPrefixes) &&
    !(
      entry.previousPath &&
      ignoredRepositoryPath(entry.previousPath, ignoredPrefixes)
    );
  let entries = mergeLayerEntries(
    parseNameStatus(stagedNames.stdout)
      .filter(includeEntry)
      .map((entry) => ({ ...entry, staged: true })),
    parseNameStatus(unstagedNames.stdout)
      .filter(includeEntry)
      .map((entry) => ({ ...entry, unstaged: true })),
  );
  let patchLines = [
    ...parsePatch(stagedPatch.stdout),
    ...parsePatch(unstagedPatch.stdout),
  ].filter((line) => !ignoredRepositoryPath(line.file, ignoredPrefixes));

  const existingPaths = new Set(entries.map((entry) => entry.path));
  for (const file of untracked) {
    if (existingPaths.has(file)) {
      entries = entries.map((entry) =>
        entry.path === file ? { ...entry, untracked: true } : entry,
      );
      continue;
    }
    entries.push({
      path: file,
      status: "added",
      staged: false,
      unstaged: false,
      untracked: true,
    });
  }
  entries = entries.map((entry) => ({
    ...entry,
    staged: staged.has(entry.path) || Boolean(entry.previousPath && staged.has(entry.previousPath)),
    unstaged:
      unstaged.has(entry.path) ||
      Boolean(entry.previousPath && unstaged.has(entry.previousPath)),
  }));
  entries.sort((left, right) => left.path.localeCompare(right.path));
  if (entries.length > effective.maxFiles) {
    entries = entries.slice(0, effective.maxFiles);
    truncationReasons.add("file-limit");
  }
  const retainedPaths = new Set(
    entries.flatMap((entry) => [entry.path, ...(entry.previousPath ? [entry.previousPath] : [])]),
  );
  patchLines = patchLines.filter((line) => retainedPaths.has(line.file));

  const inspectedFiles = new Map<string, InspectedRepositoryFile>();
  for (const entry of entries) {
    let inspected: InspectedRepositoryFile | undefined;
    if (entry.status !== "deleted") {
      const inspection = await inspectRepositoryFile(
        rootPath,
        resolvedRootPath,
        entry.path,
      );
      if (inspection.reason) {
        truncationReasons.add(inspection.reason);
        continue;
      }
      inspected = inspection.file;
      if (inspected) inspectedFiles.set(entry.path, inspected);
      const contentHash = inspected
        ? await hashInspectedFile(inspected, effective.maxFileHashBytes)
        : undefined;
      if (inspected && !contentHash) truncationReasons.add("file-hash-size");
      if (contentHash) entry.contentHash = contentHash;
    }
    if (!entry.untracked || !TEXT_FILE.test(entry.path)) continue;
    inspected ??= inspectedFiles.get(entry.path);
    if (!inspected) continue;
    if (inspected.size > effective.maxUntrackedTextBytes) {
      truncationReasons.add("untracked-text-size");
      continue;
    }
    const source = await readInspectedText(
      inspected,
      effective.maxUntrackedTextBytes,
    );
    if (source === undefined) {
      truncationReasons.add("untracked-text-size");
      continue;
    }
    if (source.includes("\0")) continue;
    source.split(/\r?\n/u).forEach((text, line) => {
      patchLines.push({
        kind: "addition",
        file: entry.path,
        line: line + 1,
        hash: lineHash(text),
        text,
      });
    });
  }
  if (patchLines.length > effective.maxLines) {
    patchLines = patchLines.slice(0, effective.maxLines);
    truncationReasons.add("line-limit");
  }
  return {
    head,
    indexFingerprint: digest(index.stdout),
    worktreeFingerprint: worktreeFingerprint(entries, patchLines),
    entries,
    lines: patchLines,
    truncated: truncationReasons.size > 0,
    truncationReasons: [...truncationReasons].sort(),
  };
}

async function baselineDirectory(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "git-baselines",
  );
}

function baselineFileName(handle: string): string {
  return `${digest(handle).slice(0, 32)}.json`;
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function storedSnapshotHash(
  snapshot: Omit<StoredGitBaseline, "handle" | "snapshotHash">,
): string {
  return digest(JSON.stringify(snapshot));
}

function baselineSummary(
  stored: StoredGitBaseline,
): GitBaselineReference {
  return {
    schemaVersion: 1,
    handle: stored.handle,
    snapshotHash: stored.snapshotHash,
    capturedAt: stored.capturedAt,
    head: stored.head,
    ...(stored.checkoutId ? { checkoutId: stored.checkoutId } : {}),
    indexFingerprint: stored.indexFingerprint,
    worktreeFingerprint: stored.worktreeFingerprint,
    files: stored.entries.length,
    additions: stored.lines.filter((line) => line.kind === "addition").length,
    deletions: stored.lines.filter((line) => line.kind === "deletion").length,
    renames: stored.entries.filter((entry) => entry.status === "renamed").length,
    truncated: stored.truncated,
    truncationReasons: stored.truncationReasons,
  };
}

export async function captureGitBaseline(
  rootPathInput: string,
  input: {
    taskId: string;
    at?: string;
    limits?: GitDeltaCaptureLimits;
  },
): Promise<GitBaselineReference> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Task ID is invalid.");
  const rootPath = path.resolve(rootPathInput);
  const identity = await resolveProjectIdentity(rootPath);
  const head = await gitHead(rootPath);
  const snapshot = await capturedSnapshot(rootPath, head, input.limits);
  const storedBase = {
    schemaVersion: 1 as const,
    taskId: input.taskId,
    capturedAt: input.at ?? new Date().toISOString(),
    rootPath,
    ...(identity.checkoutId ? { checkoutId: identity.checkoutId } : {}),
    head: snapshot.head,
    indexFingerprint: snapshot.indexFingerprint,
    worktreeFingerprint: snapshot.worktreeFingerprint,
    entries: snapshot.entries,
    lines: snapshot.lines.map(({ text: _text, ...line }) => line),
    truncated: snapshot.truncated,
    truncationReasons: snapshot.truncationReasons,
  } satisfies Omit<StoredGitBaseline, "handle" | "snapshotHash">;
  const snapshotHash = storedSnapshotHash(storedBase);
  const handle = `git-baseline:${input.taskId}:${snapshotHash.slice(0, 16)}`;
  const stored: StoredGitBaseline = { ...storedBase, handle, snapshotHash };
  const directory = await baselineDirectory(rootPath);
  await mkdir(directory, { recursive: true });
  await atomicJson(path.join(directory, baselineFileName(handle)), stored);
  return baselineSummary(stored);
}

async function loadGitBaseline(
  rootPath: string,
  reference: GitBaselineReference,
): Promise<StoredGitBaseline> {
  if (!BASELINE_HANDLE.test(reference.handle)) {
    throw new Error("Git baseline handle is invalid.");
  }
  const source = await readFile(
    path.join(await baselineDirectory(rootPath), baselineFileName(reference.handle)),
    "utf8",
  );
  const stored = JSON.parse(source) as StoredGitBaseline;
  if (
    stored.schemaVersion !== 1 ||
    stored.handle !== reference.handle ||
    stored.snapshotHash !== reference.snapshotHash ||
    !Array.isArray(stored.entries) ||
    !Array.isArray(stored.lines)
  ) {
    throw new Error("Git baseline artifact is invalid.");
  }
  const { handle: _handle, snapshotHash: _snapshotHash, ...hashable } = stored;
  if (storedSnapshotHash(hashable) !== stored.snapshotHash) {
    throw new Error("Git baseline artifact hash does not match its contents.");
  }
  const sameRoot =
    process.platform === "win32"
      ? path.resolve(stored.rootPath).toLowerCase() === rootPath.toLowerCase()
      : path.resolve(stored.rootPath) === rootPath;
  const identity = await resolveProjectIdentity(rootPath);
  if (
    !sameRoot ||
    (stored.checkoutId ?? undefined) !== (identity.checkoutId ?? undefined)
  ) {
    throw new Error("Git baseline artifact does not belong to this repository checkout.");
  }
  return stored;
}

function lineIdentity(line: Pick<GitDeltaLine, "kind" | "file" | "hash">): string {
  return `${line.kind}\0${line.file}\0${line.hash}`;
}

function comparedLines(
  baseline: StoredSnapshotLine[],
  current: SnapshotLine[],
): GitDeltaLine[] {
  const baselineBuckets = new Map<string, StoredSnapshotLine[]>();
  for (const line of baseline) {
    const key = lineIdentity(line);
    const bucket = baselineBuckets.get(key) ?? [];
    bucket.push(line);
    baselineBuckets.set(key, bucket);
  }
  const result: GitDeltaLine[] = [];
  for (const line of current) {
    const key = lineIdentity(line);
    const bucket = baselineBuckets.get(key);
    if (bucket?.length) {
      bucket.pop();
      continue;
    }
    result.push(line);
  }
  for (const bucket of baselineBuckets.values()) {
    for (const line of bucket) {
      result.push({
        kind: line.kind === "addition" ? "deletion" : "addition",
        file: line.file,
        line: line.line,
        hash: line.hash,
      });
    }
  }
  return result.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.kind.localeCompare(right.kind),
  );
}

function deltaEntries(
  baseline: SnapshotEntry[],
  current: SnapshotEntry[],
): Array<Omit<GitDeltaEntry, "additions" | "deletions">> {
  const byIdentity = new Map(
    baseline.map((entry) => [entryIdentity(entry), entry]),
  );
  const byPath = new Map(baseline.map((entry) => [entry.path, entry]));
  const consumed = new Set<SnapshotEntry>();
  const result: Array<Omit<GitDeltaEntry, "additions" | "deletions">> = [];
  for (const entry of current) {
    const prior =
      byIdentity.get(entryIdentity(entry)) ??
      byPath.get(entry.path) ??
      (entry.previousPath ? byPath.get(entry.previousPath) : undefined);
    if (prior) consumed.add(prior);
    if (prior && entryContentIdentity(prior) === entryContentIdentity(entry)) {
      continue;
    }
    result.push({
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      status: entry.status,
      staged: entry.staged,
      unstaged: entry.unstaged,
      untracked: entry.untracked,
    });
  }
  for (const entry of baseline) {
    if (consumed.has(entry)) continue;
    result.push({
      path: entry.path,
      ...(entry.previousPath ? { previousPath: entry.previousPath } : {}),
      status: "restored",
      staged: false,
      unstaged: false,
      untracked: false,
    });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function attachLineCounts(
  entries: Array<Omit<GitDeltaEntry, "additions" | "deletions">>,
  lines: GitDeltaLine[],
): GitDeltaEntry[] {
  return entries.map((entry) => {
    const paths = new Set([
      entry.path,
      ...(entry.previousPath ? [entry.previousPath] : []),
    ]);
    return {
      ...entry,
      additions: lines.filter(
        (line) => line.kind === "addition" && paths.has(line.file),
      ).length,
      deletions: lines.filter(
        (line) => line.kind === "deletion" && paths.has(line.file),
      ).length,
    };
  });
}

function resultFromSnapshot(snapshot: CapturedSnapshot): GitDeltaResult {
  const entries = attachLineCounts(
    snapshot.entries.map(({ contentHash: _contentHash, ...entry }) => entry),
    snapshot.lines,
  );
  return {
    schemaVersion: 1,
    deltaHash: digest(
      JSON.stringify({
        head: snapshot.head,
        index: snapshot.indexFingerprint,
        worktree: snapshot.worktreeFingerprint,
      }),
    ),
    head: snapshot.head,
    headChanged: false,
    files: entries.length,
    additions: snapshot.lines.filter((line) => line.kind === "addition").length,
    deletions: snapshot.lines.filter((line) => line.kind === "deletion").length,
    renames: entries.filter((entry) => entry.status === "renamed").length,
    entries,
    lines: snapshot.lines,
    truncated: snapshot.truncated,
    truncationReasons: snapshot.truncationReasons,
  };
}

export async function captureGitDelta(
  rootPathInput: string,
  captureLimits: GitDeltaCaptureLimits = {},
): Promise<GitDeltaResult> {
  const rootPath = path.resolve(rootPathInput);
  const head = await gitHead(rootPath);
  return resultFromSnapshot(
    await capturedSnapshot(rootPath, head, captureLimits),
  );
}

export async function compareGitDelta(
  rootPathInput: string,
  baseline: GitBaselineReference,
  captureLimits: GitDeltaCaptureLimits = {},
): Promise<GitDeltaResult> {
  const rootPath = path.resolve(rootPathInput);
  const stored = await loadGitBaseline(rootPath, baseline);
  const current = await capturedSnapshot(rootPath, stored.head, captureLimits);
  const lines = comparedLines(stored.lines, current.lines);
  const entries = attachLineCounts(
    deltaEntries(stored.entries, current.entries),
    lines,
  );
  const truncationReasons = [
    ...new Set([
      ...stored.truncationReasons.map((reason) => `baseline:${reason}`),
      ...current.truncationReasons.map((reason) => `current:${reason}`),
    ]),
  ].sort();
  return {
    schemaVersion: 1,
    deltaHash: digest(
      JSON.stringify({
        baseline: stored.snapshotHash,
        head: current.head,
        index: current.indexFingerprint,
        worktree: current.worktreeFingerprint,
      }),
    ),
    baseline,
    head: current.head,
    headChanged: current.head !== stored.head,
    files: entries.length,
    additions: lines.filter((line) => line.kind === "addition").length,
    deletions: lines.filter((line) => line.kind === "deletion").length,
    renames: entries.filter((entry) => entry.status === "renamed").length,
    entries,
    lines,
    truncated: stored.truncated || current.truncated,
    truncationReasons,
  };
}
