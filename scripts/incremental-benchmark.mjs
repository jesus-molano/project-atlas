import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../packages/runtime/dist/index.js";

const root = await mkdtemp(path.join(os.tmpdir(), "atlas-incremental-bench-"));
const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-bench-data-"));
const previousHome = process.env.PROJECT_ATLAS_HOME;
process.env.PROJECT_ATLAS_HOME = dataHome;

try {
  const templateBody = Array.from(
    { length: 80 },
    (_, index) => `<span class="cell cell-${index}">{{ label }}</span>`,
  ).join("");
  await mkdir(path.join(root, "components"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "incremental-benchmark",
      dependencies: { vue: "^3.0.0" },
    }),
  );
  await Promise.all(
    Array.from({ length: 300 }, (_, index) =>
      writeFile(
        path.join(root, "components", `Fixture${index}.vue`),
        `<script setup lang="ts">defineProps<{ label: string; index?: number }>()</script><template><article class="fixture">${templateBody}</article></template>`,
      ),
    ),
  );
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "atlas@example.test"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Atlas Benchmark"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "fixture"]);
  await scanProject(root, { writeArtifacts: false });
  await writeFile(
    path.join(root, "components", "Fixture42.vue"),
    `<script setup lang="ts">defineProps<{ label: string; index?: number; active?: boolean }>()</script><template><article class="fixture active">${templateBody}</article></template>`,
  );

  const incrementalStarted = performance.now();
  const incremental = await scanProject(root, { writeArtifacts: false });
  const incrementalMs = performance.now() - incrementalStarted;
  const fullStarted = performance.now();
  const full = await scanProject(root, {
    writeArtifacts: false,
    incremental: false,
  });
  const fullMs = performance.now() - fullStarted;

  if (incremental.project.scan?.mode !== "incremental") {
    throw new Error(`Expected incremental mode, got ${incremental.project.scan?.mode}.`);
  }
  if (full.project.scan?.mode !== "full") {
    throw new Error(`Expected full mode, got ${full.project.scan?.mode}.`);
  }
  process.stdout.write(
    `${JSON.stringify({
      components: full.components.length,
      changedFiles: incremental.project.scan.changedFiles,
      incrementalMs: Number(incrementalMs.toFixed(1)),
      fullMs: Number(fullMs.toFixed(1)),
      speedup: Number((fullMs / Math.max(incrementalMs, 0.1)).toFixed(2)),
    })}\n`,
  );
} finally {
  if (previousHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousHome;
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataHome, { recursive: true, force: true }),
  ]);
}
