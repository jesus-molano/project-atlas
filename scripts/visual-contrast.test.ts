import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const css = await readFile(
  new URL("../apps/viewer/app/assets/css/main.css", import.meta.url),
  "utf8",
);

function tokenValue(name: string): string {
  const declaration = css.match(
    new RegExp(`--${name}:\\s*([^;]+);`),
  )?.[1]?.trim();
  if (!declaration) {
    throw new Error(`Missing color token --${name}`);
  }
  const alias = declaration.match(/^var\(--([^)]+)\)$/)?.[1];
  return alias ? tokenValue(alias) : declaration;
}

function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return (
    0.2126 * channels[0]! +
    0.7152 * channels[1]! +
    0.0722 * channels[2]!
  );
}

function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort(
    (first, second) => second - first,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("Waypoint Signal contrast", () => {
  it.each([
    ["primary text", "atlas-ink", "atlas-canvas", 7],
    ["secondary text", "atlas-ink-muted", "atlas-canvas", 4.5],
    ["quiet and disabled text", "atlas-ink-faint", "atlas-canvas", 4.5],
    ["coral action", "atlas-accent", "atlas-canvas", 4.5],
    ["selected control", "atlas-selection", "atlas-canvas", 4.5],
    ["focus indicator", "atlas-focus", "atlas-canvas", 3],
    ["success state", "atlas-success", "atlas-canvas", 4.5],
    ["code and local category", "atlas-local", "atlas-canvas", 4.5],
    ["design category", "atlas-design", "atlas-canvas", 4.5],
    ["memory category", "atlas-memory", "atlas-canvas", 4.5],
    ["information state", "atlas-info", "atlas-canvas", 4.5],
    ["error state", "atlas-danger", "atlas-canvas", 4.5],
    ["warning state", "atlas-warning", "atlas-canvas", 4.5],
    ["essential control border", "atlas-control-border", "atlas-canvas", 3],
    ["primary button label", "atlas-accent-ink", "atlas-accent", 4.5],
  ])("%s meets its target", (_label, foreground, background, minimum) => {
    expect(
      contrast(tokenValue(foreground), tokenValue(background)),
    ).toBeGreaterThanOrEqual(minimum);
  });
});
