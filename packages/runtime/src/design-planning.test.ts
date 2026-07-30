import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildFigmaDesignIndex,
  inspectDesignNode,
} from "@component-atlas/design";
import { afterEach, describe, expect, it } from "vitest";
import {
  listDesignLinks,
  loadDesignCoverageLedger,
  recordDesignCoverageLedger,
  registerDesignLink,
  scanProject,
} from "./index.js";

const temporary: string[] = [];

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("task-scoped design coverage and design links", () => {
  it("persists only compact coverage and refuses silent mapping conflicts", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-design-plan-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "design-plan", dependencies: { vue: "^3.5.0" } }),
    );
    await writeFile(
      path.join(root, "src", "UiButton.vue"),
      "<template><button>Save</button></template>",
    );
    await writeFile(
      path.join(root, "src", "OtherButton.vue"),
      "<template><button>Other</button></template>",
    );
    const graph = await scanProject(root, { writeArtifacts: false });
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/LedgerFixture/Page",
      metadata:
        "<canvas id=\"0:1\" name=\"Page\"><section id=\"1:1\" name=\"Page\"><frame id=\"1:2\" name=\"A\" /><frame id=\"1:3\" name=\"B\" /><frame id=\"1:4\" name=\"C\" /></section></canvas>",
      format: "figma-mcp-xml",
    });
    const plan = inspectDesignNode(index, "1:1").retrievalPlan;
    const ledger = await recordDesignCoverageLedger(root, {
      taskId: "task-ledger-1",
      plan,
      receiptIds: ["receipt-0123456789abcdef"],
    });
    expect(await loadDesignCoverageLedger(root, "task-ledger-1")).toEqual(ledger);
    expect(JSON.stringify(ledger)).not.toContain("screenshot");
    expect(JSON.stringify(ledger)).not.toContain("localhost");

    const first = graph.components.find((component) =>
      component.relativePath.endsWith("UiButton.vue"),
    )!;
    const other = graph.components.find((component) =>
      component.relativePath.endsWith("OtherButton.vue"),
    )!;
    await registerDesignLink(root, {
      fileKey: "LedgerFixture",
      nodeId: "1:2",
      componentId: first.id,
      source: "code-connect-exact",
      receiptIds: ["receipt-0123456789abcdef"],
    });
    await expect(
      registerDesignLink(root, {
        fileKey: "LedgerFixture",
        nodeId: "1:2",
        componentId: other.id,
        source: "local-confirmed",
      }),
    ).rejects.toThrow("explicit resolution is required");
    expect(await listDesignLinks(root, "LedgerFixture")).toHaveLength(1);
  });
});
