import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  McpConfigConflictError,
  SECTION_NAME,
  updateCodexMcpConfig,
} from "./register-codex-mcp.mjs";
import { powerShellProcessEnvironment } from "../scripts/powershell-process-environment.mjs";

const fixturePathsRoot = path.join(
  path.parse(process.cwd()).root,
  "Project Atlas Test Paths",
);
const nodePath = path.join(
  fixturePathsRoot,
  "Node Runtime",
  process.platform === "win32" ? "node.exe" : "node",
);
const entryPath = path.join(
  fixturePathsRoot,
  "Developer Tools",
  "project-atlas",
  "packages",
  "mcp",
  "dist",
  "index.js",
);

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "project-atlas-mcp-config-"));
}

test("isolates Windows PowerShell from a PowerShell 7 module path", () => {
  const source = {
    Path: "C:\\Tools",
    PsMoDuLePaTh: "C:\\Program Files\\PowerShell\\7\\Modules",
  };

  assert.deepEqual(
    powerShellProcessEnvironment("powershell", {
      platform: "win32",
      environment: source,
    }),
    { Path: source.Path },
  );
  assert.deepEqual(
    powerShellProcessEnvironment("pwsh", {
      platform: "win32",
      environment: source,
    }),
    source,
  );
  assert.deepEqual(
    powerShellProcessEnvironment("powershell", {
      platform: "linux",
      environment: source,
    }),
    source,
  );
});

test("creates a missing config and parent directory", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "nested", "config.toml");
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "created");
  const source = await readFile(configPath, "utf8");
  assert.match(source, new RegExp(`\\[${SECTION_NAME.replace(".", "\\.")}\\]`));
  assert.ok(source.includes(`command = ${JSON.stringify(nodePath)}`));
  assert.ok(source.includes(JSON.stringify(entryPath)));
});

test("preserves unrelated sections and comments and creates a backup", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "# personal comment",
    'model = "gpt-example"',
    "",
    "[mcp_servers.other]",
    'command = "other.exe"',
    'args = ["server.js"]',
    "",
  ].join("\r\n");
  await writeFile(configPath, original, "utf8");

  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "updated");
  assert.ok(result.backupPath);
  assert.equal(await readFile(result.backupPath, "utf8"), original);
  const source = await readFile(configPath, "utf8");
  assert.ok(source.startsWith(original));
  assert.match(source, /\r\n\[mcp_servers\.component-atlas\]\r\n/);
});

test("leaves a matching block byte-identical and is repeatable", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  const before = await readFile(configPath, "utf8");
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "unchanged");
  assert.equal(await readFile(configPath, "utf8"), before);
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.includes(".bak")),
    [],
  );
});

test("recognizes an equivalent literal-string TOML block", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "[mcp_servers.component-atlas]",
    `command = '${nodePath}'`,
    `args = ['${entryPath}', '--profile', 'core']`,
    "",
  ].join("\n");
  await writeFile(configPath, original, "utf8");
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "unchanged");
  assert.equal(await readFile(configPath, "utf8"), original);
});

test("recognizes spaced and literal managed table keys", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "[mcp_servers . 'component-atlas']",
    `command = '${nodePath}'`,
    `args = ['${entryPath}', '--profile', 'core']`,
    "",
  ].join("\n");
  await writeFile(configPath, original, "utf8");
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "unchanged");
  assert.equal(await readFile(configPath, "utf8"), original);
});

test("refuses duplicate equivalent managed tables even with force", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "[mcp_servers.component-atlas]",
    `command = '${nodePath}'`,
    `args = ['${entryPath}', '--profile', 'core']`,
    "",
    "[mcp_servers . 'component-atlas']",
    `command = '${nodePath}'`,
    `args = ['${entryPath}', '--profile', 'core']`,
    "",
  ].join("\n");
  await writeFile(configPath, original, "utf8");
  await assert.rejects(
    updateCodexMcpConfig({
      configPath,
      nodeExecutable: nodePath,
      mcpEntry: entryPath,
      force: true,
    }),
    /Multiple \[mcp_servers\.component-atlas\] sections/,
  );
  assert.equal(await readFile(configPath, "utf8"), original);
  assert.deepEqual(await readdir(root), ["config.toml"]);
});

test("upgrades the previous one-argument Atlas block to core", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  await writeFile(
    configPath,
    [
      "[mcp_servers.component-atlas]",
      `command = '${nodePath}'`,
      `args = ['${entryPath}']`,
      "",
    ].join("\n"),
    "utf8",
  );
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
  });
  assert.equal(result.status, "updated");
  assert.match(
    await readFile(configPath, "utf8"),
    /args = \[.*?, "--profile", "core"\]/,
  );
});

test("refuses a stale or non-managed block without explicit force", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "[mcp_servers.component-atlas]",
    'command = "C:\\\\Old Node\\\\node.exe"',
    'args = ["C:\\\\Old Atlas\\\\index.js"]',
    'cwd = "C:\\\\Keep explicit intent"',
    "",
    "[notice]",
    'value = "preserve me"',
    "",
  ].join("\n");
  await writeFile(configPath, original, "utf8");

  await assert.rejects(
    updateCodexMcpConfig({
      configPath,
      nodeExecutable: nodePath,
      mcpEntry: entryPath,
    }),
    (error) => {
      assert.ok(error instanceof McpConfigConflictError);
      assert.match(error.message, /Current command:/);
      assert.match(error.message, /Expected command:/);
      assert.match(error.message, /-ForceMcpConfig/);
      return true;
    },
  );
  assert.equal(await readFile(configPath, "utf8"), original);
  assert.deepEqual(await readdir(root), ["config.toml"]);
});

test("force replaces only the managed section", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  const original = [
    "# before",
    "[mcp_servers.component-atlas]",
    'command = "old.exe"',
    'args = ["old.js"]',
    "",
    "# unrelated comment",
    "[mcp_servers.other]",
    'command = "other.exe"',
    "",
  ].join("\n");
  await writeFile(configPath, original, "utf8");

  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
    force: true,
  });
  assert.equal(result.status, "updated");
  const source = await readFile(configPath, "utf8");
  assert.match(source, /^# before/m);
  assert.match(source, /^# unrelated comment/m);
  assert.match(source, /^\[mcp_servers\.other\]$/m);
  assert.doesNotMatch(source, /old\.exe|old\.js/);
});

test("preserves a UTF-8 BOM when replacing the first section", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "config.toml");
  await writeFile(
    configPath,
    "\uFEFF[mcp_servers.component-atlas]\ncommand = 'old.exe'\nargs = ['old.js']\n",
    "utf8",
  );
  await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
    force: true,
  });
  assert.ok((await readFile(configPath, "utf8")).startsWith("\uFEFF"));
});

test("dry run reports the exact target without writing", async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "alternate-codex-home", "config.toml");
  const result = await updateCodexMcpConfig({
    configPath,
    nodeExecutable: nodePath,
    mcpEntry: entryPath,
    dryRun: true,
  });
  assert.equal(result.status, "would-created");
  assert.equal(result.configPath, configPath);
  assert.equal(result.section, SECTION_NAME);
  await assert.rejects(readFile(configPath), { code: "ENOENT" });
});
