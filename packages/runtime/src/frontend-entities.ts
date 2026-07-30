import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  edgeId,
  slash,
  type ComponentNode,
  type Framework,
  type FrontendEntity,
  type GraphEdge,
} from "@component-atlas/core";
import { parse as parseAstro } from "@astrojs/compiler";
import { parse as parseVue } from "@vue/compiler-sfc";
import fg from "fast-glob";
import ts from "typescript";

export interface FrontendSemanticGraph {
  entities: FrontendEntity[];
  edges: GraphEdge[];
}

interface SourceUnit {
  absolutePath: string;
  relativePath: string;
  framework: Framework;
  source: string;
  script: string;
  analyzer: FrontendEntity["provenance"]["analyzer"];
  ast: ts.SourceFile;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function entityId(
  framework: Framework,
  kind: FrontendEntity["kind"],
  relativePath: string,
  name: string,
): string {
  return `${framework}:${kind}:${slash(relativePath)}#${name}`;
}

function lineAndColumn(sourceFile: ts.SourceFile, position: number) {
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: location.line + 1, column: location.character + 1 };
}

function staticString(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function callName(expression: ts.LeftHandSideExpression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : undefined;
    return owner ? `${owner}.${expression.name.text}` : expression.name.text;
  }
  return undefined;
}

async function sourceUnit(
  absolutePath: string,
  rootPath: string,
  framework: Framework,
): Promise<SourceUnit | undefined> {
  const relativePath = slash(path.relative(rootPath, absolutePath));
  const source = await readFile(absolutePath, "utf8");
  const extension = path.extname(absolutePath).toLowerCase();
  let script = source;
  let analyzer: SourceUnit["analyzer"] = "typescript-program";
  if (extension === ".vue") {
    const parsed = parseVue(source, { filename: absolutePath });
    script = [
      parsed.descriptor.script?.content,
      parsed.descriptor.scriptSetup?.content,
    ]
      .filter(Boolean)
      .join("\n");
    analyzer = "vue-compiler";
  } else if (extension === ".astro") {
    await parseAstro(source, { position: true });
    script = source.match(/^---\s*([\s\S]*?)\s*---/u)?.[1] ?? "";
    analyzer = "astro-compiler";
  }
  if (!script.trim()) return undefined;
  const scriptKind =
    extension === ".tsx" || extension === ".jsx"
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  return {
    absolutePath,
    relativePath,
    framework,
    source,
    script,
    analyzer,
    ast: ts.createSourceFile(
      absolutePath,
      script,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    ),
  };
}

function exported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ),
  );
}

function baseEntity(
  unit: SourceUnit,
  kind: FrontendEntity["kind"],
  name: string,
  node: ts.Node,
  isExported: boolean,
): FrontendEntity {
  return {
    id: entityId(unit.framework, kind, unit.relativePath, name),
    kind,
    framework: unit.framework,
    name,
    sourcePath: unit.absolutePath,
    relativePath: unit.relativePath,
    exported: isExported,
    ...(isExported ? { exportName: name } : {}),
    location: lineAndColumn(unit.ast, node.getStart(unit.ast)),
    sourceHash: hash(unit.source),
    resolution:
      unit.analyzer === "typescript-program" ? "exact" : "framework-convention",
    provenance: {
      sourcePath: unit.relativePath,
      symbol: name,
      analyzer: unit.analyzer,
    },
  };
}

