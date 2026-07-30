#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { createProgram } from "./program.js";

export { createProgram } from "./program.js";
export * from "./viewer.js";

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  createProgram().parseAsync().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
