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
  type AdapterScanResult,
  type ComponentEvent,
  type ComponentImportBinding,
  type ComponentNode,
  type ComponentProp,
  type ComponentRenderReference,
  type ComponentSlotContract,
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
  importBindings: ComponentImportBinding[];
  logicDependencies: string[];
}

interface TemplateFacts {
  renderedNames: string[];
  renderReferences: ComponentRenderReference[];
  classTokens: string[];
  slots: string[];
  slotContracts: ComponentSlotContract[];
  errors: string[];
}

interface TestFacts {
  path: string;
  resolvedImports: Set<string>;
  importedNames: Set<string>;
  mountedNames: Set<string>;
}

const SOURCE_PATTERNS = [
  "*.vue",
  "app/**/*.vue",
  "components/**/*.vue",
  "layouts/**/*.vue",
  "pages/**/*.vue",
  "src/**/*.vue",
];
const TEST_PATTERNS = [
  "src/**/*.{test,spec}.{ts,tsx,js,jsx}",
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

function scriptKind(fileName: string): ts.ScriptKind {
  return /\.(?:tsx|jsx)$/iu.test(fileName)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

function scriptDiagnosticMessages(script: string, fileName: string): string[] {
  if (!script.trim()) return [];
  const source = ts.createSourceFile(
    fileName,
    script,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const diagnostics = (
    source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  return diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  );
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property.name) === name);
}

function runtimeType(node: ts.Expression | undefined, source: ts.SourceFile): string {
  if (!node) return "unknown";
  if (ts.isIdentifier(node)) {
    return (
      {
        String: "string",
        Number: "number",
        Boolean: "boolean",
        Array: "unknown[]",
        Object: "Record<string, unknown>",
        Function: "Function",
      }[node.text] ?? node.text
    );
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => runtimeType(element, source)).join(" | ");
  }
  return node.getText(source);
}

function runtimeProps(
  node: ts.Expression | undefined,
  source: ts.SourceFile,
): ComponentProp[] {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      ts.isStringLiteral(element)
        ? [{ name: element.text, type: "unknown", required: false }]
        : [],
    );
  }
  if (!ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return [];
    }
    const name = propertyName(property.name);
    if (!name) return [];
    const initializer = ts.isPropertyAssignment(property)
      ? property.initializer
      : property.name;
    if (!ts.isObjectLiteralExpression(initializer)) {
      return [{
        name,
        type: runtimeType(initializer, source),
        required: false,
      }];
    }
    const typeProperty = objectProperty(initializer, "type");
    const requiredProperty = objectProperty(initializer, "required");
    const defaultProperty = objectProperty(initializer, "default");
    const typeExpression =
      typeProperty && ts.isPropertyAssignment(typeProperty)
        ? typeProperty.initializer
        : undefined;
    const required =
      requiredProperty &&
      ts.isPropertyAssignment(requiredProperty) &&
      requiredProperty.initializer.kind === ts.SyntaxKind.TrueKeyword;
    const defaultValue =
      defaultProperty && ts.isPropertyAssignment(defaultProperty)
        ? defaultProperty.initializer.getText(source)
        : undefined;
    return [{
      name,
      type: runtimeType(typeExpression, source),
      required: Boolean(required),
      ...(defaultValue === undefined ? {} : { defaultValue }),
    }];
  });
}

function runtimeEvents(
  node: ts.Expression | undefined,
): ComponentEvent[] {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) =>
      ts.isStringLiteral(element) ? [{ name: element.text }] : [],
    );
  }
  if (!ts.isObjectLiteralExpression(node)) return [];
  return node.properties.flatMap((property) => {
    const name = propertyName(property.name);
    return name ? [{ name }] : [];
  });
}

function componentOptions(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (
    ts.isCallExpression(expression) &&
    expression.arguments[0] &&
    ts.isObjectLiteralExpression(expression.arguments[0])
  ) {
    const callName = expression.expression.getText();
    if (callName === "defineComponent" || callName === "Vue.extend") {
      return expression.arguments[0];
    }
  }
  return undefined;
}

