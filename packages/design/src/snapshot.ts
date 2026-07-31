import type { DesignFileIndex } from "./types.js";

export function isDesignSnapshotCurrent(
  existing: DesignFileIndex,
  incoming: DesignFileIndex,
): boolean {
  return incoming.sources.every((source) =>
    existing.sources.some(
      (candidate) =>
        candidate.kind === source.kind &&
        candidate.scopeNodeId === source.scopeNodeId &&
        candidate.hash === source.hash &&
        candidate.receipt.id === source.receipt.id &&
        (!incoming.file.version ||
          existing.file.version === incoming.file.version) &&
        (!incoming.file.lastModified ||
          existing.file.lastModified === incoming.file.lastModified),
    ),
  );
}
