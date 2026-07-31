import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const packagesRoot = path.join(repositoryRoot, "packages");
const forbiddenArtifact = /(?:^|[\\/])(?:__tests__|[^\\/]*\.(?:test|spec))(?:\.|[\\/]|$)/i;
const sourceMapWithTest = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;
const failures = [];
const missingArtifacts = [];

function collectManifestPaths(value, results = []) {
  if (typeof value === "string") {
    if (value.startsWith("./")) results.push(value);
    return results;
  }
  if (!value || typeof value !== "object") return results;
  for (const nestedValue of Object.values(value)) {
    collectManifestPaths(nestedValue, results);
  }
  return results;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath);
      continue;
    }

    const relativePath = path.relative(repositoryRoot, absolutePath);
    if (forbiddenArtifact.test(relativePath)) {
      failures.push(relativePath);
      continue;
    }

    if (entry.name.endsWith(".map")) {
      const map = JSON.parse(await readFile(absolutePath, "utf8"));
      if (
        Array.isArray(map.sources)
        && map.sources.some((source) => sourceMapWithTest.test(String(source)))
      ) {
        failures.push(`${relativePath} (references a test source)`);
      }
    }
  }
}

const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
for (const entry of packageEntries) {
  if (!entry.isDirectory()) {
    continue;
  }
  const packageRoot = path.join(packagesRoot, entry.name);
  const manifestPath = path.join(packageRoot, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const declaredArtifacts = new Set([
    ...collectManifestPaths(manifest.main),
    ...collectManifestPaths(manifest.types),
    ...collectManifestPaths(manifest.bin),
    ...collectManifestPaths(manifest.exports),
  ]);
  for (const declaredArtifact of declaredArtifacts) {
    const artifactPath = path.resolve(packageRoot, declaredArtifact);
    const packageRelativePath = path.relative(packageRoot, artifactPath);
    if (
      packageRelativePath.startsWith("..")
      || path.isAbsolute(packageRelativePath)
    ) {
      failures.push(
        `${path.relative(repositoryRoot, manifestPath)} (unsafe entry ${declaredArtifact})`,
      );
      continue;
    }
    await access(artifactPath).catch(() => {
      missingArtifacts.push(path.relative(repositoryRoot, artifactPath));
    });
  }

  const dist = path.join(packagesRoot, entry.name, "dist");
  try {
    await walk(dist);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

if (failures.length > 0 || missingArtifacts.length > 0) {
  const details = [
    ...missingArtifacts.map((item) => `- missing: ${item}`),
    ...failures.map((item) => `- forbidden: ${item}`),
  ];
  throw new Error(
    `Published package artifacts are invalid:\n${details.join("\n")}`,
  );
}

console.log("Package artifacts are present and free of test and spec files.");
