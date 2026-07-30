import { readFile, readdir } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";

const cssDirectory = new URL(
  "../apps/viewer/app/assets/css/",
  import.meta.url,
);

function orderedStyleNames(files: string[]): string[] {
  const main = readFileSync(new URL("main.css", cssDirectory), "utf8");
  const imports = [...main.matchAll(/@import url\("\.\/([^"]+)"\);/gu)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name));
  const available = new Set(files.filter((file) => file.endsWith(".css")));
  for (const imported of imports) {
    if (!available.has(imported)) {
      throw new Error(`Missing imported viewer stylesheet: ${imported}`);
    }
  }
  return imports;
}

export async function readViewerCss(): Promise<string> {
  const files = await readdir(cssDirectory);
  const names = orderedStyleNames(files);
  const layers = await Promise.all(
    names.map((name) => readFile(new URL(name, cssDirectory), "utf8")),
  );
  return layers.join("\n");
}

export function readViewerCssSync(): string {
  const names = orderedStyleNames(readdirSync(cssDirectory));
  return names
    .map((name) => readFileSync(new URL(name, cssDirectory), "utf8"))
    .join("\n");
}
