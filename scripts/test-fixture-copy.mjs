import { cp } from "node:fs/promises";
import path from "node:path";

const GENERATED_SEGMENTS = new Set([
  ".cache",
  ".component-atlas",
  ".nuxt",
  ".output",
  "coverage",
  "dist",
  "node_modules",
]);

export async function copyFixture(
  source,
  destination,
  options = {},
) {
  const sourceRoot = path.resolve(source);
  const includeAtlasState = options.includeAtlasState ?? false;
  await cp(sourceRoot, destination, {
    recursive: true,
    filter(candidate) {
      const relative = path.relative(sourceRoot, path.resolve(candidate));
      if (!relative) return true;
      return relative.split(path.sep).every(
        (segment) =>
          !GENERATED_SEGMENTS.has(segment) ||
          (includeAtlasState && segment === ".component-atlas"),
      );
    },
  });
}
