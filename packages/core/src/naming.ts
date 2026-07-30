import { createHash } from "node:crypto";
import path from "node:path";
import type { Framework } from "./types.js";
import { slash } from "./text.js";

export { edgeId, pascalCase, slash, tokenize } from "./text.js";

export function componentId(
  framework: Framework,
  relativePath: string,
  name: string,
): string {
  return `${framework}:${slash(relativePath)}#${name}`;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function projectId(rootPath: string): string {
  return createHash("sha256")
    .update(path.resolve(rootPath).toLowerCase())
    .digest("hex")
    .slice(0, 20);
}
