import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import {
  componentId,
  hashText,
  pascalCase,
  slash,
  type AdapterScanResult,
  type ComponentImportBinding,
  type ComponentNode,
  type ComponentProp,
  type ComponentVisibility,
  type FrameworkAdapter,
  type ScanOptions,
} from "@component-atlas/core";

const SOURCE_PATTERNS = [
  "src/**/*.{tsx,jsx,js}",
  "app/**/*.{tsx,jsx,js}",
  "components/**/*.{tsx,jsx,js}",
  "pages/**/*.{tsx,jsx,js}",
];
const SOURCE_EXCLUDES = [
  "**/*.{test,spec}.{tsx,jsx,js}",
  "**/*.stories.{tsx,jsx,js}",
  "**/node_modules/**",
  "**/.next/**",
];
const TEST_PATTERNS = [
  "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
  "test/**/*.{test,spec}.{ts,tsx,js,jsx}",
  "tests/**/*.{test,spec}.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
];

interface Candidate {
  name: string;
  node: ts.FunctionLikeDeclaration;
  declaration: ts.Node;
  exported: boolean;
  defaultExported: boolean;
  location: { line: number; column: number };
}

function parseDiagnosticMessages(source: ts.SourceFile): string[] {
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

function resolveProps(
  node: ts.TypeNode | undefined,
  source: ts.SourceFile,
  declarations: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  visited = new Set<string>(),
): ComponentProp[] {
  if (!node) return [];
  if (ts.isIntersectionTypeNode(node) || ts.isUnionTypeNode(node)) {
    const props = node.types.flatMap((type) =>
      resolveProps(type, source, declarations, visited),
    );
    return [...new Map(props.map((prop) => [prop.name, prop])).values()];
  }
  let members: ts.NodeArray<ts.TypeElement> | undefined;
  const inherited: ComponentProp[] = [];
  if (ts.isTypeLiteralNode(node)) members = node.members;
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const referenceName = node.typeName.text;
    if (visited.has(referenceName)) return [];
    visited.add(referenceName);
    const declaration = declarations.get(referenceName);
    if (declaration && ts.isInterfaceDeclaration(declaration)) {
      members = declaration.members;
      for (const clause of declaration.heritageClauses ?? []) {
        for (const type of clause.types) {
          inherited.push(
            ...resolveProps(type, source, declarations, new Set(visited)),
          );
        }
      }
    } else if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      return resolveProps(
        declaration.type,
        source,
        declarations,
        new Set(visited),
      );
    }
  }
  const own = (members ?? []).flatMap((member) => {
    if (!ts.isPropertySignature(member)) return [];
    const name = propertyName(member.name);
    if (!name) return [];
    return [
      {
        name,
        type: member.type?.getText(source) ?? "unknown",
        required: !member.questionToken,
      },
    ];
  });
  return [
    ...new Map([...inherited, ...own].map((prop) => [prop.name, prop])).values(),
  ];
}

function withParameterDefaults(
  props: ComponentProp[],
  parameter: ts.ParameterDeclaration | undefined,
  source: ts.SourceFile,
): ComponentProp[] {
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return props;
  const resolved = new Map(props.map((prop) => [prop.name, prop]));
  for (const element of parameter.name.elements) {
    if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
    const name =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
    const defaultValue = element.initializer?.getText(source);
    const known = resolved.get(name);
    if (known) {
      resolved.set(
        name,
        defaultValue === undefined ? known : { ...known, defaultValue },
      );
    } else {
      resolved.set(name, {
        name,
        type: name === "children" ? "React.ReactNode" : "unknown",
        required: false,
        ...(defaultValue === undefined ? {} : { defaultValue }),
      });
    }
  }
  return [...resolved.values()];
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.ExportKeyword ||
            modifier.kind === ts.SyntaxKind.DefaultKeyword,
        ),
  );
}

function hasDefaultModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );
}

function isUppercaseName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

