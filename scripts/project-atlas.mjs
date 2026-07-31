import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { normalizeProjectAtlasArguments } from "./project-atlas-arguments.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(repositoryRoot, "packages", "cli", "dist", "index.js");
const viewerEntry = path.join(
  repositoryRoot,
  "apps",
  "viewer",
  ".output",
  "server",
  "index.mjs",
);
const ignoredDirectories = new Set([
  ".git",
  ".nuxt",
  ".output",
  "dist",
  "node_modules",
]);
const buildInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "packages",
  "apps/viewer/app",
  "apps/viewer/server",
  "apps/viewer/shared",
  "apps/viewer/package.json",
  "apps/viewer/nuxt.config.ts",
];

async function modifiedAt(filePath) {
  return stat(filePath)
    .then((result) => result.mtimeMs)
    .catch(() => 0);
}

async function newestInputAt(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const entries = await readdir(absolutePath, { withFileTypes: true }).catch(
    () => undefined,
  );
  if (!entries) return modifiedAt(absolutePath);
  const times = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map((entry) =>
        entry.isDirectory()
          ? newestInputAt(
              path.relative(
                repositoryRoot,
                path.join(absolutePath, entry.name),
              ),
            )
          : modifiedAt(path.join(absolutePath, entry.name)),
      ),
  );
  return Math.max(0, ...times);
}

async function productBuildIsCurrent() {
  const [cliBuiltAt, viewerBuiltAt, ...inputTimes] = await Promise.all([
    modifiedAt(cliEntry),
    modifiedAt(viewerEntry),
    ...buildInputs.map(newestInputAt),
  ]);
  if (!cliBuiltAt || !viewerBuiltAt) return false;
  return Math.max(...inputTimes) <= Math.min(cliBuiltAt, viewerBuiltAt);
}

function buildProduct() {
  process.stdout.write("Preparing Project Atlas for local use...\n");
  const pnpmScript = process.env.npm_execpath;
  const result = pnpmScript
    ? spawnSync(process.execPath, [pnpmScript, "build"], {
        cwd: repositoryRoot,
        stdio: "inherit",
      })
    : spawnSync("pnpm", ["build"], {
        cwd: repositoryRoot,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Project Atlas build failed with exit code ${result.status}.`);
  }
}

try {
  if (!(await productBuildIsCurrent())) buildProduct();
  const { createProgram } = await import(pathToFileURL(cliEntry).href);
  const program = createProgram();
  const cliArguments = normalizeProjectAtlasArguments(
    process.argv.slice(2),
    program.commands.map((command) => command.name()),
  );
  await program.parseAsync([
    process.execPath,
    "project-atlas",
    ...cliArguments,
  ]);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
