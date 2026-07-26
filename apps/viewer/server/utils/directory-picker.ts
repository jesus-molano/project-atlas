import path from "node:path";
import process from "node:process";
import { runBoundedProcess } from "./bounded-process";

export interface DirectoryPickerResult {
  status: "selected" | "cancelled";
  absolutePath?: string;
}

interface ProcessRunner {
  (
    command: string,
    args: string[],
    options: { timeoutMs: number; maxOutputChars: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

const WINDOWS_PICKER_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Choose a Project Atlas repository'",
  "$dialog.ShowNewFolderButton = $false",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
  "  [Console]::Write($dialog.SelectedPath)",
  "}",
].join("\n");

export function normalizeSelectedDirectory(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const selectedPath = value.trim();
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!selectedPath) return undefined;
  if (
    selectedPath.length > 1_024 ||
    /[\u0000-\u001f]/.test(selectedPath) ||
    !pathApi.isAbsolute(selectedPath)
  ) {
    throw new Error("The native folder picker returned an invalid path.");
  }
  return pathApi.resolve(selectedPath);
}

export async function selectLocalProjectDirectory(
  platform: NodeJS.Platform = process.platform,
  runner: ProcessRunner = runBoundedProcess,
): Promise<DirectoryPickerResult> {
  if (platform !== "win32") {
    throw new Error(
      "The loopback folder picker is currently available on Windows. Use the desktop host or paste an absolute path on this platform.",
    );
  }
  const command = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const { stdout } = await runner(
    command,
    [
      "-NoLogo",
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_PICKER_SCRIPT,
    ],
    { timeoutMs: 300_000, maxOutputChars: 2_048 },
  );
  const absolutePath = normalizeSelectedDirectory(stdout, platform);
  return absolutePath
    ? { status: "selected", absolutePath }
    : { status: "cancelled" };
}
