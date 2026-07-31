import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FrontendTaskSkillCost {
  skillChars: number;
  skillReferenceChars: 0;
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
      return {
        skillChars: contents.length,
        skillReferenceChars: 0,
        skillManifestHash: createHash("sha256")
          .update(`SKILL.md\0${contents}`)
          .digest("hex"),
        measurement: "exact",
      };
    } catch {
      return {
        skillChars: 0,
        skillReferenceChars: 0,
        skillManifestHash: createHash("sha256")
          .update("frontend-task:unavailable")
          .digest("hex"),
        measurement: "unavailable",
      };
    }
  })();
  return measuredSkill;
}
