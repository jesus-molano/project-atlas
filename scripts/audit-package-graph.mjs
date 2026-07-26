import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const workspaceRoots = ["packages", "apps"];
const manifests = [];
for (const workspaceRoot of workspaceRoots) {
  const directory = path.join(root, workspaceRoot);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(directory, entry.name, "package.json");
    const manifest = JSON.parse(await readFile(filePath, "utf8"));
    manifests.push({ filePath, manifest });
  }
}

const byName = new Map(manifests.map((entry) => [entry.manifest.name, entry]));
const dependencies = new Map();
for (const { manifest } of manifests) {
  const declared = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
  dependencies.set(
    manifest.name,
    Object.keys(declared).filter((name) => byName.has(name)).sort(),
  );
}

const visited = new Set();
const active = new Set();
const cycles = [];
function visit(name, pathToName = []) {
  if (active.has(name)) {
    cycles.push([...pathToName, name].join(" -> "));
    return;
  }
  if (visited.has(name)) return;
  active.add(name);
  for (const dependency of dependencies.get(name) ?? []) {
    visit(dependency, [...pathToName, name]);
  }
  active.delete(name);
  visited.add(name);
}
for (const name of dependencies.keys()) visit(name);

const allowed = {
  "@component-atlas/core": [],
  "@component-atlas/memory": [],
  "@component-atlas/agent": [],
  "@component-atlas/design": ["@component-atlas/core"],
  "@component-atlas/adapter-react": ["@component-atlas/core"],
  "@component-atlas/adapter-vue": ["@component-atlas/core"],
  "@component-atlas/store": [
    "@component-atlas/core",
    "@component-atlas/design",
    "@component-atlas/memory",
  ],
  "@component-atlas/runtime": [
    "@component-atlas/adapter-react",
    "@component-atlas/adapter-vue",
    "@component-atlas/core",
    "@component-atlas/design",
    "@component-atlas/memory",
    "@component-atlas/store",
  ],
  "@component-atlas/mcp": [
    "@component-atlas/core",
    "@component-atlas/memory",
    "@component-atlas/runtime",
  ],
  "@component-atlas/cli": [
    "@component-atlas/core",
    "@component-atlas/mcp",
    "@component-atlas/memory",
    "@component-atlas/runtime",
  ],
  "@component-atlas/viewer": [
    "@component-atlas/agent",
    "@component-atlas/core",
    "@component-atlas/design",
    "@component-atlas/memory",
    "@component-atlas/runtime",
    "@component-atlas/store",
  ],
};

const violations = [];
for (const [name, actual] of dependencies) {
  const permitted = new Set(allowed[name] ?? []);
  for (const dependency of actual) {
    if (!permitted.has(dependency)) {
      violations.push(`${name} must not depend on ${dependency}`);
    }
  }
}
if (cycles.length > 0 || violations.length > 0) {
  throw new Error(
    [...cycles.map((cycle) => `Dependency cycle: ${cycle}`), ...violations].join(
      "\n",
    ),
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      packages: dependencies.size,
      edges: [...dependencies.values()].reduce(
        (total, values) => total + values.length,
        0,
      ),
      cycles: 0,
      dependencies: Object.fromEntries(dependencies),
    },
    null,
    2,
  )}\n`,
);
