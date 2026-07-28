import {
  ACTION_CENTER_SCHEMA_VERSION,
  type ActionCenterItem,
} from "@component-atlas/core";
import type { MemoryFinding } from "@component-atlas/memory";
import type { SourceHealthViewModel } from "@component-atlas/runtime";
import { describe, expect, it } from "vitest";
import {
  localizeActionCenterItem,
  localizeHealthFinding,
  localizeMemoryFinding,
  localizeSourceHealth,
} from "./generated";

function contradiction(): ActionCenterItem {
  return {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    id: "contradiction:theme",
    projectId: "project",
    checkoutId: "checkout",
    type: "contradiction",
    state: "awaiting-decision",
    severity: "high",
    blocking: true,
    title: "Use coral conflicts with Never use coral",
    detected: "Atlas found two active Project Memory rules that contradict each other.",
    whyItMatters: "Generated analysis",
    affectedTask: "Any task governed by rule-one or rule-two",
    consequence: "Generated consequence",
    recommendation: "Generated recommendation",
    source: "memory",
    provenance: [{
      source: "memory",
      canonicalId: "rule-one",
      rule: "active-memory-contradiction",
      observedAt: "2026-07-28T12:00:00.000Z",
    }],
    evidence: [
      {
        id: "rule-one",
        source: "memory",
        label: "Use coral for primary actions",
        handle: "memory:rule-one",
        summary: "User-authored canonical evidence one.",
      },
      {
        id: "rule-two",
        source: "memory",
        label: "Never use coral on destructive actions",
        handle: "memory:rule-two",
        summary: "User-authored canonical evidence two.",
      },
    ],
    evidenceFingerprint: "fingerprint",
    detectedAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
  };
}

describe("generated Atlas copy localization", () => {
  it("composes Action Center analysis in Spanish without translating evidence", () => {
    const item = contradiction();
    const localized = localizeActionCenterItem(item, "es");

    expect(localized.title).toContain(item.evidence[0]!.label);
    expect(localized.title).toContain("entra en conflicto");
    expect(localized.detected).toContain("Atlas encontró");
    expect(localized.options[0]?.label).toContain("es la fuente autoritativa");
    expect(item.evidence[0]?.summary).toBe(
      "User-authored canonical evidence one.",
    );
  });

  it("returns the server-authored English representation unchanged", () => {
    const item = contradiction();
    const localized = localizeActionCenterItem(item, "en");

    expect(localized.title).toBe(item.title);
    expect(localized.recommendation).toBe(item.recommendation);
  });

  it("localizes a Memory Inbox finding as one bilingual representation", () => {
    const finding: MemoryFinding = {
      id: "finding:duplicate",
      level: "warning",
      code: "duplicate-memory",
      title: "Potential duplicate memory",
      evidence: ["Keep this indexed evidence in its original language."],
      recommendation: "Combine the entries.",
    };

    expect(localizeMemoryFinding(finding, "es")).toEqual({
      title: "La propuesta duplica conocimiento existente",
      recommendation:
        "Combina o sustituye el elemento existente en lugar de crear una segunda autoridad.",
    });
    expect(finding.evidence).toEqual([
      "Keep this indexed evidence in its original language.",
    ]);
  });

  it("localizes Atlas-owned source summaries without translating indexed evidence", () => {
    const source: SourceHealthViewModel = {
      id: "repository",
      source: "repository",
      label: "Repository index",
      status: "healthy",
      detail: "1 components · 2 relations",
      refreshAvailable: true,
    };
    expect(localizeSourceHealth(source, "es")).toEqual({
      label: "Índice del repositorio",
      detail: "1 componente · 2 relaciones",
    });
    expect(localizeSourceHealth(source, "en").detail).toBe(source.detail);
  });

  it("localizes the known local-artifact finding while preserving tool names", () => {
    const finding = {
      id: "local-artifacts-formatter-scope",
      title: "Local Atlas artifacts may enter formatter or lint scans",
      detail: "Detected prettier and eslint without an Atlas-specific ignore entry.",
      recommendation: "Add the ignore entry.",
    };
    const localized = localizeHealthFinding(finding, "es");
    expect(localized.title).toContain("artefactos locales");
    expect(localized.detail).toContain("prettier and eslint");
    expect(localizeHealthFinding(finding, "en")).toEqual(finding);
  });
});
