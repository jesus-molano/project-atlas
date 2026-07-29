import { readFile } from "node:fs/promises";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
} from "@component-atlas/core";
import { describe, expect, it } from "vitest";
import {
  buildFigmaDesignIndex,
  designIndexSummary,
  inspectDesignNode,
  isDesignSnapshotCurrent,
  mergeDesignIndexes,
  normalizeDesignIndex,
  normalizeDesignVariableCatalog,
  parseFigmaReference,
  queryDesignVariables,
  rankDesignCandidates,
  resolveExplicitDesignTarget,
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
  it("keeps an exact Figma node authoritative and never substitutes ranked Atlas candidates", async () => {
    const metadata = await readFile(fixture("checkout-depth-2.json"), "utf8");
    const index = buildFigmaDesignIndex({
      figmaUrl:
        "https://www.figma.com/design/StorefrontKey/Storefront?node-id=10-1",
      metadata,
      indexedAt: "2026-07-29T12:00:00.000Z",
    });

    const exact = resolveExplicitDesignTarget(index, "10:1");
    expect(exact.candidates).toEqual([
      expect.objectContaining({
        origin: "user-confirmed-target",
        node: expect.objectContaining({ id: "10:1" }),
      }),
    ]);

    const mismatch = resolveExplicitDesignTarget(index, "10:2");
    expect(mismatch.candidates).toEqual([]);
    expect(mismatch.findings).toEqual([
      expect.objectContaining({
        code: "explicit-target-mismatch",
        level: "decision-required",
      }),
    ]);

    index.sources[0]!.receipt.freshness = "stale";
    const stale = resolveExplicitDesignTarget(index, "10:1");
    expect(stale.candidates).toEqual([]);
    expect(stale.findings[0]).toMatchObject({
      code: "explicit-target-stale",
      level: "decision-required",
    });
  });

  it("validates a selected Figma subtree against its confirmed page scope", async () => {
    const metadata = await readFile(fixture("checkout-depth-2.json"), "utf8");
    const confirmed =
      "https://www.figma.com/design/StorefrontKey/Storefront?node-id=0-1";
    const identity = sourceIdentityFromReference("figma", confirmed);
    const index = buildFigmaDesignIndex({
      figmaUrl:
        "https://www.figma.com/design/StorefrontKey/Storefront?node-id=10-1",
      confirmedSourceReference: confirmed,
      metadata,
      scopeNodeId: "10:1",
      scopePageId: "0:1",
      sourceReceipt: createSourceReceipt({
        sourceDecisionId: taskSourceId("figma", confirmed),
        provider: "figma",
        requested: identity,
        resolved: identity,
        adapter: "figma-desktop-mcp-local",
        route: "http://127.0.0.1:3845/mcp",
        operation: "get_metadata",
        scope: { kind: "selection", id: "10:1", parentId: "0:1" },
        scopeRelation: {
          kind: "contained-scope",
          sourceId: "0:1",
          targetId: "10:1",
        },
        observedAt: "2026-07-29T12:00:00.000Z",
        coverage: "exact",
        freshness: "current",
      }),
    });

    expect(index.sources[0]?.receipt).toMatchObject({
      requested: { canonicalId: "StorefrontKey::0:1" },
      scope: { id: "10:1" },
      scopeRelation: {
        kind: "contained-scope",
        sourceId: "0:1",
        targetId: "10:1",
      },
      contentHash: expect.any(String),
    });
    const resolvedSelection = resolveExplicitDesignTarget(index, "10:1");
    expect(resolvedSelection).toMatchObject({
      candidates: [
        expect.objectContaining({
          origin: "user-confirmed-target",
          node: expect.objectContaining({ id: "10:1" }),
        }),
      ],
    });
    expect(resolvedSelection.gate.status).not.toBe("blocked");
    expect(() =>
      buildFigmaDesignIndex({
        figmaUrl:
          "https://www.figma.com/design/StorefrontKey/Storefront?node-id=10-1",
        confirmedSourceReference: confirmed,
        metadata,
        scopeNodeId: "10:1",
        scopePageId: "0:1",
        sourceReceipt: createSourceReceipt({
          sourceDecisionId: taskSourceId("figma", confirmed),
          provider: "figma",
          requested: identity,
          resolved: identity,
          adapter: "figma-desktop-mcp-local",
          route: "http://127.0.0.1:3845/mcp",
          operation: "get_metadata",
          scope: { kind: "selection", id: "10:1" },
          scopeRelation: {
            kind: "contained-scope",
            sourceId: "99:99",
            targetId: "10:1",
          },
          observedAt: "2026-07-29T12:00:00.000Z",
          coverage: "exact",
          freshness: "current",
        }),
      }),
    ).toThrow(/does not prove/i);
  });

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
      source: "figma-variables-rest",
      detailLevel: "catalog",
      valuesIncluded: false,
      totalCollections: 1,
      totalVariables: 2,
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
    expect(index.variables.variables).toEqual([]);

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

  it("keeps global, selection, unavailable, and permission states distinct", () => {
    const unavailable = normalizeDesignVariableCatalog(undefined);
    expect(unavailable).toMatchObject({
      availability: "unavailable",
      source: "none",
      collections: [],
      variables: [],
    });
    expect(unavailable.note).toContain("not evidence");

    const selection = normalizeDesignVariableCatalog({
      availability: "selection-only",
      source: "figma-selection",
      meta: {
        variableCollections: {
          "selection:not-global": { name: "Must not persist" },
        },
      },
    });
    expect(selection).toMatchObject({
      availability: "selection-only",
      source: "figma-selection",
      totalCollections: 0,
      totalVariables: 0,
      collections: [],
      variables: [],
    });
    expect(selection.note).toContain("not a file-global");
    expect(
      normalizeDesignVariableCatalog({
        variables: {
          "selection/token": {
            name: "selection/token",
            value: 8,
          },
        },
      }),
    ).toMatchObject({
      availability: "unavailable",
      source: "none",
      collections: [],
      variables: [],
    });

    expect(
      normalizeDesignVariableCatalog({
        availability: "permission-required",
        source: "figma-variables-rest",
      }),
    ).toMatchObject({
      availability: "permission-required",
      source: "figma-variables-rest",
    });
    expect(() =>
      normalizeDesignVariableCatalog({
        availability: "global",
        source: "figma-selection",
        meta: {
          variableCollections: {
            "VariableCollectionId:1": { name: "Theme" },
          },
        },
      }),
    ).toThrow(/file-global source/);
  });

  it("persists a catalog by default and exact aliases and colors only on expanded demand", () => {
    const payload = {
      availability: "global",
      source: "figma-desktop-mcp-global",
      meta: {
        variableCollections: {
          "VariableCollectionId:1": {
            id: "VariableCollectionId:1",
            name: "Theme",
            defaultModeId: "1:0",
            modes: [
              { modeId: "1:0", name: "Light" },
              { modeId: "1:1", name: "Dark" },
            ],
            variableIds: ["VariableID:surface", "VariableID:alias"],
          },
        },
        variables: {
          "VariableID:surface": {
            id: "VariableID:surface",
            name: "color/surface",
            variableCollectionId: "VariableCollectionId:1",
            resolvedType: "COLOR",
            valuesByMode: {
              "1:0": { r: 1, g: 1, b: 1, a: 1 },
              "1:1": { r: 0, g: 0, b: 0, a: 1 },
            },
          },
          "VariableID:alias": {
            id: "VariableID:alias",
            name: "color/background",
            variableCollectionId: "VariableCollectionId:1",
            resolvedType: "COLOR",
            valuesByMode: {
              "1:0": {
                type: "VARIABLE_ALIAS",
                id: "VariableID:surface",
              },
            },
          },
        },
      },
    };
    const catalog = normalizeDesignVariableCatalog(payload);
    expect(catalog).toMatchObject({
      availability: "global",
      source: "figma-desktop-mcp-global",
      detailLevel: "catalog",
      valuesIncluded: false,
      totalCollections: 1,
      totalVariables: 2,
      variables: [],
      collections: [
        expect.objectContaining({
          name: "Theme",
          defaultModeId: "1:0",
          resolvedTypes: ["COLOR"],
        }),
      ],
    });

    const expanded = normalizeDesignVariableCatalog({
      ...payload,
      detailLevel: "expanded",
      valuesIncluded: true,
    });
    expect(expanded.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "VariableID:surface",
          valuesByMode: {
            "1:0": { r: 1, g: 1, b: 1, a: 1 },
            "1:1": { r: 0, g: 0, b: 0, a: 1 },
          },
        }),
        expect.objectContaining({
          id: "VariableID:alias",
          valuesByMode: {
            "1:0": { aliasTo: "VariableID:surface" },
          },
        }),
      ]),
    );

    const base = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/VariablesFixture/Variables",
      metadata:
        '<canvas id="1:1" name="Page"><frame id="2:1" name="Card" /></canvas>',
      format: "figma-mcp-xml",
      enrichment: { variableCatalog: expanded },
    });
    const namesOnly = queryDesignVariables(base, {
      includeVariables: true,
    });
    expect(JSON.stringify(namesOnly.variables)).not.toContain("valuesByMode");
    const exact = queryDesignVariables(base, {
      includeVariables: true,
      includeValues: true,
    });
    expect(exact.expansion).toMatchObject({
      persisted: true,
      valuesPersisted: true,
      requiresGlobalSync: false,
    });
    expect(exact.variables[1]?.valuesByMode).toEqual({
      "1:0": { aliasTo: "VariableID:surface" },
    });
  });

  it("bounds expanded Variables persistence and never truncates a value into a fake exact value", () => {
    const variableIds = Array.from(
      { length: 1_005 },
      (_, index) => `VariableID:${index}`,
    );
    const variables = Object.fromEntries(
      variableIds.map((id, index) => [
        id,
        {
          id,
          name: `token/${index}`,
          variableCollectionId: "VariableCollectionId:large",
          resolvedType: "STRING",
          valuesByMode: {
            "mode:default": index === 0 ? "x".repeat(4_001) : `value-${index}`,
          },
        },
      ]),
    );
    const catalog = normalizeDesignVariableCatalog({
      availability: "global",
      source: "figma-variables-rest",
      detailLevel: "expanded",
      valuesIncluded: true,
      meta: {
        variableCollections: {
          "VariableCollectionId:large": {
            id: "VariableCollectionId:large",
            name: "Large",
            modes: [{ modeId: "mode:default", name: "Default" }],
            variableIds,
          },
        },
        variables,
      },
    });

    expect(catalog).toMatchObject({
      totalVariables: 1_005,
      truncated: {
        variables: true,
        values: true,
      },
    });
    expect(catalog.variables).toHaveLength(1_000);
    expect(catalog.variables[0]?.valuesByMode).toBeUndefined();
    const index = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/BoundedVariables/Bounded",
      metadata:
        '<canvas id="1:1" name="Page"><frame id="2:1" name="Card" /></canvas>',
      format: "figma-mcp-xml",
      enrichment: { variableCatalog: catalog },
    });
    expect(
      queryDesignVariables(index, {
        includeVariables: true,
        includeValues: true,
      }).expansion.requiresGlobalSync,
    ).toBe(true);
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
      recommendedTools: ["get_figma_variables"],
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
    expect(
      inspectDesignNode(index, "60:2").deepContextRequest.recommendedTools,
    ).not.toContain("get_variable_defs");
    expect(inspectDesignNode(index, "60:2").deepContextRequest).toMatchObject({
      recommendedTools: expect.not.arrayContaining(["get_code_connect_map"]),
      optionalEnrichmentTools: ["get_code_connect_map"],
      codeConnect: {
        status: "unmapped",
        policy: "advisory",
        blocksFidelity: false,
      },
    });
    const selectionFallback = buildFigmaDesignIndex({
      figmaUrl: "https://www.figma.com/design/PersonalShop/Personal-shop",
      metadata,
      format: "figma-mcp-xml",
      enrichment: {
        variableCatalog: {
          availability: "selection-only",
          source: "figma-selection",
        },
      },
    });
    expect(
      inspectDesignNode(selectionFallback, "60:2").deepContextRequest
        .recommendedTools,
    ).toContain("get_variable_defs");

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

  it("rejects corrupt cyclic parent relationships during inspection", async () => {
    const original = await checkoutIndex();
    const nodes = original.nodes.map((node) => ({ ...node }));
    const first = nodes.find((node) => node.id === "10:1")!;
    const second = nodes.find((node) => node.id !== first.id)!;
    first.parentId = second.id;
    second.parentId = first.id;
    const corrupt = { ...original, nodes };

    expect(() => inspectDesignNode(corrupt, first.id)).toThrow(
      /cyclic parent relationship/,
    );
  });

  it("bounds corrupt and excessively deep Figma metadata", () => {
    const document: Record<string, unknown> = {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [],
    };
    (document.children as unknown[]).push(document);
    expect(() =>
      buildFigmaDesignIndex({
        figmaUrl: "https://www.figma.com/design/SafetyFixture/Safety",
        metadata: { document },
      }),
    ).toThrow(/cyclic node/);

    const depth = 130;
    const opening = Array.from(
      { length: depth },
      (_, index) => `<frame id="${index}:1" name="Level ${index}">`,
    ).join("");
    const closing = "</frame>".repeat(depth);
    expect(() =>
      buildFigmaDesignIndex({
        figmaUrl: "https://www.figma.com/design/SafetyFixture/Safety",
        metadata: `${opening}${closing}`,
        format: "figma-mcp-xml",
      }),
    ).toThrow(/128-level safety limit/);
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
    expect(upgraded.schemaVersion).toBe(4);
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
