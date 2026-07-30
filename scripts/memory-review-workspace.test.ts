import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  formatMemoryDateTime,
  memoryEnumLabel,
  memoryText,
} from "../apps/viewer/app/utils/memory-i18n";
import { readViewerCss } from "./viewer-css";

async function source(relativePath: string): Promise<string> {
  if (relativePath.endsWith("/assets/css/main.css")) {
    return readViewerCss();
  }
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Memory review workspace contract", () => {
  it("keeps the hard approval gate and canonical acknowledgement in runtime", async () => {
    const [runtime, route, mcp] = await Promise.all([
      Promise.all([
        source("packages/runtime/src/memory.ts"),
        source("packages/runtime/src/memory-proposals.ts"),
      ]).then((parts) => parts.join("\n")),
      source("apps/viewer/server/api/memory-proposal.post.ts"),
      Promise.all([
        source("packages/mcp/src/index.ts"),
        source("packages/mcp/src/memory-tools.ts"),
      ]).then((parts) => parts.join("\n")),
    ]);
    expect(runtime).toContain("reviewMemoryProposal");
    expect(runtime).toContain("unresolved decision-required findings");
    expect(runtime).toContain("canonicalConfirmed=true");
    expect(route).toContain("canonicalConfirmed");
    expect(mcp).toContain("canonical_confirmed");
  });

  it("renders complete proposal content, exact paths, and reinforced confirmation", async () => {
    const view = await source(
      "apps/viewer/app/components/MemoryInboxView.vue",
    );
    for (const contract of [
      "proposal-review-card",
      "item.body ?? item.summary",
      "item.relations",
      "item.provenance",
      "item.supersedes",
      "review.impact.items",
      "canonicalAcknowledged",
      "blockingFindings",
      "type=\"radio\"",
      "role=\"dialog\"",
      "role=\"status\"",
      "role=\"alert\"",
      "localizeMemoryFinding",
      "\"x-atlas-session\": session.token",
    ]) {
      expect(view).toContain(contract);
    }
  });

  it("uses a three-pane sticky layout and a compact sticky action gate", async () => {
    const css = await source("apps/viewer/app/assets/css/main.css");
    expect(css).toContain("grid-template-areas: \"index detail actions\"");
    expect(css).toMatch(
      /\.inbox-layout > \.proposal-actions\s*\{[^}]*position:\s*sticky/s,
    );
    expect(css).toMatch(/"index"\s*"actions"\s*"detail"/);
    expect(css).toContain("max-height: min(44vh, 380px)");
  });

  it("localizes Memory labels, enums, dates, and the document language", async () => {
    const [page, i18n] = await Promise.all([
      source("apps/viewer/app/pages/index.vue"),
      source("apps/viewer/app/composables/useAtlasI18n.ts"),
    ]);
    const memory = await source(
      "apps/viewer/app/components/ProjectMemoryView.vue",
    );
    expect(page).toContain("useAtlasI18n()");
    expect(page).toContain(":memory-items=\"workspace.memoryItems\"");
    expect(i18n).toContain("htmlAttrs:");
    expect(i18n).toContain("lang: locale.value");
    expect(memory).toContain(":aria-pressed");
    expect(memory).toContain("aria-live=\"polite\"");
    expect(memoryText("es", "reviewApproval")).toBe("Revisar aprobación");
    expect(memoryEnumLabel("es", "decision-required")).toBe(
      "Requiere decisión",
    );
    expect(memoryEnumLabel("es", "references_code")).toBe(
      "referencia código",
    );
    expect(
      formatMemoryDateTime("es", "2026-07-28T12:00:00.000Z"),
    ).toContain("2026");
  });
});
