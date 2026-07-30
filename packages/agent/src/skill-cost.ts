import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface FrontendTaskSkillCost {
  skillChars: number;
  skillReferenceChars: number;
  skillManifestHash: string;
  measurement: "exact" | "unavailable";
}

const requiredFiles = [
  "SKILL.md",
  path.join("references", "source-precheck.md"),
  path.join("references", "brief-contract.md"),
];

let measuredSkill: Promise<FrontendTaskSkillCost> | undefined;

export function measureFrontendTaskSkillCost(): Promise<FrontendTaskSkillCost> {
  measuredSkill ??= (async () => {
    const skillRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../skills/frontend-task",
    );
    try {
      const contents = await Promise.all(
        requiredFiles.map((file) => readFile(path.join(skillRoot, file), "utf8")),
      );
      const manifest = requiredFiles
        .map((file, index) => `${file}\0${contents[index]}`)
        .join("\0");
      return {
        skillChars: contents[0]?.length ?? 0,
        skillReferenceChars:
          (contents[1]?.length ?? 0) + (contents[2]?.length ?? 0),
        skillManifestHash: createHash("sha256")
          .update(manifest)
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
