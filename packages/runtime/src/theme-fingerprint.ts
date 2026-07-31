import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  SOURCE_RECEIPT_SCHEMA_VERSION,
  slash,
  type ComponentNode,
  type DesignToken,
  type ProjectThemeFingerprint,
} from "@component-atlas/core";
import type { DesignFileIndex } from "@component-atlas/design";
import fg from "fast-glob";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values: Iterable<string>, limit = 40): string[] {
  return [...new Set(values)]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

function matches(sources: string[], expression: RegExp): string[] {
  return sources.flatMap((source) =>
    [...source.matchAll(expression)].flatMap((match) => match[1] ?? []),
  );
}

export async function buildThemeFingerprint(
  rootPath: string,
  components: ComponentNode[],
  tokens: DesignToken[],
): Promise<ProjectThemeFingerprint> {
  const files = await fg(
    [
      "**/*.{css,scss,sass,less}",
      "**/tailwind.config.{js,cjs,mjs,ts}",
      "!**/node_modules/**",
      "!**/.nuxt/**",
      "!**/.output/**",
      "!**/dist/**",
      "!**/coverage/**",
      "!**/.component-atlas/**",
    ],
    { cwd: rootPath, absolute: true, onlyFiles: true, unique: true },
  );
  const loaded = await Promise.all(
    files.map(async (file) => ({ file, source: await readFile(file, "utf8") })),
  );
  const styleSources = loaded.map((item) => item.source);
  const tokenValues = (kind: DesignToken["kind"]) =>
    tokens.filter((token) => token.kind === kind).map((token) => token.value);
  const colors = unique([
    ...tokenValues("color"),
    ...matches(
      styleSources,
      /(?:^|[\s:(,])((?:#[0-9a-f]{3,8})|(?:rgb|hsl|oklch|lab|lch)a?\([^;\n}]+\))/giu,
    ),
  ]);
  const typography = unique([
    ...tokenValues("typography"),
    ...matches(
      styleSources,
      /(?:font-family|font-size|font-weight|line-height)\s*:\s*([^;\n}]+)/giu,
    ),
  ]);
  const spacing = unique([
    ...tokenValues("space"),
    ...matches(
      styleSources,
      /(?:gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;\n}]+)/giu,
    ),
  ]);
  const radii = unique([
    ...tokenValues("radius"),
    ...matches(styleSources, /border-radius\s*:\s*([^;\n}]+)/giu),
  ]);
  const shadows = unique([
    ...tokenValues("shadow"),
    ...matches(styleSources, /box-shadow\s*:\s*([^;\n}]+)/giu),
  ]);
  const breakpoints = unique([
    ...matches(
      styleSources,
      /@media[^{]*(?:min|max)-width\s*:\s*([^)]+)/giu,
    ),
    ...matches(
      styleSources,
      /(?:screens|breakpoints)[\s\S]{0,500}?['"]?[a-z0-9_-]+['"]?\s*:\s*['"]([^'"]+)['"]/giu,
    ),
  ]);
  const primitiveCounts = new Map<string, { uses: number; variants: Set<string> }>();
  for (const component of components) {
    for (const name of component.renderedNames) {
      if (!/^[A-Z]/u.test(name)) continue;
      const entry = primitiveCounts.get(name) ?? { uses: 0, variants: new Set() };
      entry.uses += 1;
      component.classTokens
        .filter((token) => /(?:variant|size|tone|state|active|disabled)/iu.test(token))
        .slice(0, 8)
        .forEach((token) => entry.variants.add(token));
      primitiveCounts.set(name, entry);
    }
  }
  const primitives = [...primitiveCounts]
    .map(([name, value]) => ({
      name,
      uses: value.uses,
      variants: unique(value.variants, 8),
    }))
    .sort((left, right) => right.uses - left.uses || left.name.localeCompare(right.name))
    .slice(0, 20);
  const allClasses = components.flatMap((component) => component.classTokens);
  const interactiveStates = unique(
    [
      ...allClasses.flatMap(
        (token) =>
          token.match(
            /(?:focus-visible|focus|hover|active|disabled|error|loading)/giu,
          ) ?? [],
      ),
      ...matches(
        styleSources,
        /(?::|\b)(focus-visible|focus|hover|active|disabled|error|loading)\b/giu,
      ),
    ].map((token) => token.toLowerCase()),
    12,
  );
  const forms = unique(
    components
      .filter((component) =>
        component.renderedNames.some((name) =>
          /^(?:form|input|select|textarea|button)$/iu.test(name),
        ),
      )
      .map((component) => component.effectiveName),
    12,
  );
  const responsive = unique(
    allClasses.filter((token) => /^(?:sm|md|lg|xl|2xl):/u.test(token)),
    16,
  );
  const representativeSurfaces = components
    .filter((component) => component.kind === "route")
    .sort(
      (left, right) =>
        (right.renderedNames.length + right.classTokens.length) -
          (left.renderedNames.length + left.classTokens.length) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3)
    .map((component) => ({
      componentId: component.id,
      ...(component.routePath ? { routePath: component.routePath } : {}),
      relativePath: component.relativePath,
    }));
  const provenance = loaded.map(({ file, source }) => ({
    kind: path.basename(file).startsWith("tailwind.config")
      ? ("tailwind" as const)
      : ("css" as const),
    source: slash(path.relative(rootPath, file)),
    hash: digest(source),
  }));
  const content = {
    colors,
    typography,
    spacing,
    radii,
    shadows,
    breakpoints,
    primitives,
    forms,
    interactiveStates,
    responsive,
    representativeSurfaces,
    provenance,
  };
  const evidenceCount =
    tokens.length + loaded.length + primitives.length + representativeSurfaces.length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    hash: digest(JSON.stringify(content)),
    confidence:
      evidenceCount >= 12 ? "high" : evidenceCount >= 4 ? "medium" : "low",
    coverage: {
      styleFiles: loaded.length,
      tokenCount: tokens.length,
      componentCount: components.length,
      figmaVariables: 0,
    },
    values: { colors, typography, spacing, radii, shadows, breakpoints },
    primitives,
    patterns: { forms, interactiveStates, responsive },
    representativeSurfaces,
    provenance,
  };
}

