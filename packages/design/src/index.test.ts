import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildFigmaDesignIndex,
  designIndexSummary,
  inspectDesignNode,
  isDesignSnapshotCurrent,
  mergeDesignIndexes,
  parseFigmaReference,
  rankDesignCandidates,
  type DesignIndexEnrichment,
} from "./index.js";

const fixture = (name: string) =>
  new URL(`../../../fixtures/figma/${name}`, import.meta.url);

async function checkoutIndex() {
  const metadata = await readFile(fixture("checkout-depth-2.json"), "utf8");
  const enrichment = JSON.parse(
    await readFile(fixture("checkout-enrichment.json"), "utf8"),
  ) as DesignIndexEnrichment;
  return buildFigmaDesignIndex({
    figmaUrl:
      "https://www.figma.com/design/StorefrontKey/Storefront?node-id=0-1",
    metadata,
    enrichment,
    indexedAt: "2026-07-25T00:00:00.000Z",
  });
}

describe("Figma Design Index", () => {
  it("builds a lightweight REST map with statuses, code links, and variables", async () => {
    const index = await checkoutIndex();

    expect(index.file).toMatchObject({
      key: "StorefrontKey",
      name: "Storefront product",
      version: "v42",
    });
    expect(index.stats).toMatchObject({
      pages: 2,
      readyForDev: 1,
      variableCollections: 1,
      variables: 2,
    });
    expect(index.variables).toMatchObject({
      availability: "global",
      valuesIncluded: false,
      collections: [
        expect.objectContaining({
          name: "Theme",
          modes: [
            { id: "1:0", name: "Light" },
            { id: "1:1", name: "Dark" },
          ],
        }),
      ],
    });
    expect(index.variables.variables[0]?.valuesByMode).toBeUndefined();

    const promo = index.nodes.find((node) => node.id === "10:1");
    expect(promo).toMatchObject({
      devStatus: "ready-for-dev",
      resources: [expect.objectContaining({ name: "SHOP-142" })],
      componentNames: expect.arrayContaining([
        "Text input / Default",
        "Button / Primary",
      ]),
      codeConnections: expect.arrayContaining([
        expect.objectContaining({ componentName: "UiTextInput" }),
      ]),
    });

    const summary = designIndexSummary(index);
    expect(summary.variables.collections[0]).toMatchObject({
      name: "Theme",
      modes: ["Light", "Dark"],
    });
    expect(JSON.stringify(summary)).not.toContain("valuesByMode");

    const metadata = await readFile(fixture("checkout-depth-2.json"), "utf8");
    const enrichmentWithValues = JSON.parse(
      await readFile(fixture("checkout-enrichment.json"), "utf8"),
    ) as DesignIndexEnrichment;
    (
      enrichmentWithValues.variableCatalog as Record<string, unknown>
    ).valuesIncluded = true;
    const valueIndex = buildFigmaDesignIndex({
      figmaUrl: "StorefrontKey",
      metadata,
      enrichment: enrichmentWithValues,
    });
    expect(
      valueIndex.variables.variables.find(
        (variable) => variable.id === "VariableID:2",
      )?.valuesByMode,
    ).toMatchObject({ "1:0": 8, "1:1": 8 });
  });

  it("ranks task candidates explainably and waits for node confirmation", async () => {
    const index = await checkoutIndex();
    const result = rankDesignCandidates(
      index,
      "añadir cupón en checkout con validación",
      { codeSignals: ["UiTextInput", "UiButton"], limit: 3 },
    );

    expect(result.candidates[0]).toMatchObject({
      confidence: "high",
      node: {
        id: "10:1",
        name: "Checkout / Promo code",
        status: "ready-for-dev",
      },
    });
    expect(result.candidates[0]?.reasons.join(" ")).toContain("Ready for dev");
    expect(result.gate.status).toBe("blocked");
    expect(result.gate.questions[0]).toMatchObject({
      recommendation: expect.stringContaining("Confirm"),
      evidence: expect.any(Array),
    });

    const inspection = inspectDesignNode(index, "10:1");
    expect(inspection.deepContextRequest).toMatchObject({
      confirmedNodeId: "10:1",
      requiredTools: ["get_design_context", "get_screenshot"],
      recommendedTools: ["get_variable_defs"],
    });
    expect(inspection.node.componentNames).toContain("Text input / Default");

    const missing = rankDesignCandidates(
      index,
      "orbital telemetry heatmap",
    );
    expect(missing).toMatchObject({
      candidates: [],
      gate: {
        status: "blocked",
        questions: [
          expect.objectContaining({
            evidence: expect.any(Array),
            recommendation: expect.any(String),
          }),
        ],
      },
    });
  });

  it("parses MCP XML and merges page snapshots until the file version changes", async () => {
    const checkout = await checkoutIndex();
    const xml = await readFile(fixture("account-page.xml"), "utf8");
    const account = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/StorefrontKey/Storefront",
      metadata: xml,
      format: "figma-mcp-xml",
      version: "v42",
      lastModified: "2026-07-24T10:00:00Z",
      scopeNodeId: "0:3",
      indexedAt: "2026-07-25T01:00:00.000Z",
    });

    expect(account.nodes.map((node) => node.name)).toEqual([
      "Account settings",
      "Delete account dialog",
      "Confirm action button",
    ]);
    expect(designIndexSummary(account).findings).toContainEqual(
      expect.objectContaining({
        level: "resolved",
        code: "global-variables-unavailable",
      }),
    );
    const merged = mergeDesignIndexes(checkout, account);
    expect(merged.pages.map((page) => page.name)).toContain("Account");
    expect(isDesignSnapshotCurrent(merged, account)).toBe(true);

    const newVersion = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/StorefrontKey/Storefront",
      metadata: xml,
      format: "figma-mcp-xml",
      version: "v43",
      lastModified: "2026-07-25T10:00:00Z",
      scopeNodeId: "0:3",
    });
    const replaced = mergeDesignIndexes(merged, newVersion);
    expect(replaced.file.version).toBe("v43");
    expect(replaced.pages).toHaveLength(1);
  });

  it("ranks personal Figma files without Dev Mode or Ready for dev", async () => {
    const metadata = await readFile(
      fixture("personal-no-dev-mode.xml"),
      "utf8",
    );
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
      fileName: "Personal shop",
      indexedAt: "2026-07-25T02:00:00.000Z",
    });

    expect(index.stats.readyForDev).toBe(0);
    expect(index.nodes.every((node) => node.devStatus === "none")).toBe(true);

    const desktop = rankDesignCandidates(
      index,
      "añadir cupón en checkout",
      { limit: 3 },
    );
    expect(desktop.candidates[0]).toMatchObject({
      confidence: "high",
      node: {
        id: "60:1",
        name: "Checkout / Promo code",
        status: "none",
      },
    });
    expect(desktop.candidates[0]?.reasons.join(" ")).not.toContain(
      "Ready for dev",
    );

    const mobile = rankDesignCandidates(
      index,
      "añadir cupón en checkout móvil",
      { limit: 3 },
    );
    expect(mobile.candidates[0]?.node).toMatchObject({
      id: "60:2",
      status: "none",
    });
    expect(mobile.candidates[0]?.reasons).toContain(
      "matches requested mobile variant",
    );
  });

  it("extracts file and node IDs from direct Figma links", () => {
    expect(
      parseFigmaReference(
        "https://www.figma.com/design/StorefrontKey/Storefront?node-id=10-1",
      ),
    ).toMatchObject({
      fileKey: "StorefrontKey",
      nodeId: "10:1",
    });
  });
});
