import path from "node:path";
import {
  slash,
  type ComponentImportBinding,
} from "@component-atlas/core";
import { createScanSafetySession, type ScanSafetySession } from "@component-atlas/core/scan-safety";
import ts from "typescript";

interface TestFacts {
  path: string;
  resolvedImports: Set<string>;
  importedNames: Set<string>;
  mountedNames: Set<string>;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return /\.tsx$/iu.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function componentRoot(relativePath: string): string[] {
  const normalized = slash(relativePath);
  const marker = normalized.includes("/components/")
    ? "/components/"
    : "components/";
  return normalized.split(marker).at(-1)?.split("/") ?? [normalized];
}

function sourceCandidates(
  specifier: string,
  fromFile: string,
  rootPath: string,
): string[] {
  const bases: string[] = [];
  if (specifier.startsWith(".")) {
    bases.push(path.resolve(path.dirname(fromFile), specifier));
  } else if (specifier.startsWith("~~/") || specifier.startsWith("@@/")) {
    bases.push(path.resolve(rootPath, specifier.slice(3)));
  } else if (specifier.startsWith("~/") || specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    bases.push(path.resolve(rootPath, relative));
    bases.push(path.resolve(rootPath, "app", relative));
    bases.push(path.resolve(rootPath, "src", relative));
  }
  return [...new Set(
    bases.flatMap((base) => [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.d.ts`,
      `${base}.vue`,
      path.join(base, "index.ts"),
      path.join(base, "index.d.ts"),
    ]),
  )];
}

export async function resolveSourceImport(
  specifier: string,
  fromFile: string,
  rootPath: string,
  scanSafetySession?: ScanSafetySession,
): Promise<string | undefined> {
  const session = scanSafetySession ?? await createScanSafetySession(rootPath);
  for (const candidate of sourceCandidates(specifier, fromFile, rootPath)) {
    try {
      await session.readText(candidate);
      return candidate;
    } catch {
      // Continue through deterministic local candidates.
    }
  }
  return undefined;
}

export async function importBindings(
  script: string,
  sourcePath: string,
  rootPath: string,
  scanSafetySession?: ScanSafetySession,
): Promise<ComponentImportBinding[]> {
  if (!script.trim()) return [];
  const source = ts.createSourceFile(
    sourcePath,
    script,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/iu.test(sourcePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings: ComponentImportBinding[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const resolvedPath = await resolveSourceImport(specifier, sourcePath, rootPath, scanSafetySession);
    const clause = statement.importClause;
    if (clause?.name) {
      bindings.push({
        local: clause.name.text,
        imported: "default",
        specifier,
        ...(resolvedPath ? { resolvedPath: path.resolve(resolvedPath) } : {}),
      });
    }
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const binding of clause.namedBindings.elements) {
        bindings.push({
          local: binding.name.text,
          imported: binding.propertyName?.text ?? binding.name.text,
          specifier,
          ...(resolvedPath ? { resolvedPath: path.resolve(resolvedPath) } : {}),
        });
      }
    } else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({
        local: clause.namedBindings.name.text,
        imported: "*",
        specifier,
        ...(resolvedPath ? { resolvedPath: path.resolve(resolvedPath) } : {}),
      });
    }
  }
  return bindings;
}

function declarationsIn(source: ts.SourceFile) {
  return source.statements.filter(
    (
      statement,
    ): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement),
  );
}

export async function importedTypeDeclarations(
  script: string,
  sourcePath: string,
  rootPath: string,
  scanSafetySession?: ScanSafetySession,
) {
  const session = scanSafetySession ?? await createScanSafetySession(rootPath);
  const source = ts.createSourceFile(
    sourcePath,
    script,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(sourcePath),
  );
  const declarations = new Map<
    string,
    ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  >();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const importedPath = await resolveSourceImport(
      statement.moduleSpecifier.text,
      sourcePath,
      rootPath,
      session,
    );
    if (!importedPath || !/\.d?tsx?$/i.test(importedPath)) continue;
    const importedSource = ts.createSourceFile(
      importedPath,
      await session.readText(importedPath),
      ts.ScriptTarget.Latest,
      true,
      importedPath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const available = declarationsIn(importedSource);
    for (const declaration of available) {
      declarations.set(declaration.name.text, declaration);
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        const importedName = binding.propertyName?.text ?? binding.name.text;
        const declaration = available.find(
          (candidate) => candidate.name.text === importedName,
        );
        if (declaration) declarations.set(binding.name.text, declaration);
      }
    }
    const defaultName = statement.importClause?.name?.text;
    if (defaultName) {
      const declaration = available.find((candidate) =>
        candidate.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
        ),
      );
      if (declaration) declarations.set(defaultName, declaration);
    }
  }
  return declarations;
}

export async function collectTestFacts(
  rootPath: string,
  testPaths: string[],
  scanSafetySession?: ScanSafetySession,
): Promise<TestFacts[]> {
  const session = scanSafetySession ?? await createScanSafetySession(rootPath);
  const facts: TestFacts[] = [];
  for (const testPath of [...testPaths].sort((left, right) => left.localeCompare(right))) {
    const absolutePath = path.resolve(rootPath, testPath);
    const sourceText = await session.readText(absolutePath);
    const source = ts.createSourceFile(
      absolutePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/i.test(testPath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const resolvedImports = new Set<string>();
    const importedNames = new Set<string>();
    const mountedNames = new Set<string>();

    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (clause?.name) importedNames.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          importedNames.add(binding.name.text);
        }
      }
      if (ts.isStringLiteral(statement.moduleSpecifier)) {
        const imported = await resolveSourceImport(
          statement.moduleSpecifier.text,
          absolutePath,
          rootPath,
          session,
        );
        if (imported?.toLowerCase().endsWith(".vue")) {
          resolvedImports.add(slash(path.relative(rootPath, imported)).toLowerCase());
        }
      }
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        /^(?:mount|mountSuspended|shallowMount|render)$/i.test(
          node.expression.text,
        )
      ) {
        const target = node.arguments[0];
        if (target && ts.isIdentifier(target)) mountedNames.add(target.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    facts.push({
      path: slash(testPath),
      resolvedImports,
      importedNames,
      mountedNames,
    });
  }
  return facts;
}

export function testsFor(
  componentPath: string,
  componentName: string,
  effectiveName: string,
  tests: TestFacts[],
): string[] {
  const rootParts = componentRoot(componentPath);
  const relativeStem = slash(
    [...rootParts.slice(0, -1), path.basename(rootParts.at(-1) ?? "", ".vue")]
      .join("/"),
  ).toLowerCase();
  const normalizedComponentPath = slash(componentPath).toLowerCase();
  const names = new Set([componentName, effectiveName]);
  return tests.filter((test) => {
    if (test.resolvedImports.has(normalizedComponentPath)) return true;
    const normalized = `/${test.path.toLowerCase()}`;
    const mirrored =
      normalized.includes(`/components/${relativeStem}.test.`) ||
      normalized.includes(`/components/${relativeStem}.spec.`);
    const referenced = [...names].some(
      (name) => test.importedNames.has(name) && test.mountedNames.has(name),
    );
    return referenced || mirrored;
  }).map((test) => test.path);
}
