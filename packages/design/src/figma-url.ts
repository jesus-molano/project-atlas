import type { FigmaReference } from "./types.js";

const FIGMA_FILE_ROUTE =
  /^\/(?:design|file|proto|board|make|slides)\/([^/?#]+)(?:\/[^?#]*)?/i;

function normalizedNodeId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.includes(":") ? trimmed : trimmed.replace("-", ":");
}

export function parseFigmaReference(value: string): FigmaReference {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A Figma file URL or file key is required.");
  if (!/^https?:\/\//i.test(trimmed)) {
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new Error(`Invalid Figma file key or URL: "${value}".`);
    }
    return {
      fileKey: trimmed,
      fileUrl: `https://www.figma.com/design/${trimmed}`,
    };
  }
  const url = new URL(trimmed);
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
    throw new Error(`Expected a figma.com URL, received "${value}".`);
  }
  const match = url.pathname.match(FIGMA_FILE_ROUTE);
  const fileKey = match?.[1];
  if (!fileKey) {
    throw new Error(`Could not extract a Figma file key from "${value}".`);
  }
  const nodeId = normalizedNodeId(url.searchParams.get("node-id"));
  url.search = "";
  url.hash = "";
  return {
    fileKey,
    fileUrl: url.toString().replace(/\/$/, ""),
    ...(nodeId ? { nodeId } : {}),
  };
}

export function figmaNodeUrl(fileUrl: string, nodeId: string): string {
  const url = new URL(parseFigmaReference(fileUrl).fileUrl);
  url.searchParams.set("node-id", nodeId.replace(":", "-"));
  return url.toString();
}
