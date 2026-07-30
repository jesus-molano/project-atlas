import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import {
  assertSourceReceiptMatchesDecision,
  type SourceReceipt,
} from "@component-atlas/core";
import { projectAtlasTempRoot } from "@component-atlas/store";
import {
  loadConfirmedTaskSourceDecision,
  loadPersistedSourceReceipt,
} from "./task-state.js";

const ASSET_SCHEMA_VERSION = 1 as const;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const HANDLE =
  /^figma-asset:([A-Za-z0-9_.:-]{1,160}):([a-f0-9]{24})$/u;
const MAX_SVG_BYTES = 512_000;
const MAX_RASTER_BYTES = 5_000_000;
const DEFAULT_TTL_MS = 60 * 60 * 1_000;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;

export type FigmaAssetFormat = "svg" | "png" | "jpg" | "webp";

export interface FigmaAssetMetadata {
  schemaVersion: typeof ASSET_SCHEMA_VERSION;
  handle: string;
  taskId: string;
  sourceReceiptId: string;
  fileKey: string;
  scopeNodeId: string;
  assetNodeId?: string;
  fileName: string;
  format: FigmaAssetFormat;
  mediaType: string;
  bytes: number;
  contentHash: string;
  createdAt: string;
  expiresAt: string;
  ephemeral: true;
}

export interface LoadedFigmaAsset {
  body: Buffer;
  contentType?: string;
}

export type FigmaAssetLoader = (
  sourceUrl: string,
  maximumBytes: number,
) => Promise<LoadedFigmaAsset>;

function checkedTaskId(taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  return taskId;
}

function checkedAssetUrl(sourceUrl: string): URL {
  const url = new URL(sourceUrl);
  const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error("Figma Desktop asset URL path is invalid.");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    url.port !== "3845" ||
    !decodedPath.startsWith("/assets/") ||
    decodedPath === "/assets/" ||
    decodedPath.includes("\\") ||
    decodedPath.split("/").includes("..") ||
    path.posix.normalize(decodedPath) !== decodedPath ||
    /%(?:2f|5c)/iu.test(url.pathname) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Figma assets must come from the local Desktop MCP asset route.",
    );
  }
  return url;
}

function checkedFigmaMcpRoute(route: string): void {
  const url = new URL(route);
  const host = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    url.port !== "3845" ||
    url.pathname !== "/mcp" ||
    url.username ||
    url.password
  ) {
    throw new Error("Figma source receipt is not linked to Desktop MCP local.");
  }
}

export function assertFigmaDesktopAssetUrl(sourceUrl: string): void {
  checkedAssetUrl(sourceUrl);
}

async function responseBytes(
  sourceUrl: string,
  maximumBytes: number,
): Promise<LoadedFigmaAsset> {
  const url = checkedAssetUrl(sourceUrl);
  return new Promise((resolve, reject) => {
    const operation = request(
      {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: 3845,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          accept: "image/svg+xml,image/png,image/jpeg,image/webp",
          host: url.host,
          "user-agent": "ProjectAtlas/0.1 Figma asset capture",
        },
        signal: AbortSignal.timeout(8_000),
      },
      (response) => {
        if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
          response.destroy();
          reject(new Error("Figma asset redirects are not allowed."));
          return;
        }
        if (response.statusCode !== 200) {
          response.destroy();
          reject(
            new Error(`Figma Desktop asset returned HTTP ${response.statusCode ?? 0}.`),
          );
          return;
        }
        const length = Number(response.headers["content-length"] ?? 0);
        if (length > maximumBytes) {
          response.destroy();
          reject(new Error("Figma asset exceeds the maximum allowed size."));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > maximumBytes) {
            response.destroy(
              new Error("Figma asset exceeds the maximum allowed size."),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.once("end", () =>
          resolve({
            body: Buffer.concat(chunks, total),
            ...(typeof response.headers["content-type"] === "string"
              ? { contentType: response.headers["content-type"] }
              : {}),
          }),
        );
        response.once("error", reject);
      },
    );
    operation.once("error", reject);
    operation.end();
  });
}

