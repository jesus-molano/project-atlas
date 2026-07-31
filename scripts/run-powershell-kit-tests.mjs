import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { powerShellProcessEnvironment } from "./powershell-process-environment.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const candidates = process.platform === "win32"
  ? ["powershell", "pwsh"]
  : ["pwsh", "powershell"];
const testFiles = [
  "frontend-codex-kit/test-installer-mcp.ps1",
  "frontend-codex-kit/test-agents-instructions.ps1",
];

let executable;
for (const candidate of candidates) {
  const probe = spawnSync(
    candidate,
    ["-NoProfile", "-Command", "$PSVersionTable.PSVersion"],
    {
      encoding: "utf8",
      env: powerShellProcessEnvironment(candidate),
      windowsHide: true,
    },
  );
  if (!probe.error && probe.status === 0) {
    executable = candidate;
    break;
  }
}

if (!executable) {
  throw new Error(
    `PowerShell is required for Codex kit tests; tried ${candidates.join(", ")}.`,
  );
}

for (const testFile of testFiles) {
  const executionPolicyArguments = process.platform === "win32"
    ? ["-ExecutionPolicy", "Bypass"]
    : [];
  const result = spawnSync(
    executable,
    [
      "-NoProfile",
      ...executionPolicyArguments,
      "-File",
      path.join(repositoryRoot, testFile),
    ],
    {
      cwd: repositoryRoot,
      env: powerShellProcessEnvironment(executable),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${testFile} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }
}
