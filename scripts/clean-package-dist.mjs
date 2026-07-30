import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packageRoot = path.resolve(process.cwd());
const packagesRoot = path.join(workspaceRoot, "packages");
const relative = path.relative(packagesRoot, packageRoot);

if (
  !relative ||
  relative.startsWith("..") ||
  path.isAbsolute(relative) ||
  relative.includes(path.sep)
) {
  throw new Error(
    `Refusing to clean dist outside a direct workspace package: ${packageRoot}`,
  );
}

const manifest = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
if (
  typeof manifest.name !== "string" ||
  !manifest.name.startsWith("@component-atlas/")
) {
  throw new Error(`Refusing to clean an unrecognized package: ${packageRoot}`);
}

const distPath = path.resolve(packageRoot, "dist");
if (path.dirname(distPath) !== packageRoot) {
  throw new Error(`Resolved dist path escaped the package: ${distPath}`);
}
await access(packageRoot);
await rm(distPath, { recursive: true, force: true });
