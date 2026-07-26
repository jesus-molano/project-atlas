import { describe, expect, it } from "vitest";

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

describe("Surveyor Ink contrast", () => {
  it.each([
    ["primary text", "#f0ebdd", "#201f1a", 7],
    ["secondary text", "#c1bbab", "#201f1a", 4.5],
    ["quiet text", "#928b7d", "#201f1a", 4.5],
    ["copper action", "#d89a68", "#201f1a", 4.5],
    ["local state", "#92bb98", "#201f1a", 4.5],
    ["design evidence", "#d2a45e", "#201f1a", 4.5],
    ["memory evidence", "#c28f91", "#201f1a", 4.5],
    ["decision state", "#e87968", "#201f1a", 4.5],
    ["primary button label", "#24170f", "#d89a68", 4.5],
  ])("%s meets its target", (_label, foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
