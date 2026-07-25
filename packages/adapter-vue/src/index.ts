import { readFile } from "node:fs/promises";
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

const SOURCE_PATTERNS = ["app/components/**/*.vue", "components/**/*.vue"];
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

function typeText(node: ts.TypeNode | undefined, source: ts.SourceFile): string {
  return node ? node.getText(source) : "unknown";
}

function propsFromMembers(
  members: ts.NodeArray<ts.TypeElement>,
  source: ts.SourceFile,
): ComponentProp[] {
  return members.flatMap((member) => {
    if (!ts.isPropertySignature(member)) return [];
    const name = propertyName(member.name);
    if (!name) return [];
    return [
      {
        name,
        type: typeText(member.type, source),
        required: !member.questionToken,
      },
    ];
  });
}

function resolveTypeMembers(
  typeNode: ts.TypeNode | undefined,
  source: ts.SourceFile,
  declarations: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
): ts.NodeArray<ts.TypeElement> | undefined {
  if (!typeNode) return undefined;
  if (ts.isTypeLiteralNode(typeNode)) return typeNode.members;
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const declaration = declarations.get(typeNode.typeName.text);
    if (declaration && ts.isInterfaceDeclaration(declaration)) return declaration.members;
    if (declaration && ts.isTypeAliasDeclaration(declaration)) {
      return resolveTypeMembers(declaration.type, source, declarations);
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
      ? [{ name, payload: member.type.getText() }]
      : [{ name }];
  }
  if (!ts.isCallSignatureDeclaration(member)) return [];
  const firstParameter = member.parameters[0];
  const type = firstParameter?.type;
  if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return [{ name: type.literal.text }];
  }
  return [];
}

function parseScript(script: string, fileName: string): ScriptFacts {
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
  >();
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
        const members = resolveTypeMembers(node.typeArguments?.[0], source, declarations);
        if (members) props = propsFromMembers(members, source);
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
            source,
            declarations,
          );
          if (members) props = propsFromMembers(members, source);
          const defaults = collectDefaults(node, source);
          props = props.map((prop) => {
            const defaultValue = defaults.get(prop.name);
            return defaultValue === undefined
              ? prop
              : { ...prop, required: false, defaultValue };
          });
        }
      } else if (macro === "defineEmits") {
        const members = resolveTypeMembers(node.typeArguments?.[0], source, declarations);
        if (members) events.push(...members.flatMap(eventNameFromMember));
      } else if (macro === "defineSlots") {
        const members = resolveTypeMembers(node.typeArguments?.[0], source, declarations);
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
  const parts = componentRoot(relativePath).map((part) => part.toLowerCase());
  const first = parts[0];
  if (first && ["ui", "shared", "common", "layout"].includes(first)) {
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

function testsFor(
  componentPath: string,
  componentName: string,
  testPaths: string[],
): string[] {
  const rootParts = componentRoot(componentPath);
  const relativeStem = slash(
    [...rootParts.slice(0, -1), path.basename(rootParts.at(-1) ?? "", ".vue")]
      .join("/"),
  ).toLowerCase();
  const exact = testPaths.filter((testPath) => {
    const normalized = `/${slash(testPath).toLowerCase()}`;
    return (
      normalized.includes(`/components/${relativeStem}.test.`) ||
      normalized.includes(`/components/${relativeStem}.spec.`)
    );
  });
  if (exact.length > 0) return exact;
  const sourceStem = path.basename(componentPath, path.extname(componentPath)).toLowerCase();
  const candidates = new Set([sourceStem, componentName.toLowerCase()]);
  return testPaths.filter((testPath) => {
    const base = path.basename(testPath).toLowerCase();
    return [...candidates].some(
      (candidate) =>
        base.startsWith(`${candidate}.`) ||
        slash(testPath).toLowerCase().includes(`/${candidate}/`),
    );
  });
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

    return Promise.all(
      files.sort().map(async (sourcePath) => {
        const source = await readFile(sourcePath, "utf8");
        const relativePath = slash(path.relative(rootPath, sourcePath));
        const parsed = parseSfc(source, { filename: sourcePath });
        const script =
          parsed.descriptor.scriptSetup?.content ??
          parsed.descriptor.script?.content ??
          "";
        const scriptFacts = parseScript(script, sourcePath);
        const templateFacts = parseTemplate(parsed.descriptor.template?.content ?? "");
        const name = pascalCase(path.basename(sourcePath, ".vue"));
        const effectiveName = effectiveNuxtName(relativePath) || name;
        const classification = classify(relativePath);
        const componentTests = testsFor(relativePath, name, testPaths);
        return {
          id: componentId("vue", relativePath, name),
          framework: "vue",
          name,
          effectiveName,
          sourcePath,
          relativePath,
          ...classification,
          exported: true,
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
