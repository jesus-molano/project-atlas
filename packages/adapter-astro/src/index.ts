import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "@astrojs/compiler";
import {
  componentId,
  hashText,
  pascalCase,
  slash,
  type AdapterScanResult,
  type ComponentImportBinding,
  type ComponentNode,
  type ComponentProp,
  type ComponentRenderReference,
  type ComponentSlotContract,
  type FrameworkAdapter,
  type ScanOptions,
} from "@component-atlas/core";
import fg from "fast-glob";
import ts from "typescript";

const SOURCE_PATTERNS = [
  "src/**/*.astro",
  "src/pages/**/*.{md,mdx,html}",
];

interface AstroNode {
  type?: string;
  name?: string;
  value?: string;
  attributes?: Array<{
    type?: string;
    kind?: string;
    name?: string;
    value?: string;
  }>;
  children?: AstroNode[];
}

function frontmatterDiagnosticMessages(
  frontmatter: string,
  fileName: string,
): string[] {
  if (!frontmatter.trim()) return [];
  const source = ts.createSourceFile(
    fileName,
    frontmatter,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  );
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function propsFromFrontmatter(frontmatter: string, fileName: string): ComponentProp[] {
  const source = ts.createSourceFile(
    fileName,
    frontmatter,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = source.statements.find(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === "Props",
  );
  if (!declaration) return [];
  return declaration.members.flatMap((member) => {
    if (!ts.isPropertySignature(member)) return [];
    const name = propertyName(member.name);
    if (!name) return [];
    return [{
      name,
      type: member.type?.getText(source) ?? "unknown",
      required: !member.questionToken,
    }];
  });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSourceImport(
  specifier: string,
  fromFile: string,
  rootPath: string,
): Promise<string | undefined> {
  const bases: string[] = [];
  if (specifier.startsWith(".")) {
    bases.push(path.resolve(path.dirname(fromFile), specifier));
  } else if (specifier.startsWith("@/")) {
    bases.push(path.resolve(rootPath, "src", specifier.slice(2)));
  }
  const candidates = bases.flatMap((base) => [
    base,
    ...[".astro", ".tsx", ".jsx", ".ts", ".js", ".vue", ".md", ".mdx", ".html"].map(
      (extension) => `${base}${extension}`,
    ),
    ...["index.astro", "index.tsx", "index.jsx", "index.vue"].map((fileName) =>
      path.join(base, fileName),
    ),
  ]);
  for (const candidate of candidates) {
    if (await exists(candidate)) return path.resolve(candidate);
  }
  return undefined;
}

async function importsFromFrontmatter(
  frontmatter: string,
  sourcePath: string,
  rootPath: string,
): Promise<ComponentImportBinding[]> {
  const source = ts.createSourceFile(
    sourcePath,
    frontmatter,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bindings: ComponentImportBinding[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const resolvedPath = await resolveSourceImport(specifier, sourcePath, rootPath);
    const clause = statement.importClause;
    if (clause?.name) {
      bindings.push({
        local: clause.name.text,
        imported: "default",
        specifier,
        ...(resolvedPath ? { resolvedPath } : {}),
      });
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        bindings.push({
          local: binding.name.text,
          imported: binding.propertyName?.text ?? binding.name.text,
          specifier,
          ...(resolvedPath ? { resolvedPath } : {}),
        });
      }
    }
  }
  return bindings;
}

function routePath(relativePath: string): string {
  const withinPages = slash(relativePath).replace(/^src\/pages\//u, "");
  const withoutExtension = withinPages.replace(/\.(?:astro|mdx?|html)$/iu, "");
  const segments = withoutExtension
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment === "index" ? "" : segment));
  const value = `/${segments.filter(Boolean).join("/")}`;
  return value === "" ? "/" : value;
}

function frontmatterNode(root: AstroNode): string {
  const node = root.children?.find((child) => child.type === "frontmatter");
  return node?.value ?? "";
}

function templateFacts(root: AstroNode): {
  renderedNames: string[];
  renderReferences: ComponentRenderReference[];
  slots: string[];
  slotContracts: ComponentSlotContract[];
  classTokens: string[];
} {
  const renderedNames: string[] = [];
  const renderReferences: ComponentRenderReference[] = [];
  const slots: string[] = [];
  const slotContracts: ComponentSlotContract[] = [];
  const classTokens: string[] = [];
  const visit = (node: AstroNode): void => {
    const name = node.name;
    if (
      name &&
      name !== "slot" &&
      (/^[A-Z]/u.test(name) || name.includes("."))
    ) {
      renderedNames.push(name);
      const directive = node.attributes?.find(
        (attribute) =>
          attribute.name?.startsWith("client:") ||
          attribute.name === "server:defer",
      )?.name;
      renderReferences.push({
        name,
        importedLocal: name,
        ...(directive ? { directive } : {}),
      });
    }
    if (name === "slot") {
      const slotName =
        node.attributes?.find((attribute) => attribute.name === "name")?.value ??
        "default";
      slots.push(slotName);
      const props =
        node.attributes
          ?.filter((attribute) => attribute.name !== "name")
          .map((attribute) => attribute.name)
          .filter((value): value is string => Boolean(value)) ?? [];
      slotContracts.push({ name: slotName, props: [...new Set(props)] });
    }
    const classAttribute = node.attributes?.find(
      (attribute) => attribute.name === "class" && attribute.kind === "quoted",
    );
    if (classAttribute?.value) {
      classTokens.push(...classAttribute.value.split(/\s+/u).filter(Boolean));
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return {
    renderedNames: [...new Set(renderedNames)],
    renderReferences: [
      ...new Map(
        renderReferences.map((reference) => [
          `${reference.name}:${reference.directive ?? ""}`,
          reference,
        ]),
      ).values(),
    ],
    slots: [...new Set(slots)],
    slotContracts: [
      ...new Map(slotContracts.map((contract) => [contract.name, contract])).values(),
    ],
    classTokens: [...new Set(classTokens)],
  };
}

export class AstroAdapter implements FrameworkAdapter {
  readonly framework = "astro" as const;

  async scan(options: ScanOptions): Promise<ComponentNode[]> {
    return (await this.scanDetailed(options)).components;
  }

  async scanDetailed(options: ScanOptions): Promise<AdapterScanResult> {
    const rootPath = path.resolve(options.rootPath);
    const files = await fg(options.include ?? SOURCE_PATTERNS, {
      cwd: rootPath,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: ["**/node_modules/**", "**/.astro/**", ...(options.exclude ?? [])],
    });
    const components: ComponentNode[] = [];
    const diagnostics: AdapterScanResult["coverage"]["diagnostics"] = [];
    let parsedFiles = 0;
    let skippedFiles = 0;
    let errorFiles = 0;
    for (const sourcePath of files.sort()) {
      const relativePath = slash(path.relative(rootPath, sourcePath));
      try {
        const source = await readFile(sourcePath, "utf8");
        const extension = path.extname(sourcePath).toLowerCase();
        const page = /^src\/pages\//u.test(relativePath);
        const layout = /^src\/layouts\//u.test(relativePath);
        const name = pascalCase(path.basename(sourcePath, extension)) || "Index";
        if (extension !== ".astro") {
          components.push({
            id: componentId("astro", relativePath, name),
            framework: "astro",
            kind: page ? "route" : "component",
            role: page ? "page" : "html-component",
            runtime: "static",
            ...(page ? { routePath: routePath(relativePath) } : {}),
            name,
            effectiveName: name,
            sourcePath,
            relativePath,
            visibility: "private",
            exported: false,
            exportName: "default",
            location: { line: 1, column: 1 },
            props: [],
            events: [],
            slots: [],
            models: [],
            renderedNames: [],
            renderReferences: [],
            imports: [],
            importBindings: [],
            testPaths: [],
            classTokens: [],
            sourceHash: hashText(source),
          });
          skippedFiles += 1;
          diagnostics.push({
            severity: "warning",
            code: "astro-static-page",
            message:
              "Route indexed from its filename; Markdown, MDX, or HTML contents were not parsed.",
            path: relativePath,
            framework: "astro",
          });
          continue;
        }
        const parsed = await parse(source, { position: true });
        const root = parsed.ast as AstroNode;
        const frontmatter = frontmatterNode(root);
        const bindings = await importsFromFrontmatter(frontmatter, sourcePath, rootPath);
        const facts = templateFacts(root);
        const parseDiagnostics = parsed.diagnostics ?? [];
        const scriptDiagnostics = frontmatterDiagnosticMessages(
          frontmatter,
          sourcePath,
        );
        if (parseDiagnostics.length > 0 || scriptDiagnostics.length > 0) {
          errorFiles += 1;
          diagnostics.push({
            severity: "error",
            code: "astro-parse",
            message: [
              ...parseDiagnostics.map((diagnostic) => diagnostic.text),
              ...scriptDiagnostics,
            ]
              .join("; ")
              .slice(0, 500),
            path: relativePath,
            framework: "astro",
          });
        } else {
          parsedFiles += 1;
        }
        components.push({
          id: componentId("astro", relativePath, name),
          framework: "astro",
          kind: page ? "route" : layout ? "layout" : "component",
          role: page ? "page" : layout ? "layout" : "astro-component",
          runtime: "static",
          ...(page ? { routePath: routePath(relativePath) } : {}),
          name,
          effectiveName: name,
          sourcePath,
          relativePath,
          visibility: page || layout ? "private" : "feature",
          exported: !page && !layout,
          exportName: "default",
          location: { line: 1, column: 1 },
          props: propsFromFrontmatter(frontmatter, sourcePath),
          events: [],
          slots: facts.slots,
          models: [],
          renderedNames: facts.renderedNames,
          renderReferences: facts.renderReferences,
          imports: bindings.map((binding) => binding.local),
          importBindings: bindings,
          slotContracts: facts.slotContracts,
          testPaths: [],
          classTokens: facts.classTokens,
          sourceHash: hashText(source),
        });
      } catch (error) {
        errorFiles += 1;
        diagnostics.push({
          severity: "error",
          code: "astro-file-parse",
          message: error instanceof Error ? error.message : String(error),
          path: relativePath,
          framework: "astro",
        });
      }
    }
    return {
      components,
      coverage: {
        candidateFiles: files.length,
        parsedFiles,
        skippedFiles,
        errorFiles,
        diagnostics: diagnostics.slice(0, 50),
        byFramework: {
          astro: {
            candidateFiles: files.length,
            parsedFiles,
            skippedFiles,
            errorFiles,
          },
        },
        complete:
          errorFiles === 0 &&
          skippedFiles === 0 &&
          parsedFiles === files.length,
      },
    };
  }
}

export async function scanAstroProject(options: ScanOptions): Promise<ComponentNode[]> {
  return new AstroAdapter().scan(options);
}

export async function scanAstroProjectDetailed(
  options: ScanOptions,
): Promise<AdapterScanResult> {
  return new AstroAdapter().scanDetailed(options);
}
