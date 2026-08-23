import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

/** Limits for source discovery. They deliberately bound untrusted checkouts. */
export const DEFAULT_SCAN_MAX_FILES = 10_000;
export const DEFAULT_SCAN_MAX_FILE_BYTES = 1_024 * 1_024;
export const DEFAULT_SCAN_MAX_TOTAL_BYTES = 32 * 1_024 * 1_024;

export interface ScanSafetyLimits {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export class ScanSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanSafetyError";
  }
}

interface ResolvedLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

function limits(input?: ScanSafetyLimits): ResolvedLimits {
  return {
    maxFiles: input?.maxFiles ?? DEFAULT_SCAN_MAX_FILES,
    maxFileBytes: input?.maxFileBytes ?? DEFAULT_SCAN_MAX_FILE_BYTES,
    maxTotalBytes: input?.maxTotalBytes ?? DEFAULT_SCAN_MAX_TOTAL_BYTES,
  };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateFile(
  root: string,
  candidate: string,
  configured: ResolvedLimits,
): Promise<{ path: string; bytes: number }> {
  const absolute = path.resolve(candidate);
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink()) {
    throw new ScanSafetyError(`Scan refuses symbolic-link source: ${absolute}`);
  }
  if (!metadata.isFile()) {
    throw new ScanSafetyError(`Scan candidate is not a regular file: ${absolute}`);
  }
  const canonical = await realpath(absolute);
  if (!isWithin(root, canonical)) {
    throw new ScanSafetyError(`Scan source resolves outside project root: ${absolute}`);
  }
  if (metadata.size > configured.maxFileBytes) {
    throw new ScanSafetyError(
      `Scan source exceeds ${configured.maxFileBytes} byte file limit: ${absolute}`,
    );
  }
  return { path: absolute, bytes: metadata.size };
}

/**
 * One scan session owns a single file and byte budget. Use it for every read
 * made by a scan, including helper/test/import discovery. Discovery validates
 * candidates but does not reserve their old stat sizes: bytes are charged while
 * data is read, so growth after globbing cannot bypass limits.
 */
export class ScanSafetySession {
  readonly rootPath: string;
  readonly configured: ResolvedLimits;
  #files = new Set<string>();
  #totalBytes = 0;

  constructor(rootPath: string, configured: ResolvedLimits) {
    this.rootPath = rootPath;
    this.configured = configured;
  }

  get filesRead(): number {
    return this.#files.size;
  }

  get bytesRead(): number {
    return this.#totalBytes;
  }

  #claimFile(filePath: string): void {
    if (this.#files.has(filePath)) return;
    if (this.#files.size >= this.configured.maxFiles) {
      throw new ScanSafetyError(
        `Scan read exceeds ${this.configured.maxFiles} file limit.`,
      );
    }
    this.#files.add(filePath);
  }

  #claimBytes(amount: number, filePath: string): void {
    if (amount <= 0) return;
    if (this.#totalBytes + amount > this.configured.maxTotalBytes) {
      throw new ScanSafetyError(
        `Scan read exceeds ${this.configured.maxTotalBytes} byte total limit: ${filePath}`,
      );
    }
    this.#totalBytes += amount;
  }

  async files(candidates: Iterable<string>): Promise<string[]> {
    const ordered = [
      ...new Set(
        [...candidates].map((candidate) => path.resolve(this.rootPath, candidate)),
      ),
    ].sort((left, right) => left.localeCompare(right));
    if (ordered.length > this.configured.maxFiles) {
      throw new ScanSafetyError(
        `Scan discovery exceeds ${this.configured.maxFiles} file limit (${ordered.length} found).`,
      );
    }
    let discoveredBytes = 0;
    for (const candidate of ordered) {
      const checked = await validateFile(this.rootPath, candidate, this.configured);
      discoveredBytes += checked.bytes;
      if (discoveredBytes > this.configured.maxTotalBytes) {
        throw new ScanSafetyError(
          `Scan discovery exceeds ${this.configured.maxTotalBytes} byte total limit.`,
        );
      }
    }
    return ordered;
  }

  async readText(filePath: string): Promise<string> {
    const checked = await validateFile(
      this.rootPath,
      path.resolve(this.rootPath, filePath),
      this.configured,
    );
    this.#claimFile(checked.path);
    const handle = await open(checked.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const canonical = await realpath(checked.path);
      if (!isWithin(this.rootPath, canonical)) {
        throw new ScanSafetyError(
          `Scan source resolves outside project root while being read: ${checked.path}`,
        );
      }
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > this.configured.maxFileBytes) {
        throw new ScanSafetyError(`Scan source changed while being read: ${checked.path}`);
      }
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      while (true) {
        const remainingFile = this.configured.maxFileBytes - fileBytes;
        const remainingTotal = this.configured.maxTotalBytes - this.#totalBytes;
        if (remainingFile <= 0 || remainingTotal <= 0) {
          const probe = Buffer.allocUnsafe(1);
          const { bytesRead } = await handle.read(probe, 0, 1, fileBytes);
          if (bytesRead > 0) {
            const limit = remainingTotal <= 0 ? "total limit" : "file limit";
            throw new ScanSafetyError(`Scan source exceeded ${limit}: ${checked.path}`);
          }
          break;
        }
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remainingFile, remainingTotal));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, fileBytes);
        if (bytesRead === 0) break;
        this.#claimBytes(bytesRead, checked.path);
        fileBytes += bytesRead;
        chunks.push(buffer.subarray(0, bytesRead));
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      await handle.close();
    }
  }
}

export async function createScanSafetySession(
  rootPath: string,
  input?: ScanSafetyLimits,
): Promise<ScanSafetySession> {
  return new ScanSafetySession(await realpath(path.resolve(rootPath)), limits(input));
}

export async function safeScanFiles(
  rootPath: string,
  candidates: Iterable<string>,
  input?: ScanSafetyLimits,
  session?: ScanSafetySession,
): Promise<string[]> {
  const active = session ?? (await createScanSafetySession(rootPath, input));
  return active.files(candidates);
}

/** Read a source file after rechecking identity, size, and the shared budget. */
export async function readSafeScanText(
  rootPath: string,
  filePath: string,
  input?: ScanSafetyLimits,
  session?: ScanSafetySession,
): Promise<string> {
  const active = session ?? (await createScanSafetySession(rootPath, input));
  return active.readText(filePath);
}