function containsRenderableOutput(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current) ||
      (
        ts.isCallExpression(current) &&
        /^(?:React\.)?createElement$/u.test(current.expression.getText())
      )
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function findCandidates(source: ts.SourceFile): Candidate[] {
  const defaults = new Set<string>();
  for (const statement of source.statements) {
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      defaults.add(statement.expression.text);
    }
  }
  const candidates: Candidate[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      const exported = hasExportModifier(statement) || defaults.has(name);
      if (!isUppercaseName(name) || (!exported && !containsRenderableOutput(statement))) {
        continue;
      }
      const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
      candidates.push({
        name,
        node: statement,
        declaration: statement,
        exported,
        defaultExported: hasDefaultModifier(statement) || defaults.has(name),
        location: { line: position.line + 1, column: position.character + 1 },
      });
      continue;
    }
    if (ts.isClassDeclaration(statement) && statement.name && isUppercaseName(statement.name.text)) {
      const renderMethod = statement.members.find(
        (member): member is ts.MethodDeclaration =>
          ts.isMethodDeclaration(member) &&
          propertyName(member.name) === "render",
      );
      if (renderMethod) {
        const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
        candidates.push({
          name: statement.name.text,
          node: renderMethod,
          declaration: statement,
          exported: hasExportModifier(statement) || defaults.has(statement.name.text),
          defaultExported:
            hasDefaultModifier(statement) || defaults.has(statement.name.text),
          location: { line: position.line + 1, column: position.character + 1 },
        });
      }
      continue;
    }
    if (
      ts.isExportAssignment(statement) &&
      (ts.isArrowFunction(statement.expression) ||
        ts.isFunctionExpression(statement.expression)) &&
      containsRenderableOutput(statement.expression)
    ) {
      const name = pascalCase(
        source.fileName
          .split(/[\\/]/u)
          .at(-1)
          ?.replace(/\.[^.]+$/u, "") ?? "DefaultComponent",
      );
      const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
      candidates.push({
        name,
        node: statement.expression,
        declaration: statement,
        exported: true,
        defaultExported: true,
        location: { line: position.line + 1, column: position.character + 1 },
      });
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const name = declaration.name.text;
      if (!isUppercaseName(name)) continue;
      let initializer: ts.Expression = declaration.initializer;
      if (
        ts.isCallExpression(initializer) &&
        !/^(?:lazy|dynamic|React\.lazy)$/u.test(initializer.expression.getText()) &&
        initializer.arguments[0] &&
        (ts.isArrowFunction(initializer.arguments[0]) ||
          ts.isFunctionExpression(initializer.arguments[0]))
      ) {
        initializer = initializer.arguments[0];
      }
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) {
        continue;
      }
      const exported = hasExportModifier(statement) || defaults.has(name);
      if (!exported && !containsRenderableOutput(initializer)) continue;
      const position = source.getLineAndCharacterOfPosition(declaration.getStart(source));
      candidates.push({
        name,
        node: initializer,
        declaration,
        exported,
        defaultExported: defaults.has(name),
        location: { line: position.line + 1, column: position.character + 1 },
      });
    }
  }
  return candidates;
}

function jsxFacts(node: ts.FunctionLikeDeclaration): {
  renderedNames: string[];
  classTokens: string[];
  logicDependencies: string[];
} {
  const renderedNames: string[] = [];
  const classTokens: string[] = [];
  const logicDependencies: string[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      const tag = current.tagName.getText();
      if (/^[A-Z]/.test(tag)) renderedNames.push(tag.split(".")[0] ?? tag);
      for (const attribute of current.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText() === "className" &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer)
        ) {
          classTokens.push(...attribute.initializer.text.split(/\s+/).filter(Boolean));
        }
      }
    }
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      /^use[A-Z0-9]/u.test(current.expression.text)
    ) {
      logicDependencies.push(current.expression.text);
    }
    ts.forEachChild(current, visit);
  };
  if (node.body) visit(node.body);
  return {
    renderedNames: [...new Set(renderedNames)],
    classTokens: [...new Set(classTokens)],
    logicDependencies: [...new Set(logicDependencies)],
  };
}

interface ReactClassification {
  visibility: ComponentVisibility;
  feature?: string;
  kind: "component" | "route" | "layout" | "special";
  role?: string;
  runtime: "universal" | "server" | "client";
  routePath?: string;
  effectiveName: string;
}

function nextRoutePath(relativePath: string, router: "pages" | "app"): string {
  const normalized = slash(relativePath);
  const marker = router === "app" ? /(?:^|\/)(?:src\/)?app\//u : /(?:^|\/)(?:src\/)?pages\//u;
  const match = marker.exec(normalized);
  const withinRouter = match
    ? normalized.slice((match.index ?? 0) + match[0].length)
    : normalized;
  const segments = withinRouter
    .replace(/\.(?:tsx|jsx|js)$/iu, "")
    .split("/")
    .filter(Boolean);
  segments.pop();
  const visible = segments
    .filter((segment) => !/^@/u.test(segment))
    .filter((segment) => !/^\(.+\)$/u.test(segment))
    .map((segment) =>
      segment.replace(/^(?:\(\.\)|\(\.\.\)|\(\.\.\)\(\.\.\)|\(\.\.\.\))/u, ""),
    )
    .filter(Boolean);
  if (router === "pages") {
    const fileName = withinRouter
      .replace(/\.(?:tsx|jsx|js)$/iu, "")
      .split("/")
      .at(-1);
    if (fileName && fileName !== "index") visible.push(fileName);
  }
  return visible.length > 0 ? `/${visible.join("/")}` : "/";
}

