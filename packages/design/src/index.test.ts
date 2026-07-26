import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildFigmaDesignIndex,
  designIndexSummary,
  inspectDesignNode,
  isDesignSnapshotCurrent,
  mergeDesignIndexes,
  normalizeDesignIndex,
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
    expect(index.devStatus).toEqual({ availability: "available" });
    expect(index.pages.find((page) => page.id === "0:1")).toMatchObject({
      devStatus: "ready-for-dev",
      devStatusAvailability: "available",
      devStatusDescription: "Checkout delivery page",
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
      strategy: "confirmed-subtree",
      requiredTools: ["get_design_context", "get_screenshot"],
      recommendedTools: ["get_variable_defs"],
      budgetPolicy: {
        preserveTargetFirst: true,
        onUnisolatedTarget: "ask-for-selection",
      },
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
    expect(mergeDesignIndexes(merged, account).nodes).toHaveLength(
      merged.nodes.length,
    );

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
    expect(index.devStatus).toMatchObject({
      availability: "source-unavailable",
    });
    expect(
      index.nodes.every(
        (node) => node.devStatusAvailability === "source-unavailable",
      ),
    ).toBe(true);
    expect(designIndexSummary(index).findings).toContainEqual(
      expect.objectContaining({
        code: "dev-status-unavailable",
        level: "warning",
      }),
    );

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
        statusAvailability: "source-unavailable",
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
      statusAvailability: "source-unavailable",
    });
    expect(mobile.candidates[0]?.reasons).toContain(
      "matches requested mobile variant",
    );
  });

  it("preserves observable status when a later scoped source cannot expose it", async () => {
    const xml = await readFile(fixture("account-page.xml"), "utf8");
    const observable = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/StorefrontKey/Storefront",
      metadata: xml,
      format: "figma-mcp-xml",
      version: "v42",
      scopeNodeId: "0:3",
      scopePageId: "0:3",
      scopePageName: "Account",
    });
    const withoutStatus = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/StorefrontKey/Storefront",
      metadata: xml.replace(' dev-status="READY_FOR_DEV"', ""),
      format: "figma-mcp-xml",
      version: "v42",
      scopeNodeId: "0:3",
      scopePageId: "0:3",
      scopePageName: "Account",
    });
    const merged = mergeDesignIndexes(observable, withoutStatus);

    expect(merged.nodes.find((node) => node.id === "40:2")).toMatchObject({
      devStatus: "ready-for-dev",
      devStatusAvailability: "available",
    });
    expect(merged.devStatus.availability).toBe("partial");
    expect(merged.nodes[0]?.pageName).toBe("Account");
  });

  it("does not persist transient local asset URLs", async () => {
    const metadata = await readFile(fixture("personal-no-dev-mode.xml"), "utf8");
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
      enrichment: {
        devResources: [
          {
            node_id: "60:1",
            name: "Transient image",
            url: "http://localhost:3845/assets/example.svg",
          },
          {
            node_id: "60:1",
            name: "Durable reference",
            url: "https://example.test/design/reference",
          },
        ],
      },
    });

    expect(index.nodes.find((node) => node.id === "60:1")?.resources).toEqual([
      expect.objectContaining({ name: "Durable reference" }),
    ]);
  });

  it("groups viewport and storyboard evidence without inventing small breakpoints", () => {
    const metadata = `
      <canvas id="1:1" name="Security">
        <section id="2:1" name="Fingerprint flow">
          <frame id="3:1" name="Fingerprint registered desktop" width="1600" height="1024">
            <frame id="4:1" name="Security card" width="720" height="640" />
          </frame>
          <frame id="3:2" name="Fingerprint registered" width="1200" height="1024" />
          <frame id="3:3" name="REgister fingerprint capture" width="1200" height="1024" />
          <frame id="3:4" name="Fingerprint error" width="1200" height="1024" />
        </section>
      </canvas>
    `;
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/SecurityFixture/Security",
      metadata,
      format: "figma-mcp-xml",
      enrichment: { devStatusAvailability: "source-unavailable" },
    });
    const summary = designIndexSummary(index);
    const sectionInspection = inspectDesignNode(index, "2:1");

    expect(summary.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "viewport",
          viewportWidths: [1200, 1600],
        }),
        expect.objectContaining({
          kind: "flow",
          observedStates: expect.arrayContaining(["capture", "error"]),
        }),
      ]),
    );
    expect(summary.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "responsive-coverage-gap" }),
        expect.objectContaining({ code: "naming-inconsistency" }),
      ]),
    );
    expect(sectionInspection.deepContextRequest).toMatchObject({
      candidateSubtreeIds: expect.arrayContaining(["3:1", "3:2"]),
      requiredTools: ["get_metadata", "get_design_context", "get_screenshot"],
      budgetPolicy: { onUnisolatedTarget: "ask-for-selection" },
    });
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

  it("upgrades older cached indexes without treating unknown XML status as absent", async () => {
    const current = await checkoutIndex();
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    delete legacy.devStatus;
    for (const source of legacy.sources as Array<Record<string, unknown>>) {
      delete source.devStatusAvailability;
    }
    for (const node of legacy.nodes as Array<Record<string, unknown>>) {
      delete node.devStatusAvailability;
    }
    for (const page of legacy.pages as Array<Record<string, unknown>>) {
      delete page.devStatus;
      delete page.devStatusAvailability;
    }

    const upgraded = normalizeDesignIndex(
      legacy as unknown as Parameters<typeof normalizeDesignIndex>[0],
    );
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.devStatus.availability).toBe("available");
    expect(upgraded.nodes.find((node) => node.id === "10:1")).toMatchObject({
      devStatusAvailability: "available",
      devStatusProvenance: "observed",
    });
  });

  it("groups repeated storyboard findings into a compact flow summary", () => {
    const repeatedFrames = Array.from({ length: 120 }, (_, index) => {
      const state = ["Entry", "Selection", "Capture", "Success", "Error"][
        index % 5
      ];
      const width = index % 2 === 0 ? 1440 : 1200;
      return `<frame id="3:${index + 1}" name="Checkout flow ${state} desktop" width="${width}" height="900" />`;
    }).join("");
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/LargeFixture/Large-fixture",
      metadata: `<canvas id="1:1" name="Flows"><section id="2:1" name="Checkout storyboard">${repeatedFrames}</section></canvas>`,
      format: "figma-mcp-xml",
      enrichment: { devStatusAvailability: "source-unavailable" },
    });
    const summary = designIndexSummary(index);
    const serializedFindings = JSON.stringify(summary.findings);

    expect(summary.families).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "flow",
          observedStates: expect.arrayContaining(["capture", "error", "success"]),
        }),
      ]),
    );
    expect(summary.findings.length).toBeLessThanOrEqual(12);
    expect(serializedFindings.length).toBeLessThanOrEqual(3_000);
    expect(
      summary.findings.every(
        (finding) =>
          (finding.evidence.length <= 3) &&
          ((finding.nodeIds?.length ?? 0) <= 8),
      ),
    ).toBe(true);
  });

  it("keeps manual Ready for dev confirmation distinct from source observation", () => {
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/ManualStatusFixture/Manual-status",
      metadata:
        '<canvas id="1:1" name="Page"><frame id="2:1" name="Secure form" /></canvas>',
      format: "figma-mcp-xml",
      enrichment: {
        devStatusAvailability: "source-unavailable",
        devStatusByNode: { "2:1": "READY_FOR_DEV" },
        devStatusProvenanceByNode: { "2:1": "user-confirmed" },
      },
    });
    expect(index.nodes[0]).toMatchObject({
      devStatus: "ready-for-dev",
      devStatusAvailability: "source-unavailable",
      devStatusProvenance: "user-confirmed",
    });
    expect(rankDesignCandidates(index, "secure form").candidates[0]?.node).toMatchObject({
      status: "ready-for-dev",
      statusProvenance: "user-confirmed",
    });
  });
});
