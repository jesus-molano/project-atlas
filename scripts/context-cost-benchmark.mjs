import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { copyFixture } from "./test-fixture-copy.mjs";
import {
  contextCostReport,
  getTaskContext,
  mapFigmaDesign,
  recordContextCostAudit,
  scanProject,
} from "../packages/runtime/dist/index.js";
import {
  measureFrontendTaskSkillCost,
  measureMcpContractCost,
} from "../packages/mcp/dist/index.js";

const sourceFixture = path.resolve("fixtures/vue-nuxt");
const figmaFixture = path.resolve("fixtures/figma/account-page.xml");
const workspace = await mkdtemp(path.join(os.tmpdir(), "atlas-cost-benchmark-"));
const rootPath = path.join(workspace, "project");
const dataHome = path.join(workspace, "private-data");
const previousDataHome = process.env.PROJECT_ATLAS_HOME;

const cases = [
  ["small", "Rename the account heading"],
  ["small", "Correct the submit button label"],
  ["small", "Add an aria-label to search"],
  ["small", "Adjust spacing in the account card"],
  ["frontend", "Add loading and disabled states to the account form"],
  ["frontend", "Reuse the existing dialog for account deletion"],
  ["frontend", "Add validation feedback to the profile settings form"],
  ["frontend", "Make the account navigation responsive"],
  [
    "complex",
    "Implement the confirmed account settings frame and createOrder OpenAPI operation",
  ],
  [
    "complex",
    "Reconcile the confirmed Figma account dialog with the orders API contract",
  ],
  [
    "complex",
    "Build the responsive account workflow using the confirmed design and API",
  ],
  [
    "complex",
    "Audit and implement error, focus, disabled, and loading states from Figma and OpenAPI",
  ],
];

try {
  process.env.PROJECT_ATLAS_HOME = dataHome;
  await copyFixture(sourceFixture, rootPath);
  await writeFile(
    path.join(rootPath, "openapi.yaml"),
    `openapi: 3.0.3
paths:
  /orders:
    post:
      operationId: createOrder
      responses:
        "201":
          description: Created
`,
  );
  await scanProject(rootPath, { writeArtifacts: false });
  await mapFigmaDesign({
    rootPath,
    figmaUrl: "https://www.figma.com/design/CostBenchmark/Account",
    metadata: await readFile(figmaFixture, "utf8"),
    format: "figma-mcp-xml",
  });
  const [mcp, skill] = await Promise.all([
    measureMcpContractCost(),
    measureFrontendTaskSkillCost(),
  ]);
  const started = performance.now();
  for (const [index, [taskType, task]] of cases.entries()) {
    const complex = taskType === "complex";
    let context;
    try {
      context = await getTaskContext(rootPath, task, {
        budgetChars: complex ? 3_600 : taskType === "small" ? 2_000 : 3_200,
        topK: complex ? 5 : 3,
        ...(complex
          ? {
              figmaFile: "CostBenchmark",
              sourcePolicy: {
                scope: "task",
                confirmedKinds: ["figma", "openapi"],
                omittedKinds: [],
                unavailableKinds: [],
              },
              confirmedOpenApiReferences: ["openapi.yaml"],
            }
          : {}),
      });
    } catch (error) {
      throw new Error(
        `Context-cost case ${index + 1} (${taskType}) failed: ${task}`,
        { cause: error },
      );
    }
    const compactContextChars = JSON.stringify(context).length;
    await recordContextCostAudit({
      rootPath,
      auditId: `benchmark-${String(index + 1).padStart(2, "0")}`,
      task,
      taskType,
      mode: "benchmark",
      contract: {
        ...mcp,
        ...skill,
        measurement:
          skill.measurement === "exact" ? "exact" : "declared-estimate",
      },
      context: {
        promptChars: compactContextChars + 420,
        compactContextChars,
        receiptCount: context.sourceReceiptIds?.length ?? 0,
        receiptBytes: JSON.stringify(context.sourceReceiptIds ?? []).length,
      },
      interaction: { completed: true },
    });
  }
  const report = await contextCostReport(rootPath, 12);
  const result = {
    schemaVersion: 1,
    cases: cases.length,
    elapsedMs: Math.round(performance.now() - started),
    contract: {
      tools: mcp.mcpToolCount,
      serializedChars: mcp.mcpSerializedChars,
      skillChars: skill.skillChars + skill.skillReferenceChars,
    },
    groups: report.groups,
    privacy:
      "Content-free summary; prompts, source bodies, code, paths, and URLs are excluded.",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await rm(workspace, { recursive: true, force: true });
}
