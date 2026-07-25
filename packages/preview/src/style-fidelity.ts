import path from "node:path";
import type { Plugin } from "vite";

const ATLAS_SOURCE_MARKER = "component-atlas: project source";
const TAILWIND_IMPORT =
  /@import\s+(?:url\(\s*)?["']tailwindcss["'](?:\s*\))?[^;]*;/;

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

function sourcePath(stylePath: string, rootPath: string): string {
  const relative = slash(path.relative(path.dirname(stylePath), rootPath));
  if (!relative) return ".";
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/**
 * Tailwind v4 starts automatic source detection from the build process working
 * directory. Component Atlas owns that process, so the stylesheet must
 * explicitly point Tailwind back at the project being previewed.
 */
export function injectProjectTailwindSource(
  css: string,
  stylePath: string,
  rootPath: string,
): string {
  if (!TAILWIND_IMPORT.test(css) || css.includes(ATLAS_SOURCE_MARKER)) {
    return css;
  }

  return `${css.trimEnd()}

/* ${ATLAS_SOURCE_MARKER} */
@source "${sourcePath(stylePath, rootPath)}";
`;
}

export function styleFidelityPlugin(
  rootPath: string,
  stylePaths: string[],
): Plugin {
  const resolvedStyles = new Set(
    stylePaths.map((stylePath) => slash(path.resolve(stylePath)).toLowerCase()),
  );

  return {
    name: "component-atlas-style-fidelity",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0];
      if (!cleanId) return undefined;
      const resolvedId = slash(path.resolve(cleanId)).toLowerCase();
      if (!resolvedStyles.has(resolvedId)) return undefined;

      const transformed = injectProjectTailwindSource(
        code,
        cleanId,
        rootPath,
      );
      if (transformed === code) return undefined;
      return { code: transformed, map: null };
    },
  };
}