function mergeScriptFacts(left: ScriptFacts, right: ScriptFacts): ScriptFacts {
  return {
    props: [...new Map([...left.props, ...right.props].map((prop) => [prop.name, prop])).values()],
    events: [
      ...new Map([...left.events, ...right.events].map((event) => [event.name, event])).values(),
    ],
    slots: [...new Set([...left.slots, ...right.slots])],
    models: [...new Set([...left.models, ...right.models])],
    imports: [...new Set([...left.imports, ...right.imports])],
    importBindings: [
      ...new Map(
        [...left.importBindings, ...right.importBindings].map((binding) => [
          `${binding.local}:${binding.specifier}`,
          binding,
        ]),
      ).values(),
    ],
    logicDependencies: [
      ...new Set([...left.logicDependencies, ...right.logicDependencies]),
    ],
  };
}

function parseScript(
  script: string,
  fileName: string,
  importedDeclarations = new Map<
    string,
    ts.InterfaceDeclaration | ts.TypeAliasDeclaration
  >(),
  resolvedImportBindings: ComponentImportBinding[] = [],
): ScriptFacts {
  if (!script.trim()) {
    return {
      props: [],
      events: [],
      slots: [],
      models: [],
      imports: [],
      importBindings: [],
      logicDependencies: [],
    };
  }
  const source = ts.createSourceFile(
    fileName,
    script,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
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
  const logicDependencies: string[] = [];

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
        else props = runtimeProps(node.arguments[0], source);
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
        else events.push(...runtimeEvents(node.arguments[0]));
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
      } else if (/^use[A-Z0-9]/u.test(macro)) {
        logicDependencies.push(macro);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const statement of source.statements) {
    if (!ts.isExportAssignment(statement)) continue;
    const options = componentOptions(statement.expression);
    if (!options) continue;
    const propsOption = objectProperty(options, "props");
    if (propsOption && ts.isPropertyAssignment(propsOption)) {
      props = [
        ...new Map(
          [
            ...props,
            ...runtimeProps(propsOption.initializer, source),
          ].map((prop) => [prop.name, prop]),
        ).values(),
      ];
    }
    const emitsOption = objectProperty(options, "emits");
    if (emitsOption && ts.isPropertyAssignment(emitsOption)) {
      events.push(...runtimeEvents(emitsOption.initializer));
    }
    const modelOption = objectProperty(options, "model");
    if (
      modelOption &&
      ts.isPropertyAssignment(modelOption) &&
      ts.isObjectLiteralExpression(modelOption.initializer)
    ) {
      const prop = objectProperty(modelOption.initializer, "prop");
      const event = objectProperty(modelOption.initializer, "event");
      const propName =
        prop &&
        ts.isPropertyAssignment(prop) &&
        ts.isStringLiteral(prop.initializer)
          ? prop.initializer.text
          : "value";
      models.push(propName);
      if (
        event &&
        ts.isPropertyAssignment(event) &&
        ts.isStringLiteral(event.initializer)
      ) {
        events.push({ name: event.initializer.text });
      }
    }
    const mixinsOption = objectProperty(options, "mixins");
    if (
      mixinsOption &&
      ts.isPropertyAssignment(mixinsOption) &&
      ts.isArrayLiteralExpression(mixinsOption.initializer)
    ) {
      logicDependencies.push(
        ...mixinsOption.initializer.elements
          .filter(ts.isIdentifier)
          .map((element) => element.text),
      );
    }
  }
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
    importBindings: resolvedImportBindings,
    logicDependencies: [...new Set(logicDependencies)],
  };
}

function runtimeTag(tag: string): string {
  return tag.includes("-") ? pascalCase(tag) : tag;
}