function isNextNonVisualConvention(relativePath: string, next: boolean): boolean {
  if (!next) return false;
  const normalized = slash(relativePath);
  if (/(^|\/)(?:src\/)?pages\/api\//u.test(normalized)) return true;
  if (!/(^|\/)(?:src\/)?app\//u.test(normalized)) return false;
  const fileName = path.basename(normalized).replace(/\.(?:tsx|jsx|js)$/iu, "");
  return [
    "route",
    "sitemap",
    "robots",
    "manifest",
    "icon",
    "apple-icon",
    "opengraph-image",
    "twitter-image",
  ].includes(fileName);
}

function classify(
  relativePath: string,
  exported: boolean,
  defaultExported: boolean,
  candidateName: string,
  next: boolean,
  router: "pages" | "app" | "hybrid" | undefined,
  clientModule: boolean,
): ReactClassification {
  const parts = slash(relativePath).split("/");
  const lower = parts.map((part) => part.toLowerCase());
  let kind: ReactClassification["kind"] = "component";
  let role: string | undefined;
  let routePath: string | undefined;
  if (next && router && defaultExported) {
    const fileName = path.basename(relativePath).replace(/\.(?:tsx|jsx|js)$/iu, "");
    if (
      (router === "pages" || router === "hybrid") &&
      /(^|\/)(?:src\/)?pages\//u.test(slash(relativePath))
    ) {
      const specialRole = {
        _app: "app-shell",
        _document: "document",
        _error: "error",
      }[fileName];
      if (specialRole) {
        kind = "special";
        role = specialRole;
      } else if (!/(^|\/)(?:src\/)?pages\/api\//u.test(slash(relativePath))) {
        kind = "route";
        role = "page";
        routePath = nextRoutePath(relativePath, "pages");
      }
    }
    if (
      (router === "app" || router === "hybrid") &&
      /(^|\/)(?:src\/)?app\//u.test(slash(relativePath))
    ) {
      const normalized = slash(relativePath);
      const intercepting =
        /\/@[^/]+\//u.test(normalized) || /\(\.{1,3}\)/u.test(normalized);
      if (fileName === "page" && !intercepting) {
        kind = "route";
        role = "page";
        routePath = nextRoutePath(relativePath, "app");
      } else if (fileName === "layout") {
        kind = "layout";
        role = "layout";
        routePath = nextRoutePath(relativePath, "app");
      } else {
        const specialRoles: Record<string, string> = {
          template: "template",
          loading: "loading",
          error: "error",
          "global-error": "global-error",
          "not-found": "not-found",
          default: "parallel-default",
          page: "intercepting-route",
        };
        const specialRole = specialRoles[fileName];
        if (specialRole) {
          kind = "special";
          role = specialRole;
          routePath = nextRoutePath(relativePath, "app");
        }
      }
    }
  }
  const uiIndex = lower.indexOf("ui");
  const routeLabel = routePath === "/"
    ? "Home"
    : pascalCase(routePath?.replaceAll("[", "").replaceAll("]", "") ?? "");
  const effectiveName =
    kind === "route" && /^(?:Page|HomePage)$/u.test(candidateName)
      ? `${routeLabel || "Home"}Page`
      : kind === "layout" && /Layout$/u.test(candidateName)
        ? `${routeLabel === "Home" ? "Root" : routeLabel}Layout`
        : candidateName;
  const runtime =
    clientModule
      ? ("client" as const)
      : next &&
          (router === "app" ||
            (router === "hybrid" &&
              /(^|\/)(?:src\/)?app\//u.test(slash(relativePath))))
        ? ("server" as const)
        : ("universal" as const);
  if (
    uiIndex > -1 &&
    (lower[uiIndex - 1] === "components" || lower.includes("shared"))
  ) {
    return {
      visibility: "public",
      kind,
      ...(role ? { role } : {}),
      runtime,
      ...(routePath ? { routePath } : {}),
      effectiveName,
    };
  }
  const featureIndex = lower.findIndex(
    (part) => part === "features" || part === "feature",
  );
  const feature = featureIndex >= 0 ? parts[featureIndex + 1] : undefined;
  if (!exported) {
    return {
      visibility: "private",
      ...(feature ? { feature } : {}),
      kind,
      ...(role ? { role } : {}),
      runtime,
      ...(routePath ? { routePath } : {}),
      effectiveName,
    };
  }
  return {
    visibility: kind === "component" ? "feature" : "private",
    ...(feature ? { feature } : {}),
    kind,
    ...(role ? { role } : {}),
    runtime,
    ...(routePath ? { routePath } : {}),
    effectiveName,
  };
}

function sourceCandidates(
  specifier: string,
  fromFile: string,
  rootPath: string,
): string[] {
  const bases: string[] = [];
  if (specifier.startsWith(".")) {
    bases.push(path.resolve(path.dirname(fromFile), specifier));
  } else if (specifier.startsWith("@/")) {
    bases.push(path.resolve(rootPath, "src", specifier.slice(2)));
    bases.push(path.resolve(rootPath, specifier.slice(2)));
  }
  return [
    ...new Set(
      bases.flatMap((base) => [
        base,
        ...[".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs"].map(
          (extension) => `${base}${extension}`,
        ),
        ...["index.tsx", "index.jsx", "index.ts", "index.js"].map((fileName) =>
          path.join(base, fileName),
        ),
      ]),
    ),
  ];
}

async function resolveSourceImport(
  specifier: string,
  fromFile: string,
  rootPath: string,
): Promise<string | undefined> {
  for (const candidate of sourceCandidates(specifier, fromFile, rootPath)) {
    try {
      await readFile(candidate, "utf8");
      return path.resolve(candidate);
    } catch {
      // Continue through deterministic local candidates.
    }
  }
  return undefined;
}

function dynamicImportSpecifier(expression: ts.Expression): string | undefined {
  let specifier: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifier = node.arguments[0].text;
      return;
    }
    if (!specifier) ts.forEachChild(node, visit);
  };
  visit(expression);
  return specifier;
}

async function importBindings(
  source: ts.SourceFile,
  sourcePath: string,
  rootPath: string,
): Promise<ComponentImportBinding[]> {
  const bindings: ComponentImportBinding[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
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
      } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        bindings.push({
          local: clause.namedBindings.name.text,
          imported: "*",
          specifier,
          ...(resolvedPath ? { resolvedPath } : {}),
        });
      }
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const specifier = dynamicImportSpecifier(declaration.initializer);
      if (!specifier) continue;
      const resolvedPath = await resolveSourceImport(specifier, sourcePath, rootPath);
      bindings.push({
        local: declaration.name.text,
        imported: "default",
        specifier,
        ...(resolvedPath ? { resolvedPath } : {}),
        dynamic: true,
      });
    }
  }
  return bindings;
}

