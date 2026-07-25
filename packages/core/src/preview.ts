import type {
  ComponentGraph,
  ComponentNode,
  ComponentPlaygroundContract,
  ComponentProp,
  DesignToken,
  PreviewControl,
  PreviewScenario,
  PreviewStyleEnvironment,
} from "./types.js";

function titleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function unionOptions(type: string): string[] {
  const options = [...type.matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  return [...new Set(options.filter((option): option is string => Boolean(option)))];
}

function isAction(prop: ComponentProp): boolean {
  return (
    /^on[A-Z]/.test(prop.name) ||
    /=>|\bFunction\b|\(\s*\)\s*=>/.test(prop.type)
  );
}

function defaultText(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "classname" || normalized.endsWith("classname")) return "";
  if (normalized.includes("title") || normalized.includes("heading")) {
    return "A component worth reusing";
  }
  if (normalized.includes("description") || normalized.includes("message")) {
    return "Explore this state, adjust its contract, and save the result.";
  }
  if (normalized.includes("label")) return "Example label";
  if (normalized.includes("name")) return "Atlas specimen";
  if (normalized.includes("children") || normalized.includes("content")) {
    return "Preview content";
  }
  if (normalized.includes("url") || normalized.includes("href")) return "#";
  return "";
}

function parseDefault(prop: ComponentProp): unknown {
  if (prop.defaultValue !== undefined) {
    const value = prop.defaultValue.trim();
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    const quoted = value.match(/^["'](.*)["']$/);
    if (quoted?.[1] !== undefined) return quoted[1];
  }
  const options = unionOptions(prop.type);
  if (options[0] !== undefined) return options[0];
  if (/\bboolean\b/.test(prop.type)) {
    return prop.required || /open|show|visible|active|enabled/i.test(prop.name);
  }
  if (/\bnumber\b/.test(prop.type)) {
    return /day/i.test(prop.name) ? 15 : 0;
  }
  if (/\bstring\b/.test(prop.type) || prop.type === "unknown") {
    return defaultText(prop.name);
  }
  if (prop.type.includes("[]")) return [];
  return undefined;
}

function controlFor(prop: ComponentProp): PreviewControl {
  const options = unionOptions(prop.type);
  let kind: PreviewControl["kind"] = "json";
  if (isAction(prop)) kind = "action";
  else if (prop.name === "children") kind = "text";
  else if (options.length > 0) kind = "select";
  else if (/\bboolean\b/.test(prop.type)) kind = "boolean";
  else if (/\bnumber\b/.test(prop.type)) kind = "number";
  else if (
    /color|colour|background|foreground|accent/i.test(prop.name) &&
    /\bstring\b/.test(prop.type)
  ) {
    kind = "color";
  } else if (/\bstring\b/.test(prop.type) || prop.type === "unknown") {
    kind = "text";
  }
  const defaultValue =
    kind === "action"
      ? undefined
      : prop.name === "children"
        ? defaultText(prop.name)
        : parseDefault(prop);
  return {
    name: prop.name,
    label: titleCase(prop.name),
    kind,
    type: prop.type,
    required: prop.required,
    options,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

function relevantTokens(
  component: ComponentNode,
  tokens: DesignToken[],
): DesignToken[] {
  const referenced = new Set(
    component.classTokens
      .flatMap((className) => [...className.matchAll(/var\(--([^)]+)\)/g)])
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name)),
  );
  const exact = tokens.filter((token) => referenced.has(token.name));
  if (exact.length >= 4) return exact.slice(0, 24);
  const semantic = tokens.filter(
    (token) =>
      token.kind === "color" ||
      token.kind === "radius" ||
      token.kind === "shadow",
  );
  return [...new Map([...exact, ...semantic].map((token) => [token.name, token])).values()]
    .slice(0, 24);
}

export function inferPreviewControls(component: ComponentNode): PreviewControl[] {
  const controls = component.props.map(controlFor);
  const names = new Set(controls.map((control) => control.name));
  for (const event of component.events) {
    const listenerName = `on${event.name
      .replace(/(^|[-_:])(\w)/g, (_, __, character: string) =>
        character.toUpperCase(),
      )}`;
    if (names.has(listenerName)) continue;
    controls.push({
      name: listenerName,
      label: `${titleCase(event.name)} Event`,
      kind: "action",
      type: event.payload ?? "event",
      required: false,
      options: [],
    });
  }
  return controls;
}

export function initialPreviewProps(
  controls: PreviewControl[],
): Record<string, unknown> {
  return Object.fromEntries(
    controls
      .filter(
        (control) =>
          control.kind !== "action" && control.defaultValue !== undefined,
      )
      .map((control) => [control.name, control.defaultValue]),
  );
}

export function buildPlaygroundContract(
  graph: ComponentGraph,
  component: ComponentNode,
  scenarios: PreviewScenario[] = [],
  styling: PreviewStyleEnvironment = {
    pipeline: "unknown",
    entryPoints: [],
    sourceRegistration: "not-applicable",
  },
): ComponentPlaygroundContract {
  const renderable = component.framework === "vue" || component.exported;
  return {
    component,
    controls: inferPreviewControls(component),
    tokens: relevantTokens(component, graph.tokens),
    scenarios: scenarios.filter(
      (scenario) => scenario.componentId === component.id,
    ),
    styling,
    renderable,
    ...(!renderable
      ? {
          renderabilityReason:
            "This React component is file-local. Extract or export it before isolated rendering.",
        }
      : {}),
  };
}
