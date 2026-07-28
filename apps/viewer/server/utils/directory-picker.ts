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
    options: {
      timeoutMs: number;
      maxOutputChars: number;
      windowsHide: boolean;
    },
  ): Promise<{ stdout: string; stderr: string }>;
}

const WINDOWS_PICKER_SCRIPT = [
  "$source = @'",
  "using System;",
  "using System.Diagnostics;",
  "using System.Drawing;",
  "using System.Runtime.InteropServices;",
  "using System.Text;",
  "using System.Windows.Forms;",
  "",
  "public static class AtlasFolderPicker {",
  "  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  private struct NativeRect {",
  "    public int Left;",
  "    public int Top;",
  "    public int Right;",
  "    public int Bottom;",
  "    public int Width { get { return Right - Left; } }",
  "    public int Height { get { return Bottom - Top; } }",
  "  }",
  "  private static IntPtr ownerHandle;",
  "  private static System.Threading.Timer foregroundTimer;",
  "",
  '  [DllImport("user32.dll")]',
  "  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);",
  '  [DllImport("user32.dll")]',
  "  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
  '  [DllImport("user32.dll")]',
  "  private static extern bool IsWindowVisible(IntPtr hWnd);",
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)]',
  "  private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);",
  '  [DllImport("user32.dll")]',
  "  private static extern bool SetForegroundWindow(IntPtr hWnd);",
  '  [DllImport("user32.dll")]',
  "  private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect bounds);",
  '  [DllImport("user32.dll")]',
  "  private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);",
  "",
  "  public static string Show() {",
  '    if (!Environment.UserInteractive) throw new InvalidOperationException("The native folder picker requires an interactive Windows session.");',
  "    using (Form owner = new Form()) {",
  "      owner.ShowInTaskbar = false;",
  "      owner.TopMost = true;",
  "      owner.FormBorderStyle = FormBorderStyle.None;",
  "      owner.StartPosition = FormStartPosition.CenterScreen;",
  "      owner.Size = new Size(1, 1);",
  "      owner.Opacity = 0;",
  "      using (FolderBrowserDialog dialog = new FolderBrowserDialog()) {",
  '        dialog.Description = "Choose a Project Atlas repository";',
  "        dialog.ShowNewFolderButton = false;",
  "        owner.Show();",
  "        ownerHandle = owner.Handle;",
  "        foregroundTimer = new System.Threading.Timer(delegate { BringDialogToFront(); }, null, 50, 100);",
  "        try {",
  "          DialogResult result = dialog.ShowDialog(owner);",
  "          return result == DialogResult.OK ? dialog.SelectedPath : String.Empty;",
  "        } finally {",
  "          foregroundTimer.Dispose();",
  "          foregroundTimer = null;",
  "          owner.Close();",
  "        }",
  "      }",
  "    }",
  "  }",
  "",
  "  private static void BringDialogToFront() {",
  "    uint currentProcessId = (uint)Process.GetCurrentProcess().Id;",
  "    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {",
  "      uint windowProcessId;",
  "      GetWindowThreadProcessId(hWnd, out windowProcessId);",
  "      if (windowProcessId != currentProcessId || hWnd == ownerHandle || !IsWindowVisible(hWnd)) return true;",
  "      StringBuilder className = new StringBuilder(64);",
  "      GetClassName(hWnd, className, className.Capacity);",
  '      if (className.ToString() != "#32770") return true;',
  "      NativeRect bounds;",
  "      Rectangle workingArea = Screen.PrimaryScreen.WorkingArea;",
  "      int x = workingArea.Left + Math.Max(0, (workingArea.Width - 720) / 2);",
  "      int y = workingArea.Top + Math.Max(0, (workingArea.Height - 540) / 2);",
  "      if (GetWindowRect(hWnd, out bounds)) {",
  "        x = workingArea.Left + Math.Max(0, (workingArea.Width - bounds.Width) / 2);",
  "        y = workingArea.Top + Math.Max(0, (workingArea.Height - bounds.Height) / 2);",
  "      }",
  "      SetWindowPos(hWnd, new IntPtr(-1), x, y, 0, 0, 0x0001 | 0x0040);",
  "      SetForegroundWindow(hWnd);",
  "      return false;",
  "    }, IntPtr.Zero);",
  "  }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
  "[Console]::Write([AtlasFolderPicker]::Show())",
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
    {
      timeoutMs: 300_000,
      maxOutputChars: 2_048,
      // The PowerShell process owns the Windows Forms dialog. Hiding the
      // process also hides that native window, leaving the UI stuck on
      // "Choosing…" with no visible picker.
      windowsHide: false,
    },
  );
  const absolutePath = normalizeSelectedDirectory(stdout, platform);
  return absolutePath
    ? { status: "selected", absolutePath }
    : { status: "cancelled" };
}
