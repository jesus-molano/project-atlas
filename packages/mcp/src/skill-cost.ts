import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FrontendTaskSkillCost {
  skillChars: number;
  skillReferenceChars: number;
  skillReferenceFiles: number;
  skillManifestHash: string;
  measurement: "exact" | "unavailable";
}

let measuredSkill: Promise<FrontendTaskSkillCost> | undefined;

export function measureFrontendTaskSkillCost(): Promise<FrontendTaskSkillCost> {
  measuredSkill ??= (async () => {
    const skillPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../skills/frontend-task/SKILL.md",
    );
    try {
      const contents = await readFile(skillPath, "utf8");
      const referencesPath = path.join(path.dirname(skillPath), "references");
      const referenceNames = (await readdir(referencesPath))
        .filter((name) => name.endsWith(".md"))
        .sort();
      const references = await Promise.all(
        referenceNames.map(async (name) => ({
          name,
          contents: await readFile(path.join(referencesPath, name), "utf8"),
        })),
      );
      return {
        skillChars: contents.length,
        skillReferenceChars: references.reduce(
          (total, reference) => total + reference.contents.length,
          0,
        ),
        skillReferenceFiles: references.length,
        skillManifestHash: createHash("sha256")
          .update(
            [
              `SKILL.md\0${contents}`,
              ...references.map(
                (reference) => `${reference.name}\0${reference.contents}`,
              ),
            ].join("\0"),
          )
          .digest("hex"),
        measurement: "exact",
      };
    } catch {
      return {
        skillChars: 0,
        skillReferenceChars: 0,
        skillReferenceFiles: 0,
        skillManifestHash: createHash("sha256")
          .update("frontend-task:unavailable")
          .digest("hex"),
        measurement: "unavailable",
      };
    }
  })();
  return measuredSkill;
}
