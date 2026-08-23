import { access } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import YAML from "yaml";
import {
  slash,
  type Framework,
  type MetaFramework,
  type ProjectPackageProfile,
  type ProjectProfile,
  type RouterMode,
} from "@component-atlas/core";
import {
  createScanSafetySession,
  type ScanSafetySession,
} from "@component-atlas/core/scan-safety";

interface PackageManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(rootPath: string, session: ScanSafetySession): Promise<PackageManifest> {
  try {
    return JSON.parse(
      await session.readText(path.join(rootPath, "package.json")),
    ) as PackageManifest;
  } catch {
    return {};
  }
}

function workspacePatterns(manifest: PackageManifest): string[] {
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces;
  return manifest.workspaces?.packages ?? [];
}

async function packageRoots(rootPath: string, manifest: PackageManifest, session: ScanSafetySession): Promise<string[]> {
  const patterns = new Set(workspacePatterns(manifest));
  const pnpmWorkspace = path.join(rootPath, "pnpm-workspace.yaml");
  if (await exists(pnpmWorkspace)) {
    try {
      const parsed = YAML.parse(await session.readText(pnpmWorkspace)) as {
        packages?: unknown;
      };
      if (Array.isArray(parsed.packages)) {
        for (const pattern of parsed.packages) {
          if (typeof pattern === "string") patterns.add(pattern);
        }
      }
    } catch {
      // The root package remains inspectable even when workspace metadata is invalid.
    }
  }
  const manifests = patterns.size
    ? await fg(
        [...patterns].map((pattern) => `${pattern.replace(/\/$/u, "")}/package.json`),
        {
          cwd: rootPath,
          absolute: true,
          onlyFiles: true,
          unique: true,
          followSymbolicLinks: false,
          ignore: ["**/node_modules/**", "**/.git/**"],
        },
      )
    : [];
  return [
    rootPath,
    ...(await session.files(manifests)).map((filePath) => path.dirname(filePath)),
  ].filter(
    (candidate, index, collection) =>
      collection.findIndex(
        (value) => path.resolve(value).toLowerCase() === path.resolve(candidate).toLowerCase(),
      ) === index,
  );
}

function dependencyMap(manifest: PackageManifest): Record<string, string> {
  return {
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
}

async function configMetaFramework(
  rootPath: string,
  dependencies: Record<string, string>,
): Promise<MetaFramework | undefined> {
  if (
    dependencies.astro ||
    (await exists(path.join(rootPath, "astro.config.ts"))) ||
    (await exists(path.join(rootPath, "astro.config.mjs"))) ||
    (await exists(path.join(rootPath, "astro.config.js")))
  ) {
    return "astro";
  }
  if (
    dependencies.nuxt ||
    (await exists(path.join(rootPath, "nuxt.config.ts"))) ||
    (await exists(path.join(rootPath, "nuxt.config.js")))
  ) {
    return "nuxt";
  }
  if (
    dependencies.next ||
    (await exists(path.join(rootPath, "next.config.ts"))) ||
    (await exists(path.join(rootPath, "next.config.mjs"))) ||
    (await exists(path.join(rootPath, "next.config.js")))
  ) {
    return "next";
  }
  return undefined;
}

async function routerMode(
  rootPath: string,
  metaFramework: MetaFramework | undefined,
  dependencies: Record<string, string>,
): Promise<RouterMode | undefined> {
  if (metaFramework === "astro") return "astro";
  if (metaFramework === "next") {
    const hasApp =
      (await exists(path.join(rootPath, "app"))) ||
      (await exists(path.join(rootPath, "src", "app")));
    const hasPages =
      (await exists(path.join(rootPath, "pages"))) ||
      (await exists(path.join(rootPath, "src", "pages")));
    if (hasApp && hasPages) return "hybrid";
    if (hasApp) return "app";
    return "pages";
  }
  if (
    dependencies["vue-router"] ||
    (await exists(path.join(rootPath, "src", "router"))) ||
    (await exists(path.join(rootPath, "router")))
  ) {
    return "vue-router";
  }
  return undefined;
}

async function packageProfile(
  projectRoot: string,
  packageRoot: string,
  session: ScanSafetySession,
): Promise<ProjectPackageProfile | undefined> {
  const manifest = await readManifest(packageRoot, session);
  const dependencies = dependencyMap(manifest);
  const metaFramework = await configMetaFramework(packageRoot, dependencies);
  const frameworks: Framework[] = [];
  if (metaFramework === "astro") frameworks.push("astro");
  if (
    dependencies.react ||
    dependencies.next ||
    dependencies["@astrojs/react"]
  ) {
    frameworks.push("react");
  }
  if (
    dependencies.vue ||
    dependencies.nuxt ||
    dependencies["@astrojs/vue"]
  ) {
    frameworks.push("vue");
  }
  if (frameworks.length === 0) return undefined;
  const primaryFramework: Framework =
    metaFramework === "astro"
      ? "astro"
      : metaFramework === "next"
        ? "react"
        : metaFramework === "nuxt"
          ? "vue"
          : (frameworks[0] ?? "react");
  const versions: ProjectPackageProfile["versions"] = {};
  for (const framework of frameworks) {
    const dependencyName =
      framework === "astro" ? "astro" : framework;
    const version = dependencies[dependencyName];
    if (version) versions[framework] = version;
  }
  if (metaFramework) {
    const version = dependencies[metaFramework];
    if (version) versions[metaFramework] = version;
  }
  const evidence = [
    ...frameworks.flatMap((framework) =>
      dependencies[framework] ? [`dependency:${framework}`] : [],
    ),
    ...(dependencies["@astrojs/react"] ? ["integration:@astrojs/react"] : []),
    ...(dependencies["@astrojs/vue"] ? ["integration:@astrojs/vue"] : []),
    ...(metaFramework ? [`meta-framework:${metaFramework}`] : []),
  ];
  const router = await routerMode(packageRoot, metaFramework, dependencies);
  return {
    rootPath: path.resolve(packageRoot),
    relativeRoot: slash(path.relative(projectRoot, packageRoot)),
    name: manifest.name ?? path.basename(packageRoot),
    frameworks: [...new Set(frameworks)],
    primaryFramework,
    ...(metaFramework ? { metaFramework } : {}),
    ...(router ? { router } : {}),
    versions,
    confidence: "high",
    evidence,
  };
}

export async function detectProjectProfile(
  rootPath: string,
  scanSafetySession?: ScanSafetySession,
): Promise<ProjectProfile> {
  const resolvedRoot = path.resolve(rootPath);
  const session = scanSafetySession ?? await createScanSafetySession(resolvedRoot);
  const manifest = await readManifest(resolvedRoot, session);
  const roots = await packageRoots(resolvedRoot, manifest, session);
  const packages: ProjectPackageProfile[] = [];
  for (const candidate of roots.sort((left, right) => left.localeCompare(right))) {
    const profile = await packageProfile(resolvedRoot, candidate, session);
    if (profile) packages.push(profile);
  }
  if (packages.length === 0) {
    throw new Error(
      `Could not detect Astro, Vue/Nuxt, or React/Next in ${resolvedRoot}.`,
    );
  }
  const frameworks = [
    ...new Set(packages.flatMap((profile) => profile.frameworks)),
  ];
  const primary =
    packages.find((profile) => profile.relativeRoot === "") ?? packages[0];
  return {
    primaryFramework: primary?.primaryFramework ?? frameworks[0] ?? "react",
    frameworks,
    packages,
    confidence: packages.every((profile) => profile.confidence === "high")
      ? "high"
      : "medium",
    diagnostics: [],
  };
}
