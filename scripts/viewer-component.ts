import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const EXTERNAL_TEMPLATE =
  /<template\s+src="([^"]+)"\s*><\/template>/u;

function templatePath(componentPath: string, source: string): string | undefined {
  const match = EXTERNAL_TEMPLATE.exec(source);
  return match?.[1]
    ? path.resolve(path.dirname(componentPath), match[1])
    : undefined;
}

export function readViewerComponentSync(componentPath: string): string {
  const source = readFileSync(componentPath, "utf8");
  const externalPath = templatePath(componentPath, source);
  return externalPath
    ? `${source}\n<template>\n${readFileSync(externalPath, "utf8")}\n</template>`
    : source;
}

export async function readViewerComponent(componentPath: string): Promise<string> {
  const source = await readFile(componentPath, "utf8");
  const externalPath = templatePath(componentPath, source);
  return externalPath
    ? `${source}\n<template>\n${await readFile(externalPath, "utf8")}\n</template>`
    : source;
}
