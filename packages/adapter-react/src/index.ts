import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import {
  componentId,
  hashText,
  slash,
  type ComponentNode,
  type ComponentProp,
  type ComponentVisibility,
  type FrameworkAdapter,
  type ScanOptions,
} from "@component-atlas/core";

const SOURCE_PATTERNS = [
  "src/**/*.{tsx,jsx}",
  "app/**/*.{tsx,jsx}",
  "components/**/*.{tsx,jsx}",
];
const SOURCE_EXCLUDES = [
  "**/*.{test,spec}.{tsx,jsx}",
  "**/*.stories.{tsx,jsx}",
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
  location: { line: number; column: number };
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

function isUppercaseName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
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
      if (!isUppercaseName(name)) continue;
      const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
      candidates.push({
        name,
        node: statement,
        declaration: statement,
        exported: hasExportModifier(statement) || defaults.has(name),
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
        initializer.arguments[0] &&
        (ts.isArrowFunction(initializer.arguments[0]) ||
          ts.isFunctionExpression(initializer.arguments[0]))
      ) {
        initializer = initializer.arguments[0];
      }
      if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) {
        continue;
      }
      const position = source.getLineAndCharacterOfPosition(declaration.getStart(source));
      candidates.push({
        name,
        node: initializer,
        declaration,
        exported: hasExportModifier(statement) || defaults.has(name),
        location: { line: position.line + 1, column: position.character + 1 },
      });
    }
  }
  return candidates;
}

function jsxFacts(node: ts.FunctionLikeDeclaration): {
  renderedNames: string[];
  classTokens: string[];
} {
  const renderedNames: string[] = [];
  const classTokens: string[] = [];
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
    ts.forEachChild(current, visit);
  };
  if (node.body) visit(node.body);
  return {
    renderedNames: [...new Set(renderedNames)],
    classTokens: [...new Set(classTokens)],
  };
}

function classify(
  relativePath: string,
  exported: boolean,
): { visibility: ComponentVisibility; feature?: string } {
  const parts = slash(relativePath).split("/");
  const lower = parts.map((part) => part.toLowerCase());
  const uiIndex = lower.indexOf("ui");
  if (
    uiIndex > -1 &&
    (lower[uiIndex - 1] === "components" || lower.includes("shared"))
  ) {
    return { visibility: "public" };
  }
  const featureIndex = lower.findIndex(
    (part) => part === "features" || part === "feature",
  );
  const feature = featureIndex >= 0 ? parts[featureIndex + 1] : undefined;
  if (!exported) {
    return feature
      ? { visibility: "private", feature }
      : { visibility: "private" };
  }
  return feature ? { visibility: "feature", feature } : { visibility: "feature" };
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
    const rootPath = path.resolve(options.rootPath);
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

    for (const sourcePath of files.sort()) {
      const text = await readFile(sourcePath, "utf8");
      const relativePath = slash(path.relative(rootPath, sourcePath));
      const source = ts.createSourceFile(
        sourcePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        sourcePath.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TSX,
      );
      const declarations = new Map<
        string,
        ts.InterfaceDeclaration | ts.TypeAliasDeclaration
      >();
      const imports: string[] = [];
      for (const statement of source.statements) {
        if (ts.isInterfaceDeclaration(statement)) {
          declarations.set(statement.name.text, statement);
        } else if (ts.isTypeAliasDeclaration(statement)) {
          declarations.set(statement.name.text, statement);
        } else if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause;
          if (clause?.name) imports.push(clause.name.text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            imports.push(...clause.namedBindings.elements.map((item) => item.name.text));
          }
        }
      }

      for (const candidate of findCandidates(source)) {
        const parameter = candidate.node.parameters[0];
        const props = withParameterDefaults(
          resolveProps(parameter?.type, source, declarations),
          parameter,
          source,
        );
        const facts = jsxFacts(candidate.node);
        const classification = classify(relativePath, candidate.exported);
        components.push({
          id: componentId("react", relativePath, candidate.name),
          framework: "react",
          name: candidate.name,
          effectiveName: candidate.name,
          sourcePath,
          relativePath,
          ...classification,
          exported: candidate.exported,
          location: candidate.location,
          props,
          events: [],
          slots: props.some((prop) => prop.name === "children") ? ["children"] : [],
          models: [],
          renderedNames: facts.renderedNames,
          imports: [...new Set(imports)],
          testPaths: testsFor(candidate.name, relativePath, testPaths),
          classTokens: facts.classTokens,
          sourceHash: hashText(`${text}\0${candidate.name}`),
        });
      }
    }

    return components;
  }
}

export async function scanReactProject(
  options: ScanOptions,
): Promise<ComponentNode[]> {
  return new ReactAdapter().scan(options);
}
