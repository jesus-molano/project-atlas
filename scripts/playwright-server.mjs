import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fixtureRoot = path.join(repositoryRoot, "fixtures", "vue-nuxt");
const stateRoot = path.join(repositoryRoot, ".cache", "playwright-atlas");
const allowedCacheRoot = path.join(repositoryRoot, ".cache");
const relativeStateRoot = path.relative(allowedCacheRoot, stateRoot);

if (
  relativeStateRoot.startsWith("..")
  || path.isAbsolute(relativeStateRoot)
  || relativeStateRoot.length === 0
) {
  throw new Error(`Refusing to reset unsafe Playwright state path: ${stateRoot}`);
}

await rm(stateRoot, { recursive: true, force: true });
await mkdir(stateRoot, { recursive: true });

const environment = {
  ...process.env,
  ATLAS_PROJECT_ROOT: fixtureRoot,
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: "4174",
  PROJECT_ATLAS_HOME: stateRoot,
};
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx",
      path.join(repositoryRoot, "packages", "cli", "src", "index.ts"),
      ...args,
    ], {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Atlas CLI ${args.join(" ")} failed with ${signal ?? `code ${code}`}.`,
          ),
        );
      }
    });
  });
}

await run(["scan", fixtureRoot]);
const recentProjects = JSON.parse(
  await readFile(path.join(stateRoot, "recent-projects.json"), "utf8"),
);
const seededProject = recentProjects.projects?.find(
  (project) => path.resolve(project.rootPath) === path.resolve(fixtureRoot),
);
if (!seededProject?.id || !seededProject.checkoutId) {
  throw new Error("The Playwright seed scan did not record its project identity.");
}
environment.ATLAS_PROJECT_ID = seededProject.id;
environment.ATLAS_CHECKOUT_ID = seededProject.checkoutId;
await run([
  "figma",
  "map",
  fixtureRoot,
  "https://www.figma.com/design/PersonalShop/Personal-shop",
  "--metadata",
  path.join(repositoryRoot, "fixtures", "figma", "personal-no-dev-mode.xml"),
  "--format",
  "figma-mcp-xml",
  "--file-name",
  "Personal shop",
]);

process.env.ATLAS_PROJECT_ROOT = fixtureRoot;
process.env.ATLAS_PROJECT_ID = seededProject.id;
process.env.ATLAS_CHECKOUT_ID = seededProject.checkoutId;
process.env.NITRO_HOST = "127.0.0.1";
process.env.NITRO_PORT = "4174";
process.env.PROJECT_ATLAS_HOME = stateRoot;
await import("../apps/viewer/.output/server/index.mjs");
