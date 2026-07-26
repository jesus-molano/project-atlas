import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { baseParse, NodeTypes, type RootNode, type TemplateChildNode } from "@vue/compiler-dom";
import { parse as parseSfc } from "@vue/compiler-sfc";
import fg from "fast-glob";
import ts from "typescript";
import {
  componentId,
  hashText,
  pascalCase,
  slash,
  type ComponentEvent,
  type ComponentNode,
  type ComponentProp,
  type ComponentVisibility,
  type FrameworkAdapter,
  type ScanOptions,
} from "@component-atlas/core";

interface ScriptFacts {
  props: ComponentProp[];
  events: ComponentEvent[];
  slots: string[];
  models: string[];
  imports: string[];
}

interface TemplateFacts {
  renderedNames: string[];
  classTokens: string[];
  slots: string[];
}

interface TestFacts {
  path: string;
  resolvedImports: Set<string>;
  importedNames: Set<string>;
  mountedNames: Set<string>;
}

const SOURCE_PATTERNS = [
  "app/components/**/*.vue",
  "components/**/*.vue",
  "app/pages/**/*.vue",
  "pages/**/*.vue",
  "app/layouts/**/*.vue",
  "layouts/**/*.vue",
];
const TEST_PATTERNS = [
  "test/**/*.{test,spec}.{ts,tsx,js,jsx}",
  "tests/**/*.{test,spec}.{ts,tsx,js,jsx}",
  "**/__tests__/**/*.{ts,tsx,js,jsx}",
];

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function typeText(
  node: ts.TypeNode | undefined,
  declarations: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  seen = new Set<string>(),
): string {
  if (!node) return "unknown";
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const declaration = declarations.get(name);
    if (
      declaration &&
      ts.isTypeAliasDeclaration(declaration) &&
      !seen.has(name)
    ) {
      return typeText(
        declaration.type,
        declarations,
        new Set([...seen, name]),
      );
    }
  }
  return node.getText(node.getSourceFile());
}

function propsFromMembers(
  members: readonly ts.TypeElement[],
  declarations: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
): ComponentProp[] {
  return members.flatMap((member) => {
    if (!ts.isPropertySignature(member)) return [];
    const name = propertyName(member.name);
    if (!name) return [];
    return [
      {
        name,
        type: typeText(member.type, declarations),
        required: !member.questionToken,
      },
    ];
  });
}

function resolveTypeMembers(
  typeNode: ts.TypeNode | undefined,
  declarations: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  seen = new Set<string>(),
): readonly ts.TypeElement[] | undefined {
  if (!typeNode) return undefined;
  if (ts.isTypeLiteralNode(typeNode)) return typeNode.members;
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.flatMap(
      (type) => resolveTypeMembers(type, declarations, seen) ?? [],
    );
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const name = typeNode.typeName.text;
    if (seen.has(name)) return undefined;
    const declaration = declarations.get(name);
    const nextSeen = new Set([...seen, name]);
    if (declaration && ts.isInterfaceDeclaration(declaration)) {
      const inherited = declaration.heritageClauses?.flatMap((clause) =>
        clause.types.flatMap((type) =>
          resolveTypeMembers(type, declarations, nextSeen) ?? [],
        ),
      ) ?? [];
      return [...inherited, ...declaration.members];
    }
    if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      return resolveTypeMembers(declaration.type, declarations, nextSeen);
    }
  }
  return undefined;
}

function literalValue(node: ts.Expression, source: ts.SourceFile): string {
  return node.getText(source);
}

function collectDefaults(
  call: ts.CallExpression,
  source: ts.SourceFile,
): Map<string, string> {
  const defaults = new Map<string, string>();
  const object = call.arguments[1];
  if (!object || !ts.isObjectLiteralExpression(object)) return defaults;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (name) defaults.set(name, literalValue(property.initializer, source));
  }
  return defaults;
}

function eventNameFromMember(member: ts.TypeElement): ComponentEvent[] {
  if (ts.isPropertySignature(member)) {
    const name = propertyName(member.name);
    if (!name) return [];
    return member.type
      ? [{ name, payload: member.type.getText(member.getSourceFile()) }]
      : [{ name }];
  }
  if (!ts.isCallSignatureDeclaration(member)) return [];
  const firstParameter = member.parameters[0];
  const type = firstParameter?.type;
  if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    const payload = member.parameters
      .slice(1)
      .map((parameter) => parameter.getText(parameter.getSourceFile()))
      .join(", ");
    return [
      payload
        ? { name: type.literal.text, payload }
        : { name: type.literal.text },
    ];
  }
  return [];
}