async function nextProfile(
  rootPath: string,
  options: ScanOptions,
): Promise<{ next: boolean; router?: "pages" | "app" | "hybrid" }> {
  if (options.packageProfile) {
    return {
      next: options.packageProfile.metaFramework === "next",
      ...(options.packageProfile.router === "pages" ||
      options.packageProfile.router === "app" ||
      options.packageProfile.router === "hybrid"
        ? { router: options.packageProfile.router }
        : {}),
    };
  }
  try {
    const manifest = JSON.parse(
      await readFile(path.join(rootPath, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const next = Boolean(manifest.dependencies?.next || manifest.devDependencies?.next);
    if (!next) return { next: false };
    const appFiles = await fg(["app/**/*", "src/app/**/*"], {
      cwd: rootPath,
      onlyFiles: true,
      unique: true,
    });
    const pageFiles = await fg(["pages/**/*", "src/pages/**/*"], {
      cwd: rootPath,
      onlyFiles: true,
      unique: true,
    });
    return {
      next: true,
      router:
        appFiles.length > 0 && pageFiles.length > 0
          ? "hybrid"
          : appFiles.length > 0
            ? "app"
            : "pages",
    };
  } catch {
    return { next: false };
  }
}

function testsFor(name: string, sourcePath: string, testPaths: string[]): string[] {
  const sourceStem = path.basename(sourcePath, path.extname(sourcePath)).toLowerCase();
  return testPaths.filter((testPath) => {
    const base = path.basename(testPath).toLowerCase();
    return (
      base.startsWith(`${sourceStem}.`) ||
      base.startsWith(`${name.toLowerCase()}.`)
    );
  });
}

export class ReactAdapter implements FrameworkAdapter {
  readonly framework = "react" as const;

  async scan(options: ScanOptions): Promise<ComponentNode[]> {
    return (await this.scanDetailed(options)).components;
  }

  async scanDetailed(options: ScanOptions): Promise<AdapterScanResult> {
    const rootPath = path.resolve(options.rootPath);
    const profile = await nextProfile(rootPath, options);
    const files = await fg(options.include ?? SOURCE_PATTERNS, {
      cwd: rootPath,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: [...SOURCE_EXCLUDES, ...(options.exclude ?? [])],
    });
    const testPaths = (
      await fg(TEST_PATTERNS, {
        cwd: rootPath,
        onlyFiles: true,
        unique: true,
        ignore: ["**/node_modules/**", "**/.next/**"],
      })
    ).map(slash);
    const components: ComponentNode[] = [];
    const diagnostics: AdapterScanResult["coverage"]["diagnostics"] = [];
    let parsedFiles = 0;
    let errorFiles = 0;

    for (const sourcePath of files.sort()) {
      try {
        const text = await readFile(sourcePath, "utf8");
        const relativePath = slash(path.relative(rootPath, sourcePath));
        const source = ts.createSourceFile(
          sourcePath,
          text,
          ts.ScriptTarget.Latest,
          true,
          /\.(?:jsx|js)$/iu.test(sourcePath) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
        );
        const parseDiagnostics = parseDiagnosticMessages(source);
        if (parseDiagnostics.length > 0) {
          errorFiles += 1;
          diagnostics.push({
            severity: "error",
            code: "react-syntax",
            message: parseDiagnostics.join("; ").slice(0, 500),
            path: relativePath,
            framework: "react",
          });
          continue;
        }
        if (isNextNonVisualConvention(relativePath, profile.next)) {
          parsedFiles += 1;
          continue;
        }
        const declarations = new Map<
          string,
          ts.InterfaceDeclaration | ts.TypeAliasDeclaration
        >();
        for (const statement of source.statements) {
          if (ts.isInterfaceDeclaration(statement)) {
            declarations.set(statement.name.text, statement);
          } else if (ts.isTypeAliasDeclaration(statement)) {
            declarations.set(statement.name.text, statement);
          }
        }
        const bindings = await importBindings(source, sourcePath, rootPath);
        const imports = [...new Set(bindings.map((binding) => binding.local))];
        const clientModule = source.statements.some(
          (statement) =>
            ts.isExpressionStatement(statement) &&
            ts.isStringLiteral(statement.expression) &&
            statement.expression.text === "use client",
        );

        for (const candidate of findCandidates(source)) {
          const parameter = candidate.node.parameters[0];
          const props = withParameterDefaults(
            resolveProps(parameter?.type, source, declarations),
            parameter,
            source,
          );
          const facts = jsxFacts(candidate.node);
          const classification = classify(
            relativePath,
            candidate.exported,
            candidate.defaultExported,
            candidate.name,
            profile.next,
            profile.router,
            clientModule,
          );
          if (
            classification.kind === "component" &&
            !containsRenderableOutput(candidate.node)
          ) {
            continue;
          }
          components.push({
            id: componentId("react", relativePath, candidate.name),
            framework: "react",
            name: candidate.name,
            sourcePath,
            relativePath,
            ...classification,
            exported: candidate.exported,
            exportName: candidate.defaultExported ? "default" : candidate.name,
            location: candidate.location,
            props,
            events: [],
            slots: props.some((prop) => prop.name === "children") ? ["children"] : [],
            models: [],
            renderedNames: facts.renderedNames,
            renderReferences: facts.renderedNames.map((name) => ({
              name,
              importedLocal: name,
            })),
            imports,
            importBindings: bindings,
            logicDependencies: facts.logicDependencies,
            testPaths: testsFor(candidate.name, relativePath, testPaths),
            classTokens: facts.classTokens,
            sourceHash: hashText(`${text}\0${candidate.name}`),
          });
        }
        parsedFiles += 1;
      } catch (error) {
        errorFiles += 1;
        diagnostics.push({
          severity: "error",
          code: "react-file-parse",
          message: error instanceof Error ? error.message : String(error),
          path: slash(path.relative(rootPath, sourcePath)),
          framework: "react",
        });
      }
    }

    return {
      components,
      coverage: {
        candidateFiles: files.length,
        parsedFiles,
        skippedFiles: 0,
        errorFiles,
        diagnostics: diagnostics.slice(0, 50),
        byFramework: {
          react: {
            candidateFiles: files.length,
            parsedFiles,
            skippedFiles: 0,
            errorFiles,
          },
        },
        complete: errorFiles === 0 && parsedFiles === files.length,
      },
    };
  }
}

export async function scanReactProject(
  options: ScanOptions,
): Promise<ComponentNode[]> {
  return new ReactAdapter().scan(options);
}

export async function scanReactProjectDetailed(
  options: ScanOptions,
): Promise<AdapterScanResult> {
  return new ReactAdapter().scanDetailed(options);
}