function declaredEntities(unit: SourceUnit): FrontendEntity[] {
  const entities: FrontendEntity[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      /^use[A-Z0-9]/u.test(node.name.text)
    ) {
      entities.push(
        baseEntity(unit, "composable", node.name.text, node, exported(node)),
      );
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const declaration = node.parent?.parent ?? node;
      const initializer = node.initializer;
      const initializerName =
        initializer && ts.isCallExpression(initializer)
          ? callName(initializer.expression)
          : undefined;
      if (/^use[A-Z0-9]/u.test(name)) {
        entities.push(
          baseEntity(unit, "composable", name, node, exported(declaration)),
        );
      }
      if (
        initializerName === "defineStore" ||
        initializerName === "createStore" ||
        initializerName === "createContext" ||
        /(?:^|[/\\])stores?[/\\]/iu.test(unit.relativePath)
      ) {
        entities.push(baseEntity(unit, "store", name, node, exported(declaration)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(unit.ast);
  const isStory = /\.stories?\.[cm]?[jt]sx?$/iu.test(unit.relativePath);
  const isTest = /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(unit.relativePath);
  if (isStory || isTest) {
    const kind = isStory ? "story" : "test";
    const name = path.basename(unit.relativePath).replace(/\.[^.]+$/u, "");
    entities.push(baseEntity(unit, kind, name, unit.ast, true));
  }
  return entities.filter(
    (entity, index, collection) =>
      collection.findIndex((candidate) => candidate.id === entity.id) === index,
  );
}

function fileEntity(unit: SourceUnit): FrontendEntity | undefined {
  if (!/\.[cm]?[jt]sx?$/iu.test(unit.relativePath)) return undefined;
  const kind: FrontendEntity["kind"] =
    /(?:^|\/)(?:api|backend|bff|connectors?|integrations?|mcp|server|services?)(?:\/|$)/iu.test(
      unit.relativePath,
    )
      ? "service"
      : "module";
  const name = path
    .basename(unit.relativePath)
    .replace(/\.[cm]?[jt]sx?$/iu, "");
  const isExported = unit.ast.statements.some((statement) => exported(statement));
  return baseEntity(unit, kind, name, unit.ast, isExported);
}

function endpointEntities(unit: SourceUnit): FrontendEntity[] {
  const entities: FrontendEntity[] = [];
  let index = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const axiosMethod = name?.match(/^axios\.(get|post|put|patch|delete)$/u);
      const supported =
        name === "$fetch" ||
        name === "useFetch" ||
        name === "fetch" ||
        name === "axios" ||
        Boolean(axiosMethod) ||
        /(?:Api|Client)\.[A-Za-z0-9_$]+$/u.test(name ?? "");
      if (supported) {
        const route = staticString(node.arguments[0]);
        const method =
          axiosMethod?.[1]?.toUpperCase() ??
          (name === "fetch" || name === "$fetch" || name === "useFetch"
            ? "GET"
            : undefined);
        const client: NonNullable<FrontendEntity["endpoint"]>["client"] =
          name === "$fetch"
            ? "$fetch"
            : name === "useFetch"
              ? "useFetch"
              : name === "fetch"
                ? "fetch"
                : name?.startsWith("axios")
                  ? "axios"
                  : "generated-client";
        const entityName = route
          ? `${method ?? "CALL"} ${route}`
          : `${name ?? "endpoint"}@${++index}`;
        entities.push({
          ...baseEntity(unit, "endpoint", entityName, node, false),
          resolution: route ? "exact" : "inferred",
          provenance: {
            sourcePath: unit.relativePath,
            ...(name ? { symbol: name } : {}),
            analyzer: route ? unit.analyzer : "heuristic",
          },
          endpoint: {
            client,
            ...(method ? { method } : {}),
            ...(route ? { path: route, openApiStatus: "unresolved" } : {}),
            ...(!route ? { openApiStatus: "ambiguous" as const } : {}),
          },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(unit.ast);
  return entities;
}

function relationKind(entity: FrontendEntity): GraphEdge["kind"] | undefined {
  if (entity.kind === "composable") return "uses_composable";
  if (entity.kind === "store") return "uses_store";
  if (entity.kind === "endpoint") return "calls_endpoint";
  return undefined;
}

function disambiguateEntityIds(
  discovered: FrontendEntity[],
): FrontendEntity[] {
  const totals = new Map<string, number>();
  for (const entity of discovered) {
    totals.set(entity.id, (totals.get(entity.id) ?? 0) + 1);
  }
  const used = new Set(
    discovered
      .filter((entity) => totals.get(entity.id) === 1)
      .map((entity) => entity.id),
  );
  return discovered.map((entity) => {
    if ((totals.get(entity.id) ?? 0) === 1) {
      return entity;
    }
    const location = entity.location;
    const callsiteId = `${entity.id}@${location.line}:${location.column}`;
    let id = callsiteId;
    let occurrence = 1;
    while (used.has(id)) {
      occurrence += 1;
      id = `${callsiteId}:${occurrence}`;
    }
    used.add(id);
    return { ...entity, id };
  });
}

function semanticEdges(
  units: SourceUnit[],
  components: ComponentNode[],
  entities: FrontendEntity[],
  program: ts.Program,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const byName = new Map<string, FrontendEntity[]>();
  for (const entity of entities) {
    if (!relationKind(entity)) continue;
    for (const name of new Set(
      [entity.name, entity.exportName].filter(Boolean) as string[],
    )) {
      byName.set(name, [...(byName.get(name) ?? []), entity]);
    }
  }
  const componentByPath = new Map(
    components.map((component) => [component.relativePath, component]),
  );
  const checker = program.getTypeChecker();
  for (const unit of units) {
  const owner =
      componentByPath.get(unit.relativePath) ??
      entities.find(
        (entity) =>
          entity.relativePath === unit.relativePath &&
          ["module", "service"].includes(entity.kind),
      ) ??
      entities.find(
        (entity) =>
          entity.relativePath === unit.relativePath &&
          !["story", "test"].includes(entity.kind),
      );
    if (!owner) continue;
    const usedNames = new Map<string, string | undefined>();
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression);
        if (name) {
          const localName = name.split(".").at(-1) ?? name;
          let declarationPath: string | undefined;
          if (unit.analyzer === "typescript-program") {
            const symbolNode = ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name
              : node.expression;
            const localSymbol = checker.getSymbolAtLocation(symbolNode);
            const symbol =
              localSymbol && (localSymbol.flags & ts.SymbolFlags.Alias) !== 0
                ? checker.getAliasedSymbol(localSymbol)
                : localSymbol;
            declarationPath = symbol?.declarations?.[0]?.getSourceFile().fileName;
          }
          usedNames.set(localName, declarationPath);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(unit.ast);
    for (const [name, declarationPath] of usedNames) {
      const namedCandidates = byName.get(name) ?? [];
      const exactCandidates = declarationPath
        ? namedCandidates.filter(
            (candidate) =>
              path.resolve(candidate.sourcePath).toLowerCase() ===
              path.resolve(declarationPath).toLowerCase(),
          )
        : [];
      const conventionCandidates =
        /Store$/u.test(name) &&
        namedCandidates.some((candidate) => candidate.kind === "store")
          ? namedCandidates.filter((candidate) => candidate.kind === "store")
          : namedCandidates;
      const candidates =
        exactCandidates.length === 1 ? exactCandidates : conventionCandidates;
      if (candidates.length !== 1) continue;
      const target = candidates[0]!;
      if (target.id === owner.id) continue;
      const kind = relationKind(target);
      if (!kind) continue;
      const resolution =
        exactCandidates.length === 1
          ? "exact"
          : "framework-convention";
      edges.push({
        id: edgeId(kind, owner.id, target.id),
        kind,
        source: owner.id,
        target: target.id,
        resolution,
        provenance: { sourcePath: unit.relativePath, symbol: name },
      });
    }
    for (const endpoint of entities.filter(
      (entity) =>
        entity.kind === "endpoint" &&
        entity.relativePath === unit.relativePath,
    )) {
      edges.push({
        id: edgeId("calls_endpoint", owner.id, endpoint.id),
        kind: "calls_endpoint",
        source: owner.id,
        target: endpoint.id,
        resolution: endpoint.resolution,
        provenance: endpoint.provenance,
      });
    }
  }
  for (const evidence of entities.filter((entity) =>
    ["story", "test"].includes(entity.kind),
  )) {
    const stem = evidence.relativePath
      .replace(/\.(?:stories?|test|spec)\.[^.]+$/iu, "")
      .toLowerCase();
    const target = components.find((component) =>
      component.relativePath
        .replace(/\.[^.]+$/u, "")
        .toLowerCase()
        .endsWith(stem),
    );
    if (!target) continue;
    const kind = evidence.kind === "story" ? "demonstrated_by" : "tested_by";
    edges.push({
      id: edgeId(kind, target.id, evidence.id),
      kind,
      source: target.id,
      target: evidence.id,
      resolution: "framework-convention",
      provenance: { sourcePath: evidence.relativePath },
    });
  }
  return edges.filter(
    (edge, index, collection) =>
      collection.findIndex((candidate) => candidate.id === edge.id) === index,
  );
}

export async function scanFrontendEntities(
  rootPath: string,
  frameworks: Framework[],
  components: ComponentNode[],
): Promise<FrontendSemanticGraph> {
  const files = await fg(
    [
      "**/*.{ts,tsx,js,jsx,vue,astro}",
      "!**/*.d.ts",
      "!**/node_modules/**",
      "!**/.nuxt/**",
      "!**/.output/**",
      "!**/dist/**",
      "!**/coverage/**",
      "!**/.component-atlas/**",
    ],
    { cwd: rootPath, absolute: true, onlyFiles: true, unique: true },
  );
  const primary = frameworks[0] ?? "vue";
  const units = (
    await Promise.all(
      files.map((file) => {
        const extension = path.extname(file).toLowerCase();
        const framework =
          extension === ".vue"
            ? "vue"
            : extension === ".astro"
              ? "astro"
              : frameworks.includes("react")
                ? "react"
                : primary;
        return sourceUnit(file, rootPath, framework);
      }),
    )
  ).filter((unit): unit is SourceUnit => Boolean(unit));
  const program = ts.createProgram({
    rootNames: units
      .filter((unit) => unit.analyzer === "typescript-program")
      .map((unit) => unit.absolutePath),
    options: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.Latest,
    },
  });
  const programUnits = units.map((unit) => {
    if (unit.analyzer !== "typescript-program") return unit;
    const ast = program.getSourceFile(unit.absolutePath);
    return ast ? { ...unit, ast } : unit;
  });
  const entities = disambiguateEntityIds(
    programUnits.flatMap((unit) => {
      const file = fileEntity(unit);
      return [
        ...(file ? [file] : []),
        ...declaredEntities(unit),
        ...endpointEntities(unit),
      ];
    }),
  )
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    entities,
    edges: semanticEdges(programUnits, components, entities, program),
  };
}