function destructuredDefaults(source: ts.SourceFile): Map<string, string> {
  const defaults = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const initializer = node.initializer;
      const containsProps =
        (ts.isCallExpression(initializer) &&
          ts.isIdentifier(initializer.expression) &&
          ["defineProps", "withDefaults", "reactive"].includes(
            initializer.expression.text,
          )) ||
        initializer.getText(source).includes("defineProps");
      if (containsProps) {
        for (const element of node.name.elements) {
          if (!element.initializer) continue;
          const bindingName = ts.isIdentifier(element.name)
            ? element.name
            : undefined;
          const name = propertyName(element.propertyName ?? bindingName);
          if (name) defaults.set(name, element.initializer.getText(source));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return defaults;
}

function parseScript(
  script: string,
  fileName: string,
  importedDeclarations = new Map<
    string,
    ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  >(),
): ScriptFacts {
  if (!script.trim()) {
    return { props: [], events: [], slots: [], models: [], imports: [] };
  }
  const source = ts.createSourceFile(
    fileName,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = new Map<
    string,
    ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  >(importedDeclarations);
  const imports: string[] = [];
  let props: ComponentProp[] = [];
  const events: ComponentEvent[] = [];
  const slots: string[] = [];
  const models: string[] = [];

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

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const macro = node.expression.text;
      if (macro === "defineProps") {
        const members = resolveTypeMembers(node.typeArguments?.[0], declarations);
        if (members) props = propsFromMembers(members, declarations);
      } else if (macro === "withDefaults") {
        const inner = node.arguments[0];
        if (
          inner &&
          ts.isCallExpression(inner) &&
          ts.isIdentifier(inner.expression) &&
          inner.expression.text === "defineProps"
        ) {
          const members = resolveTypeMembers(
            inner.typeArguments?.[0],
            declarations,
          );
          if (members) props = propsFromMembers(members, declarations);
          const defaults = collectDefaults(node, source);
          props = props.map((prop) => {
            const defaultValue = defaults.get(prop.name);
            return defaultValue === undefined
              ? prop
              : { ...prop, required: false, defaultValue };
          });
          // The nested defineProps call is an implementation detail of
          // withDefaults. Visiting it again would overwrite the enriched props
          // above and discard every inferred default.
          return;
        }
      } else if (macro === "defineEmits") {
        const members = resolveTypeMembers(node.typeArguments?.[0], declarations);
        if (members) events.push(...members.flatMap(eventNameFromMember));
      } else if (macro === "defineSlots") {
        const members = resolveTypeMembers(node.typeArguments?.[0], declarations);
        if (members) {
          slots.push(
            ...members
              .map((member) =>
                ts.isPropertySignature(member) || ts.isMethodSignature(member)
                  ? propertyName(member.name)
                  : undefined,
              )
              .filter((name): name is string => Boolean(name)),
          );
        }
      } else if (macro === "defineModel") {
        const first = node.arguments[0];
        models.push(
          first && ts.isStringLiteral(first) ? first.text : "modelValue",
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const defaults = destructuredDefaults(source);
  props = props.map((prop) => {
    const defaultValue = defaults.get(prop.name);
    return defaultValue === undefined
      ? prop
      : { ...prop, required: false, defaultValue };
  });

  return {
    props,
    events: [...new Map(events.map((event) => [event.name, event])).values()],
    slots: [...new Set(slots)],
    models: [...new Set(models)],
    imports: [...new Set(imports)],
  };
}

function runtimeTag(tag: string): string {
  return tag.includes("-") ? pascalCase(tag) : tag;
}

function parseTemplate(template: string): TemplateFacts {
  if (!template.trim()) return { renderedNames: [], classTokens: [], slots: [] };
  let root: RootNode;
  try {
    root = baseParse(template);
  } catch {
    return { renderedNames: [], classTokens: [], slots: [] };
  }
  const renderedNames: string[] = [];
  const classTokens: string[] = [];
  const slots: string[] = [];

  const visit = (node: RootNode | TemplateChildNode): void => {
    if (node.type === NodeTypes.ELEMENT) {
      if (/^[A-Z]/.test(node.tag) || node.tag.includes("-")) {
        renderedNames.push(runtimeTag(node.tag));
      }
      if (node.tag === "slot") {
        const nameAttribute = node.props.find(
          (prop) =>
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name === "name" &&
            prop.value,
        );
        slots.push(
          nameAttribute && nameAttribute.type === NodeTypes.ATTRIBUTE
            ? (nameAttribute.value?.content ?? "default")
            : "default",
        );
      }
      for (const property of node.props) {
        if (
          property.type === NodeTypes.ATTRIBUTE &&
          property.name === "class" &&
          property.value
        ) {
          classTokens.push(
            ...property.value.content
              .split(/\s+/)
              .map((token) => token.trim())
              .filter(Boolean),
          );
        }
      }
    }
    const possibleChildren = (node as { children?: unknown[] }).children;
    if (Array.isArray(possibleChildren)) {
      for (const child of possibleChildren) {
        if (typeof child === "object" && child !== null && "type" in child) {
          visit(child as TemplateChildNode);
        }
      }
    }
    if (node.type === NodeTypes.IF) {
      for (const branch of node.branches) {
        for (const child of branch.children) visit(child);
      }
    }
    if (node.type === NodeTypes.FOR) {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return {
    renderedNames: [...new Set(renderedNames)],
    classTokens: [...new Set(classTokens)],
    slots: [...new Set(slots)],
  };
}

function componentRoot(relativePath: string): string[] {
  const parts = slash(relativePath).split("/");
  const index = parts.lastIndexOf("components");
  return index >= 0 ? parts.slice(index + 1) : parts;
}

function effectiveNuxtName(relativePath: string): string {
  const parts = componentRoot(relativePath);
  const file = parts.pop() ?? "";
  const base = file.replace(/\.vue$/i, "");
  if (base.toLowerCase() !== "index") parts.push(base);
  return pascalCase(parts.join("-"));
}

function classify(relativePath: string): {
  visibility: ComponentVisibility;
  feature?: string;
} {
  if (/(^|\/)(?:pages|layouts)\//i.test(slash(relativePath))) {
    return { visibility: "private" };
  }
  const parts = componentRoot(relativePath).map((part) => part.toLowerCase());
  const first = parts[0];
  if (first && ["ui", "shared", "common"].includes(first)) {
    return { visibility: "public" };
  }
  const fileName = parts.at(-1) ?? "";
  if (fileName.startsWith("_")) {
    return first
      ? { visibility: "private", feature: first }
      : { visibility: "private" };
  }
  return first
    ? { visibility: "feature", feature: first }
    : { visibility: "feature" };
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

async function resolveSourceImport(
  specifier: string,
  fromFile: string,
  rootPath: string,
): Promise<string | undefined> {
  for (const candidate of sourceCandidates(specifier, fromFile, rootPath)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through deterministic local candidates.
    }
  }
  return undefined;
}

function declarationsIn(source: ts.SourceFile) {
  return source.statements.filter(
    (
      statement,
    ): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement),
  );
}

async function importedTypeDeclarations(
  script: string,
  sourcePath: string,
  rootPath: string,
) {
  const source = ts.createSourceFile(
    sourcePath,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
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
    );
    if (!importedPath || !/\.d?tsx?$/i.test(importedPath)) continue;
    const importedSource = ts.createSourceFile(
      importedPath,
      await readFile(importedPath, "utf8"),
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

async function collectTestFacts(
  rootPath: string,
  testPaths: string[],
): Promise<TestFacts[]> {
  return Promise.all(
    testPaths.map(async (testPath) => {
      const absolutePath = path.resolve(rootPath, testPath);
      const sourceText = await readFile(absolutePath, "utf8");
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

      return {
        path: slash(testPath),
        resolvedImports,
        importedNames,
        mountedNames,
      };
    }),
  );
}

function testsFor(
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

export class VueAdapter implements FrameworkAdapter {
  readonly framework = "vue" as const;

  async scan(options: ScanOptions): Promise<ComponentNode[]> {
    const rootPath = path.resolve(options.rootPath);
    const files = await fg(options.include ?? SOURCE_PATTERNS, {
      cwd: rootPath,
      absolute: true,
      onlyFiles: true,
      ignore: [
        "**/node_modules/**",
        "**/.nuxt/**",
        "**/.output/**",
        ...(options.exclude ?? []),
      ],
    });
    const testPaths = (
      await fg(TEST_PATTERNS, {
        cwd: rootPath,
        onlyFiles: true,
        ignore: ["**/node_modules/**", "**/.nuxt/**", "**/.output/**"],
      })
    ).map(slash);
    const testFacts = await collectTestFacts(rootPath, testPaths);

    return Promise.all(
      files.sort().map(async (sourcePath) => {
        const source = await readFile(sourcePath, "utf8");
        const relativePath = slash(path.relative(rootPath, sourcePath));
        const parsed = parseSfc(source, { filename: sourcePath });
        const script =
          parsed.descriptor.scriptSetup?.content ??
          parsed.descriptor.script?.content ??
          "";
        const externalDeclarations = await importedTypeDeclarations(
          script,
          sourcePath,
          rootPath,
        );
        const scriptFacts = parseScript(
          script,
          sourcePath,
          externalDeclarations,
        );
        const templateFacts = parseTemplate(parsed.descriptor.template?.content ?? "");
        const name = pascalCase(path.basename(sourcePath, ".vue"));
        const effectiveName = effectiveNuxtName(relativePath) || name;
        const classification = classify(relativePath);
        const kind = /(^|\/)pages\//i.test(relativePath)
          ? ("route" as const)
          : /(^|\/)layouts\//i.test(relativePath)
            ? ("layout" as const)
            : ("component" as const);
        const componentTests = testsFor(
          relativePath,
          name,
          effectiveName,
          testFacts,
        );
        return {
          id: componentId("vue", relativePath, name),
          framework: "vue",
          kind,
          name,
          effectiveName,
          sourcePath,
          relativePath,
          ...classification,
          exported: kind === "component",
          location: { line: 1, column: 1 },
          props: scriptFacts.props,
          events: scriptFacts.events,
          slots: [...new Set([...scriptFacts.slots, ...templateFacts.slots])],
          models: scriptFacts.models,
          renderedNames: templateFacts.renderedNames,
          imports: scriptFacts.imports,
          testPaths: componentTests,
          classTokens: templateFacts.classTokens,
          sourceHash: hashText(source),
        } satisfies ComponentNode;
      }),
    );
  }
}

export async function scanVueProject(options: ScanOptions): Promise<ComponentNode[]> {
  return new VueAdapter().scan(options);
}
