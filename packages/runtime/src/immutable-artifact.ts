import { randomUUID } from "node:crypto";
import { link, open, readFile, rm } from "node:fs/promises";

/**
 * Publishes fully-fsynced bytes with an exclusive hard-link. Concurrent writers
 * may converge on identical bytes, but can never replace an existing artifact.
 */
export async function writeImmutableArtifact(
  target: string,
  serialized: string,
  conflictMessage: string,
): Promise<"created" | "existing"> {
  const staged = `${target}.${randomUUID()}.stage`;
  const file = await open(staged, "wx", 0o600);
  try {
    await file.writeFile(serialized, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    try {
      await link(staged, target);
      return "created";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await readFile(target, "utf8")) === serialized) return "existing";
      throw new Error(conflictMessage, { cause: error });
    }
  } finally {
    await rm(staged, { force: true });
  }
}
