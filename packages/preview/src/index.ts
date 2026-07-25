import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import vue from "@vitejs/plugin-vue";
import { slash, type Framework } from "@component-atlas/core";
import {
  createServer,
  type Alias,
  type Plugin,
  type ViteDevServer,
} from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { styleFidelityPlugin } from "./style-fidelity.js";

export interface PreviewServerOptions {
  rootPath: string;
  framework: Framework;
  port?: number;
  viewerOrigin?: string;
}

export interface PreviewServer {
  origin: string;
  port: number;
  close(): Promise<void>;
}

const VIRTUAL_ENTRY = "virtual:component-atlas-preview";
const RESOLVED_ENTRY = `\0${VIRTUAL_ENTRY}`;

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function globalStyles(
  rootPath: string,
  framework: Framework,
): Promise<string[]> {
  const candidates =
    framework === "vue"
      ? [
          "app/assets/css/main.css",
          "app/assets/css/app.css",
          "assets/css/main.css",
          "assets/css/app.css",
          "styles/main.css",
        ]
      : [
          "src/app/globals.css",
          "app/globals.css",
          "src/styles/globals.css",
          "styles/globals.css",
        ];
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const filePath = path.join(rootPath, candidate);
    if (await exists(filePath)) resolved.push(slash(filePath));
  }
  return resolved;
}

function resolveFrom(rootPath: string, specifier: string): string | undefined {
  const projectRequire = createRequire(path.join(rootPath, "package.json"));
  const localRequire = createRequire(import.meta.url);
  try {
    return projectRequire.resolve(specifier);
  } catch {
    try {
      return localRequire.resolve(specifier);
    } catch {
      return undefined;
    }
  }
}

function runtimeAliases(rootPath: string, framework: Framework): Alias[] {
  const aliases: Alias[] = [];
  const add = (specifier: string): void => {
    const replacement = resolveFrom(rootPath, specifier);
    if (replacement) aliases.push({ find: specifier, replacement });
  };
  if (framework === "react") {
    for (const specifier of [
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "react-dom/client",
      "react-dom",
      "react",
    ]) {
      add(specifier);
    }
  } else {
    add("vue");
    const appRoot = path.join(rootPath, "app");
    aliases.push(
      { find: "~", replacement: appRoot },
      { find: "@", replacement: appRoot },
      { find: "~~", replacement: rootPath },
      { find: "@@", replacement: rootPath },
    );
  }
  return aliases;
}

