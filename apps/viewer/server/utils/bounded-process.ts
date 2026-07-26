import { spawn } from "node:child_process";

export interface BoundedProcessOptions {
  timeoutMs?: number;
  maxOutputChars?: number;
  signal?: AbortSignal;
  windowsHide?: boolean;
}

export interface BoundedProcessResult {
  stdout: string;
  stderr: string;
}

export function runBoundedProcess(
  command: string,
  args: string[],
  options: BoundedProcessOptions = {},
): Promise<BoundedProcessResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const maxOutputChars = options.maxOutputChars ?? 1_000_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: options.windowsHide ?? true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationError: Error | undefined;
    let killFallback: ReturnType<typeof setTimeout> | undefined;
    const finish = (
      error?: Error,
      result?: BoundedProcessResult,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killFallback) clearTimeout(killFallback);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result ?? { stdout, stderr });
    };
    const terminate = (reason: string): void => {
      if (terminationError) return;
      terminationError = new Error(reason);
      if (!child.killed) child.kill();
      killFallback = setTimeout(() => finish(terminationError), 2_000);
      killFallback.unref();
    };
    const abort = (): void =>
      terminate("Atlas scan was cancelled before it completed.");
    const timer = setTimeout(
      () => terminate(`Atlas scan exceeded the ${timeoutMs}ms timeout.`),
      timeoutMs,
    );

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (terminationError) return;
      stdout += chunk;
      if (stdout.length + stderr.length > maxOutputChars) {
        terminate(
          `Atlas scan exceeded the ${maxOutputChars}-character output limit.`,
        );
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (terminationError) return;
      stderr += chunk;
      if (stdout.length + stderr.length > maxOutputChars) {
        terminate(
          `Atlas scan exceeded the ${maxOutputChars}-character output limit.`,
        );
      }
    });
    child.once("error", (error) => finish(terminationError ?? error));
    child.once("close", (code) => {
      if (terminationError) finish(terminationError);
      else if (code === 0) finish(undefined, { stdout, stderr });
      else {
        finish(
          new Error(
            stderr.trim() || `Atlas scan exited with code ${code ?? "unknown"}.`,
          ),
        );
      }
    });
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });
}
