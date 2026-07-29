import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCOPES = new Set(["component", "section", "page", "flow", "greenfield"]);
const VISUAL_DECISIONS = new Set([
  "open",
  "established-pattern",
  "selected-direction",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function parseReferences(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("references must be an array.");
  }
  return value.map((reference, index) => {
    const item = requireObject(reference, `references[${index}]`);
    const facets = item.facets ?? [];
    if (!Array.isArray(facets) || facets.some((facet) => typeof facet !== "string")) {
      throw new TypeError(`references[${index}].facets must be a string array.`);
    }
    return {
      id: requireString(item.id, `references[${index}].id`),
      compatibleWithProject: optionalBoolean(
        item.compatibleWithProject,
        `references[${index}].compatibleWithProject`,
        false,
      ),
      facets: [...new Set(facets)],
    };
  });
}

export function resolveAuthority(rawInput) {
  const input = requireObject(rawInput, "input");
  const scope = requireString(input.scope, "scope");
  if (!SCOPES.has(scope)) {
    throw new RangeError(`scope must be one of: ${[...SCOPES].join(", ")}.`);
  }

  const hasExistingProject = optionalBoolean(
    input.hasExistingProject,
    "hasExistingProject",
  );
  const hasExactFigma = optionalBoolean(input.hasExactFigma, "hasExactFigma");
  const explicitRedesign = optionalBoolean(
    input.explicitRedesign,
    "explicitRedesign",
  );
  const explicitFigmaWrite = optionalBoolean(
    input.explicitFigmaWrite,
    "explicitFigmaWrite",
  );
  const visualDecision = input.visualDecision ?? "open";
  if (!VISUAL_DECISIONS.has(visualDecision)) {
    throw new RangeError(
      `visualDecision must be one of: ${[...VISUAL_DECISIONS].join(", ")}.`,
    );
  }

  let exactFigmaIdentity;
  if (hasExactFigma) {
    const figma = requireObject(input.exactFigma, "exactFigma");
    exactFigmaIdentity = {
      fileKey: requireString(figma.fileKey, "exactFigma.fileKey"),
      nodeId: requireString(figma.nodeId, "exactFigma.nodeId"),
      url: requireString(figma.url, "exactFigma.url"),
    };
  } else if (input.exactFigma !== undefined) {
    throw new TypeError("exactFigma requires hasExactFigma: true.");
  }

  const defaultMaterialChoice =
    visualDecision === "open" && (scope === "component" || scope === "section");
  const materialVisualChoice = optionalBoolean(
    input.materialVisualChoice,
    "materialVisualChoice",
    defaultMaterialChoice,
  );
  const references = parseReferences(input.references);

  let mode;
  if (hasExactFigma) {
    mode = "fidelity";
  } else if (explicitRedesign) {
    mode = "redesign";
  } else if (hasExistingProject) {
    mode = "inherit";
  } else {
    mode = "explore";
  }

  const explorationRequired =
    visualDecision !== "selected-direction" &&
    ((mode === "inherit" &&
      visualDecision === "open" &&
      materialVisualChoice) ||
      mode === "explore" ||
      mode === "redesign");

  const inventionBudget = {
    fidelity: 0,
    inherit: 1,
    explore: 2,
    redesign: 3,
  }[mode];
  const previewCount = explorationRequired
    ? mode === "inherit"
      ? 2
      : 3
    : 0;

  const acceptedReferences = references
    .filter(
      (reference) =>
        !hasExistingProject || reference.compatibleWithProject === true,
    )
    .map((reference) => reference.id);
  const rejectedReferences = references
    .filter(
      (reference) =>
        hasExistingProject && reference.compatibleWithProject !== true,
    )
    .map((reference) => reference.id);

  const visualAuthority = hasExactFigma
    ? "exact-figma"
    : hasExistingProject
      ? "existing-system"
      : visualDecision === "selected-direction"
        ? "selected-direction"
        : "direction-selection-required";

  return {
    schemaVersion: 1,
    mode,
    inventionBudget,
    explorationRequired,
    previewCount,
    authority: {
      visual: visualAuthority,
      behavior: [
        "current-user-clarification",
        "acceptance-or-api",
        "figma-states",
        "repository",
      ],
      implementation: [
        "repository-components-and-tokens",
        "figma-context",
        "framework-defaults",
      ],
    },
    ...(exactFigmaIdentity ? { exactFigmaIdentity } : {}),
    referencePolicy: {
      accepted: acceptedReferences,
      rejected: rejectedReferences,
      use: "facet-only",
      incompatibleExternalAesthetics: "reject",
    },
    atlasRole: "context-and-provenance-only",
    atlasCandidateCanReplaceExactFigma: false,
    redesignRequiresExplicitRequest: true,
    productionImplementationCount: 1,
    previewWorktrees: 0,
    implementationWorktrees: 1,
    figmaWrite: explicitFigmaWrite ? "approved" : "explicit-only",
    artifacts: "ephemeral-only",
  };
}

async function readInput(argv) {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex >= 0) {
    const inputPath = argv[inputIndex + 1];
    if (!inputPath) throw new Error("--input requires a JSON file path.");
    return JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  }

  if (process.stdin.isTTY) {
    throw new Error("Pass --input <json-file> or pipe JSON to stdin.");
  }
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

async function main() {
  const input = await readInput(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(resolveAuthority(input), null, 2)}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
