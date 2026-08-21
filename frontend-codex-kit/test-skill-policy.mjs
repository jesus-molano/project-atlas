import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillsRoot = path.join(import.meta.dirname, "..", "skills");

async function readSkillFile(skillName, relativePath) {
  return readFile(path.join(skillsRoot, skillName, relativePath), "utf8");
}

test("frontend-task allows selective implicit activation", async () => {
  const [definition, metadata] = await Promise.all([
    readSkillFile("frontend-task", "SKILL.md"),
    readSkillFile("frontend-task", "agents/openai.yaml"),
  ]);

  assert.match(metadata, /^\s*allow_implicit_invocation:\s*true\s*$/m);
  assert.match(
    definition,
    /Activate implicitly only\s+for frontend\s+implementation/,
  );
  assert.match(definition, /Skip small edits, research, diagnosis, and review/);
});

test("child Atlas skills remain explicit-only", async () => {
  for (const skillName of ["reuse-first", "visual-direction"]) {
    const metadata = await readSkillFile(skillName, "agents/openai.yaml");
    assert.match(
      metadata,
      /^\s*allow_implicit_invocation:\s*false\s*$/m,
      `${skillName} must remain explicit-only`,
    );
  }
});