function html(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Atlas specimen</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      html, body, #atlas-preview-root { width: 100%; min-height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        padding: 32px;
        background:
          radial-gradient(circle at 50% 0%, rgba(119, 138, 255, .13), transparent 40%),
          #11161d;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      #atlas-preview-root { display: grid; place-items: center; }
      .atlas-preview-error {
        position: fixed;
        z-index: 10;
        top: 50%;
        left: 50%;
        width: min(560px, 100%);
        padding: 20px;
        border: 1px solid rgba(255, 126, 109, .42);
        border-radius: 14px;
        background: rgba(58, 26, 25, .88);
        color: #ffd8d2;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .25);
        transform: translate(-50%, -50%);
      }
      .atlas-preview-error strong { display: block; margin-bottom: 8px; }
      .atlas-preview-error code {
        display: block;
        max-height: 280px;
        overflow: auto;
        color: #ffb4a8;
        font-size: 12px;
        line-height: 1.5;
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="atlas-preview-root"></div>
    <script type="module" src="/@id/virtual:component-atlas-preview"></script>
  </body>
</html>`;
}

function sharedRuntime(viewerOrigin: string): string {
  return `
const params = new URL(location.href).searchParams;
const componentPath = params.get("component");
const exportName = params.get("export") || "default";
const mount = document.getElementById("atlas-preview-root");
const hostOrigin = ${JSON.stringify(viewerOrigin)};
let previewState = { props: {}, tokens: {}, actionNames: [], background: "#11161d" };
let appliedTokenNames = new Set();
let renderFailed = false;

function send(type, payload = {}) {
  parent.postMessage({ source: "component-atlas-preview", type, ...payload }, hostOrigin);
}

function applyEnvironment() {
  document.getElementById("atlas-preview-runtime-error")?.remove();
  document.body.style.background = previewState.background || "#11161d";
  const nextTokenNames = new Set(Object.keys(previewState.tokens || {}));
  for (const name of appliedTokenNames) {
    if (!nextTokenNames.has(name)) {
      document.documentElement.style.removeProperty("--" + name);
    }
  }
  for (const [name, value] of Object.entries(previewState.tokens || {})) {
    document.documentElement.style.setProperty("--" + name, String(value));
  }
  appliedTokenNames = nextTokenNames;
}

function serializeActionArgs(values) {
  return values.map((value) => {
    if (
      value === null ||
      ["string", "number", "boolean", "undefined"].includes(typeof value)
    ) return value;
    if (value?.target) {
      return {
        type: value.type,
        value: value.target.value,
        checked: value.target.checked,
      };
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return "[" + (value?.constructor?.name || typeof value) + "]";
    }
  });
}

function reportError(error) {
  renderFailed = true;
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof Error && error.stack ? error.stack : message;
  let errorNode = document.getElementById("atlas-preview-runtime-error");
  if (!errorNode) {
    errorNode = document.createElement("div");
    errorNode.id = "atlas-preview-runtime-error";
    errorNode.className = "atlas-preview-error";
    errorNode.innerHTML = '<strong>Specimen could not render</strong><code></code>';
    document.body.append(errorNode);
  }
  errorNode.querySelector("code").textContent = details;
  send("error", { message, details });
}

window.addEventListener("error", (event) => reportError(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
`;
}

function reactRuntime(styles: string[], viewerOrigin: string): string {
  const styleImports = styles
    .map((stylePath) => `await import(${JSON.stringify(`/@fs/${stylePath}`)});`)
    .join("\n");
  return `
${sharedRuntime(viewerOrigin)}

let root;
let Component;
let React;
let createRoot;
let PreviewBoundary;

function renderPreview() {
  if (!Component || !root) return;
  applyEnvironment();
  const props = { ...(previewState.props || {}) };
  for (const name of previewState.actionNames || []) {
    props[name] = (...args) =>
      send("action", { name, args: serializeActionArgs(args) });
  }
  root.render(
    React.createElement(
      PreviewBoundary,
      { key: JSON.stringify(previewState.props) },
      React.createElement(Component, props)
    )
  );
}

window.addEventListener("message", (event) => {
  if (
    event.origin !== hostOrigin ||
    event.data?.source !== "component-atlas-host"
  ) return;
  renderFailed = false;
  previewState = { ...previewState, ...event.data.state };
  renderPreview();
  queueMicrotask(() => send("rendered"));
});

try {
  const RefreshRuntimeModule = await import("/@react-refresh");
  const RefreshRuntime = RefreshRuntimeModule.default || RefreshRuntimeModule;
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  const ReactModule = await import("react");
  React = ReactModule.default || ReactModule;
  ({ createRoot } = await import("react-dom/client"));
  ${styleImports}
  PreviewBoundary = class extends React.Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    componentDidCatch(error) {
      renderFailed = true;
      send("error", { message: error.message });
    }
    render() {
      if (this.state.error) {
        return React.createElement("div", { className: "atlas-preview-error" },
          React.createElement("strong", null, "Specimen could not render"),
          React.createElement("code", null, this.state.error.message)
        );
      }
      return this.props.children;
    }
  };
  if (!componentPath) throw new Error("No component source path was provided.");
  const moduleUrl = "/@fs/" + componentPath.replaceAll("\\\\", "/");
  const componentModule = await import(/* @vite-ignore */ moduleUrl);
  Component = componentModule[exportName] || componentModule.default;
  if (!Component) throw new Error('Export "' + exportName + '" was not found.');
  root = createRoot(mount);
  renderPreview();
  send("ready");
} catch (error) {
  reportError(error);
}
`;
}

function vueRuntime(styles: string[], viewerOrigin: string): string {
  const styleImports = styles
    .map((stylePath) => `await import(${JSON.stringify(`/@fs/${stylePath}`)});`)
    .join("\n");
  return `
${sharedRuntime(viewerOrigin)}

let app;
let Component;
let Vue;
let propsState;

function syncState() {
  applyEnvironment();
  for (const key of Object.keys(propsState)) delete propsState[key];
  Object.assign(propsState, previewState.props || {});
  for (const name of previewState.actionNames || []) {
    propsState[name] = (...args) =>
      send("action", { name, args: serializeActionArgs(args) });
  }
}

window.addEventListener("message", (event) => {
  if (
    event.origin !== hostOrigin ||
    event.data?.source !== "component-atlas-host"
  ) return;
  renderFailed = false;
  previewState = { ...previewState, ...event.data.state };
  syncState();
  Vue.nextTick(() => {
    if (!renderFailed) send("rendered");
  });
});

try {
  Vue = await import("vue");
  Object.assign(globalThis, Vue);
  propsState = Vue.reactive({});
  ${styleImports}
  if (!componentPath) throw new Error("No component source path was provided.");
  const moduleUrl = "/@fs/" + componentPath.replaceAll("\\\\", "/");
  const componentModule = await import(/* @vite-ignore */ moduleUrl);
  Component = componentModule.default || componentModule[exportName];
  if (!Component) throw new Error('Vue component export was not found.');
  syncState();
  app = Vue.createApp({
    setup() {
      return () => Vue.h(Component, { ...propsState }, {
        default: () => previewState.props?.$slot || "Preview content"
      });
    }
  });
  app.config.errorHandler = (error) => reportError(error);
  app.mount(mount);
  send("ready");
} catch (error) {
  reportError(error);
}
`;
}

function atlasPlugin(
  framework: Framework,
  styles: string[],
  viewerOrigin: string,
): Plugin {
  return {
    name: "component-atlas-preview",
    enforce: "pre",
    resolveId(id) {
      return id === VIRTUAL_ENTRY ? RESOLVED_ENTRY : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ENTRY) return undefined;
      return framework === "react"
        ? reactRuntime(styles, viewerOrigin)
        : vueRuntime(styles, viewerOrigin);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        );
        if (requestUrl.pathname === "/__atlas__/health") {
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify({ ok: true, framework }));
          return;
        }
        if (
          requestUrl.pathname === "/" ||
          requestUrl.pathname === "/preview"
        ) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(html());
          return;
        }
        next();
      });
    },
  };
}

export async function startPreviewServer(
  options: PreviewServerOptions,
): Promise<PreviewServer> {
  const rootPath = path.resolve(options.rootPath);
  const port = options.port ?? 4174;
  const viewerOrigin = options.viewerOrigin ?? "http://127.0.0.1:4173";
  const styles = await globalStyles(rootPath, options.framework);
  const projectHash = createHash("sha1")
    .update(rootPath.toLowerCase())
    .digest("hex")
    .slice(0, 12);
  const frameworkPlugin =
    options.framework === "react"
      ? react({ exclude: /component-atlas-vite/ })
      : vue();
  const server: ViteDevServer = await createServer({
    root: rootPath,
    configFile: false,
    appType: "custom",
    clearScreen: false,
    cacheDir: path.join(os.tmpdir(), "component-atlas-vite", projectHash),
    resolve: {
      alias: runtimeAliases(rootPath, options.framework),
      preserveSymlinks: true,
    },
    plugins: [
      tsconfigPaths({ root: rootPath }),
      styleFidelityPlugin(rootPath, styles),
      frameworkPlugin,
      atlasPlugin(options.framework, styles, viewerOrigin),
    ],
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      cors: { origin: viewerOrigin },
      fs: {
        strict: true,
        allow: [rootPath],
      },
    },
  });
  await server.listen();
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () => server.close(),
  };
}
