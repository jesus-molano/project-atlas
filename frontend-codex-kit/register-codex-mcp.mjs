import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SECTION_NAME = "mcp_servers.component-atlas";

function tomlString(value) {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function createManagedBlock(nodeExecutable, mcpEntry, newline = "\n") {
  return [
    `[${SECTION_NAME}]`,
    `command = ${tomlString(nodeExecutable)}`,
    `args = [${tomlString(mcpEntry)}, "--profile", "core"]`,
    "",
  ].join(newline);
}

function normalizedHeader(header) {
  const normalized = header.trim();
  return /^mcp_servers\s*\.\s*(?:component-atlas|"component-atlas"|'component-atlas')$/.test(
    normalized,
  )
    ? SECTION_NAME
    : normalized;
}

function findManagedSections(source) {
  const headerPattern =
    /^[\uFEFF \t]*\[([^\]\r\n]+)\][ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm;
  const headers = [...source.matchAll(headerPattern)];
  return headers
    .map((match, index) => ({
      name: normalizedHeader(match[1]),
      start: match.index + (match[0].startsWith("\uFEFF") ? 1 : 0),
      end: headers[index + 1]?.index ?? source.length,
    }))
    .filter((section) => section.name === SECTION_NAME);
}

function decodeBasicString(source) {
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

function decodeTomlString(source) {
  if (source?.startsWith("'") && source.endsWith("'")) {
    return source.slice(1, -1);
  }
  return decodeBasicString(source);
}

function inspectManagedSection(source) {
  const commandMatch = source.match(
    /^[ \t]*command[ \t]*=[ \t]*("(?:\\.|[^"\\])*"|'[^']*')[ \t]*(?:#[^\r\n]*)?$/m,
  );
  const argsMatch = source.match(
    /^[ \t]*args[ \t]*=[ \t]*\[([^\r\n]*)\][ \t]*(?:#[^\r\n]*)?$/m,
  );
  const assignments = [...source.matchAll(/^[ \t]*([A-Za-z0-9_-]+)[ \t]*=/gm)]
    .map((match) => match[1])
    .sort();
  return {
    command: decodeTomlString(commandMatch?.[1]),
    args: argsMatch
      ? [...argsMatch[1].matchAll(/("(?:\\.|[^"\\])*"|'[^']*')/g)].map(
          (match) => decodeTomlString(match[1]),
        )
      : undefined,
    hasOnlyManagedKeys:
      assignments.length === 2 &&
      assignments[0] === "args" &&
      assignments[1] === "command",
  };
}

function managedContentEnd(source, section) {
  const sectionSource = source.slice(section.start, section.end);
  const linePattern = /[^\r\n]*(?:\r\n|\n|$)/g;
  let lastManagedEnd = section.start;
  for (const match of sectionSource.matchAll(linePattern)) {
    const line = match[0].replace(/\r?\n$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    lastManagedEnd = section.start + match.index + match[0].length;
  }
  return lastManagedEnd;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left?.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function nextBackupPath(configPath) {
  const base = `${configPath}.project-atlas.bak`;
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? base : `${base}.${index}`;
    try {
      await readFile(candidate);
    } catch (error) {
      if (error?.code === "ENOENT") return candidate;
      throw error;
    }
  }
}

export class McpConfigConflictError extends Error {
  constructor(details) {
    super(
      [
        `Refusing to overwrite [${SECTION_NAME}] in ${details.configPath}.`,
        `Current command: ${details.currentCommand ?? "<unrecognized>"}`,
        `Current args: ${details.currentArgs?.join(", ") ?? "<unrecognized>"}`,
        `Expected command: ${details.expectedCommand}`,
        `Expected args: ${details.expectedArgs.join(", ")}`,
        "Review the existing server or rerun with -ForceMcpConfig.",
      ].join("\n"),
    );
    this.name = "McpConfigConflictError";
    this.details = details;
  }
}

export async function updateCodexMcpConfig({
  configPath,
  nodeExecutable,
  mcpEntry,
  dryRun = false,
  force = false,
}) {
  if (!path.isAbsolute(configPath)) {
    throw new Error(`Codex config path must be absolute: ${configPath}`);
  }
  if (!path.isAbsolute(nodeExecutable)) {
    throw new Error(`Node executable path must be absolute: ${nodeExecutable}`);
  }
  if (!path.isAbsolute(mcpEntry)) {
    throw new Error(`MCP entry path must be absolute: ${mcpEntry}`);
  }

  let source = "";
  let exists = true;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    exists = false;
  }

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const sections = findManagedSections(source);
  if (sections.length > 1) {
    throw new Error(
      `Multiple [${SECTION_NAME}] sections exist in ${configPath}; resolve them manually.`,
    );
  }

  const expectedArgs = [mcpEntry, "--profile", "core"];
  const expected = createManagedBlock(nodeExecutable, mcpEntry, newline);
  let nextSource;
  let action;
  if (sections.length === 1) {
    const section = sections[0];
    const currentSource = source.slice(section.start, section.end);
    const current = inspectManagedSection(currentSource);
    const matches =
      current.hasOnlyManagedKeys &&
      samePath(current.command, nodeExecutable) &&
      current.args?.length === expectedArgs.length &&
      samePath(current.args[0], mcpEntry) &&
      current.args[1] === "--profile" &&
      current.args[2] === "core";
    if (matches) {
      return {
        status: "unchanged",
        configPath,
        section: SECTION_NAME,
        nodeExecutable,
        mcpEntry,
        expectedArgs,
      };
    }
    const upgradeableLegacyBlock =
      current.hasOnlyManagedKeys &&
      samePath(current.command, nodeExecutable) &&
      current.args?.length === 1 &&
      samePath(current.args[0], mcpEntry);
    if (!force && !upgradeableLegacyBlock) {
      throw new McpConfigConflictError({
        configPath,
        currentCommand: current.command,
        currentArgs: current.args,
        expectedCommand: nodeExecutable,
        expectedArgs,
      });
    }
    nextSource =
      source.slice(0, section.start) +
      expected +
      source.slice(managedContentEnd(source, section));
    action = "updated";
  } else {
    const separator =
      source.length === 0
        ? ""
        : source.endsWith(newline + newline)
          ? ""
          : source.endsWith(newline)
            ? newline
            : newline + newline;
    nextSource = source + separator + expected;
    action = exists ? "updated" : "created";
  }

  if (dryRun) {
    return {
      status: `would-${action}`,
      configPath,
      section: SECTION_NAME,
      nodeExecutable,
      mcpEntry,
      expectedArgs,
    };
  }

  await mkdir(path.dirname(configPath), { recursive: true });
  let backupPath;
  if (exists) {
    backupPath = await nextBackupPath(configPath);
    await copyFile(configPath, backupPath);
  }
  await writeFile(configPath, nextSource, "utf8");
  return {
    status: action,
    configPath,
    section: SECTION_NAME,
    nodeExecutable,
    mcpEntry,
    expectedArgs,
    backupPath,
  };
}

function readArguments(argv) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run" || argument === "--force") {
      flags.add(argument);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.`);
    }
    values.set(argument, value);
    index += 1;
  }
  return {
    configPath: values.get("--config"),
    nodeExecutable: values.get("--node"),
    mcpEntry: values.get("--entry"),
    dryRun: flags.has("--dry-run"),
    force: flags.has("--force"),
  };
}

function report(result) {
  const verb = {
    unchanged: "Already configured",
    created: "Created",
    updated: "Updated",
    "would-created": "DRY RUN: would create",
    "would-updated": "DRY RUN: would update",
  }[result.status];
  console.log(
    `[frontend-codex-kit] ${verb} [${result.section}] in ${result.configPath}`,
  );
  console.log(`  command = ${result.nodeExecutable}`);
  console.log(`  args = ${result.expectedArgs.join(" ")}`);
  if (result.backupPath) {
    console.log(`  backup = ${result.backupPath}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = readArguments(process.argv.slice(2));
    for (const [key, value] of Object.entries(options)) {
      if (
        ["configPath", "nodeExecutable", "mcpEntry"].includes(key) &&
        !value
      ) {
        throw new Error(`Missing required ${key}.`);
      }
    }
    report(await updateCodexMcpConfig(options));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof McpConfigConflictError ? 3 : 1;
  }
}
