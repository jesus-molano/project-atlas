import { describe, expect, it } from "vitest";
import {
  adaptDesignRetrievalPlan,
  buildFigmaDesignIndex,
  inspectDesignNode,
} from "./index.js";

describe("Figma Page Planner v2", () => {
  it("accounts for every region, selects 3–6, queries Code Connect first, and splits adaptively", () => {
    const children = Array.from(
      { length: 8 },
      (_, index) =>
        `<frame id="10:${index + 2}" name="Region ${index + 1}" x="${index * 100}" y="0" width="90" height="100"><frame id="20:${index + 2}" name="Child ${index + 1}" /></frame>`,
    ).join("");
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/PlannerFixture/Page",
      metadata: `<canvas id="0:1" name="Page"><section id="10:1" name="Large page">${children}</section></canvas>`,
      format: "figma-mcp-xml",
    });
    const inspection = inspectDesignNode(index, "10:1");
    const plan = inspection.retrievalPlan;
    expect(plan.selectedNodeIds).toHaveLength(6);
    expect(plan.regions).toHaveLength(8);
    expect(
      plan.regions.every((region) =>
        ["selected", "omitted"].includes(region.status),
      ),
    ).toBe(true);
    expect(plan.calls.map((call) => call.tool).slice(0, 2)).toEqual([
      "get_metadata",
      "get_code_connect_map",
    ]);

    const failed = plan.selectedNodeIds[0]!;
    const adaptive = adaptDesignRetrievalPlan(plan, failed, ["20:2", "20:3"]);
    expect(adaptive.targetNodeId).toBe(plan.targetNodeId);
    expect(adaptive.selectedNodeIds).not.toContain(failed);
    expect(
      adaptive.calls.some(
        (call) =>
          call.nodeId === failed && call.tool === "get_design_context",
      ),
    ).toBe(false);
    expect(
      adaptive.regions.find((region) => region.nodeId === failed)?.status,
    ).toBe("failed");
  });

  it("selects every region when fewer than three exist", () => {
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/SmallPlanner/Page",
      metadata:
        "<canvas id=\"0:1\" name=\"Page\"><section id=\"1:1\" name=\"Small\"><frame id=\"1:2\" name=\"One\" /><frame id=\"1:3\" name=\"Two\" /></section></canvas>",
      format: "figma-mcp-xml",
    });
    expect(inspectDesignNode(index, "1:1").retrievalPlan.selectedNodeIds).toEqual([
      "1:2",
      "1:3",
    ]);
  });
});