function inspectAsset(
  body: Buffer,
  contentType?: string,
): { format: FigmaAssetFormat; mediaType: string } {
  if (
    /(?:localhost|127\.0\.0\.1|\[?::1\]?):3845/iu.test(
      body.toString("latin1"),
    )
  ) {
    throw new Error("Figma asset contains a local Desktop endpoint.");
  }
  const declared = contentType?.split(";")[0]?.trim().toLowerCase();
  let format: FigmaAssetFormat | undefined;
  if (
    body.length >= 12 &&
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    format = "webp";
  } else if (
    body.length >= 8 &&
    body.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    format = "png";
  } else if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  ) {
    format = "jpg";
  } else {
    const source = body.toString("utf8").replace(/^\uFEFF/u, "").trimStart();
    if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/iu.test(source)) {
      if (
        /<!DOCTYPE|<!ENTITY|<(?:script|foreignObject)\b/iu.test(source) ||
        /\son[a-z]+\s*=/iu.test(source) ||
        /(?:href|src)\s*=\s*["']\s*(?!#)[^"']+/iu.test(source) ||
        /url\(\s*["']?\s*(?!#)[^)]+/iu.test(source) ||
        /@import\b/iu.test(source) ||
        /(?:localhost|127\.0\.0\.1|\[?::1\]?):3845/iu.test(source)
      ) {
        throw new Error("Figma SVG contains active or external content.");
      }
      format = "svg";
    }
  }
  if (!format) throw new Error("Figma asset format is unsupported or invalid.");
  const maximum = format === "svg" ? MAX_SVG_BYTES : MAX_RASTER_BYTES;
  if (body.length === 0 || body.length > maximum) {
    throw new Error("Figma asset exceeds the maximum allowed size.");
  }
  const mediaType =
    format === "svg"
      ? "image/svg+xml"
      : format === "png"
        ? "image/png"
        : format === "jpg"
          ? "image/jpeg"
          : "image/webp";
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== mediaType
  ) {
    throw new Error("Figma asset content type does not match its bytes.");
  }
  return { format, mediaType };
}

function safeFileName(value: string | undefined, format: FigmaAssetFormat): string {
  const base = path
    .basename(value?.trim() || `figma-asset.${format}`)
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .slice(0, 120);
  const stem = path.basename(base, path.extname(base)) || "figma-asset";
  return `${stem}.${format}`;
}

function taskDirectoryName(taskId: string): string {
  checkedTaskId(taskId);
  return `task-${createHash("sha256").update(taskId).digest("hex").slice(0, 20)}`;
}

function assetRoot(taskId: string): string {
  return path.join(projectAtlasTempRoot(), "assets", taskDirectoryName(taskId));
}

function metadataPath(taskId: string, shortHash: string): string {
  return path.join(assetRoot(taskId), `${shortHash}.json`);
}

function assetPath(
  taskId: string,
  shortHash: string,
  format: FigmaAssetFormat,
): string {
  return path.join(assetRoot(taskId), `${shortHash}.${format}`);
}