function parseTemplate(template: string): TemplateFacts {
  if (!template.trim()) {
    return {
      renderedNames: [],
      renderReferences: [],
      classTokens: [],
      slots: [],
      slotContracts: [],
      errors: [],
    };
  }
  let root: RootNode;
  const errors: string[] = [];
  try {
    root = baseParse(template, {
      onError(error) {
        errors.push(error.message);
      },
    });
  } catch (error) {
    return {
      renderedNames: [],
      renderReferences: [],
      classTokens: [],
      slots: [],
      slotContracts: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const renderedNames: string[] = [];
  const renderReferences: ComponentRenderReference[] = [];
  const classTokens: string[] = [];
  const slots: string[] = [];
  const slotContracts: ComponentSlotContract[] = [];

  const visit = (node: RootNode | TemplateChildNode): void => {
    if (node.type === NodeTypes.ELEMENT) {
      if (/^[A-Z]/.test(node.tag) || node.tag.includes("-")) {
        const name = runtimeTag(node.tag);
        renderedNames.push(name);
        renderReferences.push({ name, importedLocal: name });
      }
      if (node.tag === "slot") {
        const nameAttribute = node.props.find(
          (prop) =>
            prop.type === NodeTypes.ATTRIBUTE &&
            prop.name === "name" &&
            prop.value,
        );
        const slotName =
          nameAttribute && nameAttribute.type === NodeTypes.ATTRIBUTE
            ? (nameAttribute.value?.content ?? "default")
            : "default";
        slots.push(slotName);
        const slotProps = node.props.flatMap((property) => {
          if (
            property.type === NodeTypes.ATTRIBUTE &&
            property.name !== "name"
          ) {
            return [property.name];
          }
          if (
            property.type === NodeTypes.DIRECTIVE &&
            property.name === "bind" &&
            property.arg &&
            property.arg.type === NodeTypes.SIMPLE_EXPRESSION &&
            property.arg.isStatic
          ) {
            return [property.arg.content];
          }
          return [];
        });
        slotContracts.push({ name: slotName, props: [...new Set(slotProps)] });
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
    renderReferences: [
      ...new Map(renderReferences.map((reference) => [reference.name, reference])).values(),
    ],
    classTokens: [...new Set(classTokens)],
    slots: [...new Set(slots)],
    slotContracts: [
      ...new Map(slotContracts.map((contract) => [contract.name, contract])).values(),
    ],
    errors,
  };
}

function componentRoot(relativePath: string): string[] {
  const parts = slash(relativePath).split("/");
  const index = parts.lastIndexOf("components");
  return index >= 0 ? parts.slice(index + 1) : parts;
}

function effectiveNuxtName(relativePath: string): string {
  if (/^(?:(?:src|app)\/)?app\.vue$/i.test(slash(relativePath))) return "App";
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
  if (/^(?:src\/)?app\.vue$/i.test(slash(relativePath))) {
    return { visibility: "private" };
  }
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

async function importBindings(
  script: string,
  sourcePath: string,
  rootPath: string,
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
    const resolvedPath = await resolveSourceImport(specifier, sourcePath, rootPath);
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

function fileRoutePath(relativePath: string, directory: "pages" | "layouts"): string {
  const normalized = slash(relativePath);
  const marker = `/${directory}/`;
  const markerIndex = `/${normalized}`.lastIndexOf(marker);
  const relative =
    markerIndex >= 0
      ? `/${normalized}`.slice(markerIndex + marker.length)
      : normalized;
  const withoutExtension = relative.replace(/\.(?:vue|jsx?|tsx?)$/iu, "");
  const segments = withoutExtension
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.+\)$/u.test(segment))
    .map((segment) => (segment === "index" ? "" : segment));
  const route = `/${segments.filter(Boolean).join("/")}`;
  return route === "" ? "/" : route;
}

async function vueRouterRoutes(rootPath: string): Promise<Map<string, string>> {
  const files = await fg(
    [
      "router/**/*.{ts,js}",
      "src/router/**/*.{ts,js}",
      "src/**/*router*.{ts,js}",
    ],
    {
      cwd: rootPath,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: ["**/node_modules/**"],
    },
  );
  const routes = new Map<string, string>();
  for (const filePath of files) {
    const text = await readFile(filePath, "utf8");
    const source = ts.createSourceFile(
      filePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const importedPaths = new Map<string, string>();
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const resolvedPath = await resolveSourceImport(
        statement.moduleSpecifier.text,
        filePath,
        rootPath,
      );
      if (!resolvedPath) continue;
      const clause = statement.importClause;
      if (clause?.name) importedPaths.set(clause.name.text, path.resolve(resolvedPath));
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          importedPaths.set(binding.name.text, path.resolve(resolvedPath));
        }
      }
    }
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const pathProperty = objectProperty(node, "path");
        const componentProperty = objectProperty(node, "component");
        if (
          pathProperty &&
          ts.isPropertyAssignment(pathProperty) &&
          ts.isStringLiteral(pathProperty.initializer) &&
          componentProperty &&
          ts.isPropertyAssignment(componentProperty) &&
          ts.isIdentifier(componentProperty.initializer)
        ) {
          const resolved = importedPaths.get(componentProperty.initializer.text);
          if (resolved) routes.set(resolved.toLowerCase(), pathProperty.initializer.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return routes;
}

async function isNuxtProject(rootPath: string, options: ScanOptions): Promise<boolean> {
  if (options.packageProfile) {
    return options.packageProfile.metaFramework === "nuxt";
  }
  try {
    const manifest = JSON.parse(
      await readFile(path.join(rootPath, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(manifest.dependencies?.nuxt || manifest.devDependencies?.nuxt);
  } catch {
    return false;
  }
}

export class VueAdapter implements FrameworkAdapter {
  readonly framework = "vue" as const;

  async scan(options: ScanOptions): Promise<ComponentNode[]> {
    return (await this.scanDetailed(options)).components;
  }

  async scanDetailed(options: ScanOptions): Promise<AdapterScanResult> {
    const rootPath = path.resolve(options.rootPath);
    const nuxt = await isNuxtProject(rootPath, options);
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
    const routerRoutes = nuxt ? new Map<string, string>() : await vueRouterRoutes(rootPath);
    const diagnostics: AdapterScanResult["coverage"]["diagnostics"] = [];
    const components: ComponentNode[] = [];
    let parsedFiles = 0;
    let skippedFiles = 0;
    let errorFiles = 0;

    for (const sourcePath of files.sort()) {
      try {
        const source = await readFile(sourcePath, "utf8");
        const relativePath = slash(path.relative(rootPath, sourcePath));
        const parsed = parseSfc(source, { filename: sourcePath });
        const supportedScriptLanguages = new Set(["js", "jsx", "ts", "tsx"]);
        const normalLanguage = parsed.descriptor.script?.lang?.toLowerCase() ?? "js";
        const setupLanguage =
          parsed.descriptor.scriptSetup?.lang?.toLowerCase() ?? "js";
        const unsupportedBlocks = [
          ...(parsed.descriptor.template?.lang &&
          parsed.descriptor.template.lang.toLowerCase() !== "html"
            ? [`template lang="${parsed.descriptor.template.lang}"`]
            : []),
          ...(parsed.descriptor.script?.src
            ? ["external script src"]
            : !supportedScriptLanguages.has(normalLanguage)
              ? [`script lang="${normalLanguage}"`]
              : []),
          ...(parsed.descriptor.scriptSetup?.src
            ? ["external script setup src"]
            : !supportedScriptLanguages.has(setupLanguage)
              ? [`script setup lang="${setupLanguage}"`]
              : []),
        ];
        const normalScript =
          parsed.descriptor.script?.src ||
          !supportedScriptLanguages.has(normalLanguage)
            ? ""
            : (parsed.descriptor.script?.content ?? "");
        const setupScript =
          parsed.descriptor.scriptSetup?.src ||
          !supportedScriptLanguages.has(setupLanguage)
            ? ""
            : (parsed.descriptor.scriptSetup?.content ?? "");
        const normalScriptPath = `${sourcePath}.${
          normalLanguage
        }`;
        const setupScriptPath = `${sourcePath}.${
          setupLanguage
        }`;
        const scriptDiagnostics = [
          ...scriptDiagnosticMessages(normalScript, normalScriptPath),
          ...scriptDiagnosticMessages(setupScript, setupScriptPath),
        ];
        let fileHasParseError =
          parsed.errors.length > 0 || scriptDiagnostics.length > 0;
        if (fileHasParseError) {
          errorFiles += 1;
          diagnostics.push({
            severity: "error",
            code:
              parsed.errors.length > 0
                ? "vue-sfc-parse"
                : "vue-script-syntax",
            message: [
              ...parsed.errors.map(String),
              ...scriptDiagnostics,
            ].join("; ").slice(0, 500),
            path: relativePath,
            framework: "vue",
          });
        }
        const combinedScript = `${normalScript}\n${setupScript}`;
        const externalDeclarations = await importedTypeDeclarations(
          combinedScript,
          `${sourcePath}.ts`,
          rootPath,
        );
        const normalFacts = parseScript(
          normalScript,
          normalScriptPath,
          externalDeclarations,
          await importBindings(normalScript, normalScriptPath, rootPath),
        );
        const setupFacts = parseScript(
          setupScript,
          setupScriptPath,
          externalDeclarations,
          await importBindings(setupScript, setupScriptPath, rootPath),
        );
        const scriptFacts = mergeScriptFacts(normalFacts, setupFacts);
        const templateFacts = parseTemplate(
          parsed.descriptor.template?.lang &&
            parsed.descriptor.template.lang.toLowerCase() !== "html"
            ? ""
            : (parsed.descriptor.template?.content ?? ""),
        );
        if (unsupportedBlocks.length > 0) {
          diagnostics.push({
            severity: "warning",
            code: "vue-unsupported-sfc-block",
            message: `Indexed the supported SFC sections, but skipped ${unsupportedBlocks.join(", ")}.`,
            path: relativePath,
            framework: "vue",
          });
        }
        if (templateFacts.errors.length > 0) {
          if (!fileHasParseError) errorFiles += 1;
          fileHasParseError = true;
          diagnostics.push({
            severity: "error",
            code: "vue-template-syntax",
            message: templateFacts.errors.join("; ").slice(0, 500),
            path: relativePath,
            framework: "vue",
          });
        }
        const baseName = path.basename(sourcePath, ".vue").replace(/\.(?:client|server)$/iu, "");
        const name = pascalCase(baseName);
        const effectiveName = nuxt
          ? (effectiveNuxtName(relativePath.replace(/\.(?:client|server)\.vue$/iu, ".vue")) || name)
          : name;
        const classification = classify(relativePath);
        const routerPath = routerRoutes.get(path.resolve(sourcePath).toLowerCase());
        const isNuxtPage = nuxt && /(^|\/)pages\//iu.test(relativePath);
        const isNuxtLayout = nuxt && /(^|\/)layouts\//iu.test(relativePath);
        const isNuxtShell =
          nuxt &&
          /^(?:(?:app|src)\/)?(?:app|error)\.vue$/iu.test(relativePath);
        const kind = isNuxtPage || routerPath
          ? ("route" as const)
          : isNuxtLayout
            ? ("layout" as const)
            : isNuxtShell
              ? ("special" as const)
              : ("component" as const);
        const routePath =
          routerPath ??
          (isNuxtPage
            ? fileRoutePath(relativePath, "pages")
            : isNuxtLayout
              ? baseName.toLowerCase() === "default"
                ? "/"
                : undefined
              : undefined);
        const role = isNuxtShell
          ? /error\.vue$/iu.test(relativePath)
            ? "error"
            : "app-shell"
          : undefined;
        const runtime = /\.client\.vue$/iu.test(relativePath)
          ? ("client" as const)
          : /\.server\.vue$/iu.test(relativePath)
            ? ("server" as const)
            : ("universal" as const);
        const componentTests = testsFor(
          relativePath,
          name,
          effectiveName,
          testFacts,
        );
        components.push({
          id: componentId("vue", relativePath, name),
          framework: "vue",
          kind,
          ...(role ? { role } : {}),
          runtime,
          ...(routePath ? { routePath } : {}),
          name,
          effectiveName,
          sourcePath,
          relativePath,
          ...classification,
          exported: kind === "component",
          exportName: "default",
          location: { line: 1, column: 1 },
          props: scriptFacts.props,
          events: scriptFacts.events,
          slots: [...new Set([...scriptFacts.slots, ...templateFacts.slots])],
          models: scriptFacts.models,
          renderedNames: templateFacts.renderedNames,
          renderReferences: templateFacts.renderReferences,
          imports: scriptFacts.imports,
          importBindings: scriptFacts.importBindings,
          logicDependencies: scriptFacts.logicDependencies,
          slotContracts: templateFacts.slotContracts,
          testPaths: componentTests,
          classTokens: templateFacts.classTokens,
          sourceHash: hashText(source),
        } satisfies ComponentNode);
        if (!fileHasParseError) {
          if (unsupportedBlocks.length > 0) skippedFiles += 1;
          else parsedFiles += 1;
        }
      } catch (error) {
        errorFiles += 1;
        diagnostics.push({
          severity: "error",
          code: "vue-file-parse",
          message: error instanceof Error ? error.message : String(error),
          path: slash(path.relative(rootPath, sourcePath)),
          framework: "vue",
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
          vue: {
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

export async function scanVueProject(options: ScanOptions): Promise<ComponentNode[]> {
  return new VueAdapter().scan(options);
}

export async function scanVueProjectDetailed(
  options: ScanOptions,
): Promise<AdapterScanResult> {
  return new VueAdapter().scanDetailed(options);
}
