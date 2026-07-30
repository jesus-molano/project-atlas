import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const packagesRoot = path.join(repositoryRoot, "packages");
const forbiddenArtifact = /(?:^|[\\/])(?:__tests__|[^\\/]*\.(?:test|spec))(?:\.|[\\/]|$)/i;
const sourceMapWithTest = /(?:\.test|\.spec)\.[cm]?[jt]sx?$/i;
const failures = [];

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
  const dist = path.join(packagesRoot, entry.name, "dist");
  try {
    await walk(dist);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Published package artifacts contain tests:\n${failures.map((item) => `- ${item}`).join("\n")}`,
  );
}

console.log("Package artifacts are free of test and spec files.");