export function enrichThemeFingerprintWithFigma(
  fingerprint: ProjectThemeFingerprint,
  indexes: DesignFileIndex[],
): ProjectThemeFingerprint {
  const confirmed = indexes.filter(
    (index) =>
      index.variables.totalVariables > 0 &&
      index.sources.some(
        (source) =>
          source.receipt.schemaVersion === SOURCE_RECEIPT_SCHEMA_VERSION &&
          source.receipt.freshness === "current" &&
          source.receipt.resolved.fileKey === index.file.key,
      ),
  );
  if (confirmed.length === 0) return fingerprint;
  const variables = confirmed.flatMap((index) => index.variables.variables);
  const colors = variables
    .filter((variable) => variable.resolvedType === "COLOR")
    .map((variable) => `figma:${variable.name}`);
  const spacing = variables
    .filter(
      (variable) =>
        variable.resolvedType === "FLOAT" &&
        /space|gap|padding|margin|size/iu.test(variable.name),
    )
    .map((variable) => `figma:${variable.name}`);
  const provenance = confirmed.map((index) => {
    const receipt = index.sources.find(
      (source) =>
        source.receipt.schemaVersion === SOURCE_RECEIPT_SCHEMA_VERSION &&
        source.receipt.freshness === "current",
    )!.receipt;
    return {
      kind: "figma-variable" as const,
      source: index.file.key,
      hash: digest(
        JSON.stringify({
          collections: index.variables.collections,
          variables: index.variables.variables,
        }),
      ),
      receiptId: receipt.id,
    };
  });
  const values = {
    ...fingerprint.values,
    colors: unique([...fingerprint.values.colors, ...colors]),
    spacing: unique([...fingerprint.values.spacing, ...spacing]),
  };
  const hashContent = {
    base: fingerprint.hash,
    values,
    provenance,
  };
  return {
    ...fingerprint,
    hash: digest(JSON.stringify(hashContent)),
    coverage: {
      ...fingerprint.coverage,
      figmaVariables: variables.length,
    },
    values,
    provenance: [...fingerprint.provenance, ...provenance],
  };
}