function parseMetadata(value: unknown, expectedHandle?: string): FigmaAssetMetadata {
  const metadata = value as FigmaAssetMetadata;
  if (
    !metadata ||
    metadata.schemaVersion !== ASSET_SCHEMA_VERSION ||
    metadata.ephemeral !== true ||
    !HANDLE.test(metadata.handle) ||
    (expectedHandle && metadata.handle !== expectedHandle) ||
    !TASK_ID.test(metadata.taskId) ||
    !RECEIPT_ID.test(metadata.sourceReceiptId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(metadata.contentHash) ||
    !["svg", "png", "jpg", "webp"].includes(metadata.format) ||
    !Number.isInteger(metadata.bytes) ||
    metadata.bytes < 1 ||
    !Number.isFinite(Date.parse(metadata.expiresAt))
  ) {
    throw new Error("Figma asset metadata is invalid.");
  }
  return metadata;
}

function authorizedScope(receipt: SourceReceipt, scopeNodeId: string): boolean {
  return new Set(
    [
      receipt.requested.nodeId,
      receipt.resolved.nodeId,
      receipt.scope.id,
      receipt.scope.parentId,
      receipt.scopeRelation?.sourceId,
      receipt.scopeRelation?.targetId,
      ...(receipt.scopeRelation?.ancestorIds ?? []),
    ].filter((item): item is string => Boolean(item)),
  ).has(scopeNodeId);
}

export async function captureFigmaAsset(
  input: {
    rootPath: string;
    taskId: string;
    sourceReceiptId: string;
    sourceUrl: string;
    scopeNodeId: string;
    assetNodeId?: string;
    fileName?: string;
    ttlMs?: number;
    at?: string;
  },
  load: FigmaAssetLoader = responseBytes,
): Promise<FigmaAssetMetadata> {
  checkedTaskId(input.taskId);
  if (!RECEIPT_ID.test(input.sourceReceiptId)) {
    throw new Error("Source receipt ID is invalid.");
  }
  assertFigmaDesktopAssetUrl(input.sourceUrl);
  const receipt = await loadPersistedSourceReceipt(
    input.rootPath,
    input.sourceReceiptId,
  );
  const decision = await loadConfirmedTaskSourceDecision(
    input.rootPath,
    input.taskId,
    receipt.sourceDecisionId,
  );
  assertSourceReceiptMatchesDecision(
    {
      id: decision.id,
      kind: decision.kind,
      reference: decision.reference,
      state: decision.state,
      ...(decision.routePolicy ? { routePolicy: decision.routePolicy } : {}),
    },
    receipt,
  );
  if (
    receipt.provider !== "figma" ||
    receipt.adapter !== "figma-desktop-mcp-local" ||
    receipt.coverage === "candidate" ||
    receipt.freshness !== "current" ||
    !receipt.requested.fileKey ||
    !authorizedScope(receipt, input.scopeNodeId)
  ) {
    throw new Error(
      "Figma asset receipt is not current Desktop MCP evidence for the selected scope.",
    );
  }
  checkedFigmaMcpRoute(receipt.route);
  const loaded = await load(input.sourceUrl, MAX_RASTER_BYTES);
  const inspected = inspectAsset(loaded.body, loaded.contentType);
  const digest = createHash("sha256").update(loaded.body).digest("hex");
  const shortHash = digest.slice(0, 24);
  const handle = `figma-asset:${input.taskId}:${shortHash}`;
  const now = input.at ?? new Date().toISOString();
  const ttl = Math.min(
    Math.max(input.ttlMs ?? DEFAULT_TTL_MS, 60_000),
    MAX_TTL_MS,
  );
  const metadata: FigmaAssetMetadata = {
    schemaVersion: ASSET_SCHEMA_VERSION,
    handle,
    taskId: input.taskId,
    sourceReceiptId: receipt.id,
    fileKey: receipt.requested.fileKey,
    scopeNodeId: input.scopeNodeId,
    ...(input.assetNodeId ? { assetNodeId: input.assetNodeId.slice(0, 160) } : {}),
    fileName: safeFileName(input.fileName, inspected.format),
    format: inspected.format,
    mediaType: inspected.mediaType,
    bytes: loaded.body.byteLength,
    contentHash: `sha256:${digest}`,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
    ephemeral: true,
  };
  await purgeExpiredFigmaAssets({ taskId: input.taskId, at: now });
  const directory = assetRoot(input.taskId);
  await mkdir(directory, { recursive: true });
  const storedAsset = assetPath(input.taskId, shortHash, inspected.format);
  try {
    await writeFile(storedAsset, loaded.body, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(storedAsset);
    const existingHash = createHash("sha256").update(existing).digest("hex");
    if (existingHash !== digest) {
      throw new Error("Figma asset handle collision detected.", {
        cause: error,
      });
    }
  }
  try {
    await writeFile(
      metadataPath(input.taskId, shortHash),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return parseMetadata(
      JSON.parse(
        await readFile(metadataPath(input.taskId, shortHash), "utf8"),
      ),
      handle,
    );
  }
  return metadata;
}

export async function loadFigmaAssetMetadata(
  handle: string,
): Promise<FigmaAssetMetadata> {
  const match = handle.match(HANDLE);
  if (!match) throw new Error("Figma asset handle is invalid.");
  const [, taskId, shortHash] = match;
  return parseMetadata(
    JSON.parse(await readFile(metadataPath(taskId!, shortHash!), "utf8")),
    handle,
  );
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function nearestExistingAncestor(target: string): Promise<string> {
  let candidate = target;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function materializeFigmaAsset(input: {
  rootPath: string;
  handle: string;
  destinationPath: string;
  at?: string;
}): Promise<{
  handle: string;
  projectPath: string;
  bytes: number;
  contentHash: string;
  sourceReceiptId: string;
}> {
  if (
    path.isAbsolute(input.destinationPath) ||
    input.destinationPath.includes("\0")
  ) {
    throw new Error("Figma asset destination must be checkout-relative.");
  }
  const segments = input.destinationPath.split(/[\\/]+/u);
  if (
    segments.some((segment) =>
      [".git", ".codex", ".component-atlas", "project-memory"].includes(
        segment.toLowerCase(),
      ),
    )
  ) {
    throw new Error("Figma asset destination is not a production asset path.");
  }
  const metadata = await loadFigmaAssetMetadata(input.handle);
  if (Date.parse(input.at ?? new Date().toISOString()) > Date.parse(metadata.expiresAt)) {
    throw new Error("Figma asset handle has expired.");
  }
  const root = await realpath(input.rootPath);
  const destination = path.resolve(root, input.destinationPath);
  if (!insideRoot(root, destination)) {
    throw new Error("Figma asset destination escapes the checkout.");
  }
  if (
    path.extname(destination).toLowerCase() !== `.${metadata.format}`
  ) {
    throw new Error("Figma asset destination extension does not match its format.");
  }
  const match = input.handle.match(HANDLE)!;
  const source = assetPath(metadata.taskId, match[2]!, metadata.format);
  const body = await readFile(source);
  const digest = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (digest !== metadata.contentHash || body.byteLength !== metadata.bytes) {
    throw new Error("Figma asset bytes do not match their handle.");
  }
  inspectAsset(body, metadata.mediaType);
  const existingAncestor = await nearestExistingAncestor(
    path.dirname(destination),
  );
  if (!insideRoot(root, existingAncestor)) {
    throw new Error("Figma asset destination parent escapes the checkout.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const canonicalParent = await realpath(path.dirname(destination));
  if (!insideRoot(root, canonicalParent)) {
    throw new Error("Figma asset destination parent escapes the checkout.");
  }
  try {
    const existing = await lstat(destination);
    if (existing) throw new Error("Figma asset destination already exists.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(destination, body, { flag: "wx" });
  return {
    handle: metadata.handle,
    projectPath: path.relative(root, destination).split(path.sep).join("/"),
    bytes: metadata.bytes,
    contentHash: metadata.contentHash,
    sourceReceiptId: metadata.sourceReceiptId,
  };
}

export async function purgeExpiredFigmaAssets(input: {
  taskId?: string;
  at?: string;
} = {}): Promise<{ inspected: number; removed: number }> {
  const assetsRoot = path.join(projectAtlasTempRoot(), "assets");
  const taskDirectories: Array<{ taskId?: string; directory: string }> = input.taskId
    ? [
        {
          taskId: checkedTaskId(input.taskId),
          directory: assetRoot(input.taskId),
        },
      ]
    : await readdir(assetsRoot, { withFileTypes: true })
        .then((entries) =>
          entries
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !entry.isSymbolicLink() &&
                /^task-[a-f0-9]{20}$/u.test(entry.name),
            )
            .map((entry) => ({
              directory: path.join(assetsRoot, entry.name),
            })),
        )
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
  const at = Date.parse(input.at ?? new Date().toISOString());
  let inspected = 0;
  let removed = 0;
  for (const taskDirectory of taskDirectories) {
    const entries = await readdir(taskDirectory.directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        continue;
      }
      inspected += 1;
      let metadata: FigmaAssetMetadata;
      try {
        metadata = parseMetadata(
          JSON.parse(await readFile(path.join(taskDirectory.directory, entry.name), "utf8")),
        );
      } catch {
        continue;
      }
      if (
        (taskDirectory.taskId && metadata.taskId !== taskDirectory.taskId) ||
        assetRoot(metadata.taskId) !== taskDirectory.directory
      ) {
        continue;
      }
      if (Date.parse(metadata.expiresAt) > at) continue;
      const match = metadata.handle.match(HANDLE);
      if (!match || match[1] !== metadata.taskId) continue;
      await Promise.all([
        unlink(path.join(taskDirectory.directory, entry.name)).catch(() => undefined),
        unlink(assetPath(metadata.taskId, match[2]!, metadata.format)).catch(
          () => undefined,
        ),
      ]);
      removed += 1;
    }
  }
  return { inspected, removed };
}
