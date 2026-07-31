import { createHash } from "node:crypto";

const OWNER = "component-atlas-visual-direction/v1";

export function visualCleanupReceipt(
  taskId: string,
  sessionId: string,
  reason: "close" | "cancel" = "cancel",
): string {
  const taskFingerprint = createHash("sha256").update(taskId).digest("hex");
  const cleanedAt = new Date().toISOString();
  const proof = createHash("sha256")
    .update(
      [OWNER, taskFingerprint, sessionId, reason, cleanedAt].join("\0"),
    )
    .digest("hex")
    .slice(0, 16);
  return `cleanup:v1:${taskFingerprint.slice(
    0,
    16,
  )}:${sessionId}:${reason}:${Date.parse(cleanedAt).toString(36)}:${proof}`;
}
