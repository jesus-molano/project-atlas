import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const entryArgument = process.argv[2];
if (!entryArgument) {
  throw new Error("Usage: node smoke-core-mcp.mjs <packages/mcp/dist/index.js>");
}

const entry = path.resolve(entryArgument);
const expectedTools = [
  "atlas_expand_context",
  "atlas_lock_change_scope",
  "atlas_memory",
  "atlas_prepare_task",
  "atlas_task_state",
  "atlas_validate_change",
];
const child = spawn(process.execPath, [entry, "--profile", "core"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const pending = new Map();
let stdoutBuffer = "";
let stderr = "";

function rejectPending(error) {
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(error);
  }
  pending.clear();
}

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  for (;;) {
    const newline = stdoutBuffer.indexOf("\n");
    if (newline < 0) break;
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      rejectPending(new Error(`MCP emitted invalid JSON: ${line}`, { cause: error }));
      continue;
    }
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    clearTimeout(waiter.timeout);
    pending.delete(message.id);
    waiter.resolve(message);
  }
});
child.on("error", (error) => rejectPending(error));
child.on("exit", (code, signal) => {
  if (pending.size === 0) return;
  rejectPending(
    new Error(
      `MCP exited before responding (code ${code ?? "none"}, signal ${signal ?? "none"}).${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
    ),
  );
});

function request(id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `MCP ${method} timed out.${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
        ),
      );
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      (error) => {
        if (!error) return;
        clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      },
    );
  });
}

function checkedResult(response, method) {
  if (response.error) {
    throw new Error(`MCP ${method} failed: ${JSON.stringify(response.error)}`);
  }
  if (!response.result) {
    throw new Error(`MCP ${method} returned no result.`);
  }
  return response.result;
}

try {
  checkedResult(
    await request(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "project-atlas-doctor", version: "0.1.0" },
    }),
    "initialize",
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const listed = checkedResult(await request(2, "tools/list"), "tools/list");
  const actualTools = (listed.tools ?? []).map((tool) => tool.name).sort();
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    throw new Error(
      `Unexpected core contract. Expected ${expectedTools.join(", ")}; ` +
        `received ${actualTools.join(", ") || "no tools"}.`,
    );
  }
  process.stdout.write(`Core MCP smoke passed (${actualTools.length} tools).\n`);
} finally {
  child.stdin.end();
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 1_000)),
  ]);
  if (!exited) child.kill();
}
