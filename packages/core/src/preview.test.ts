import { describe, expect, it } from "vitest";
import {
  buildPlaygroundContract,
  inferPreviewControls,
  initialPreviewProps,
} from "./preview.js";
import {
  GRAPH_SCHEMA_VERSION,
  type ComponentGraph,
  type ComponentNode,
} from "./types.js";

function specimen(overrides: Partial<ComponentNode> = {}): ComponentNode {
  return {
    id: "vue:UiButton.vue#UiButton",
    framework: "vue",
    name: "UiButton",
    effectiveName: "UiButton",
    sourcePath: "/workspace/components/UiButton.vue",
    relativePath: "components/UiButton.vue",
    visibility: "public",
    exported: true,
    location: { line: 1, column: 1 },
    props: [
      {
        name: "variant",
        type: "'solid' | 'outline' | 'ghost'",
        required: true,
      },
      { name: "disabled", type: "boolean", required: false },
      { name: "label", type: "string", required: true },
      { name: "lineClamp", type: "1 | 2 | 3", required: false },
      { name: "items", type: "Item[]", required: true },
      { name: "anime", type: "Anime | FavoriteAnime", required: true },
      { name: "className", type: "unknown", required: false },
      { name: "onClick", type: "() => void", required: false },
    ],
    events: [{ name: "close" }],
    slots: [],
    models: [],
    renderedNames: [],
    imports: [],
    testPaths: [],
    classTokens: ["color:var(--button-accent)"],
    sourceHash: "fixture",
    ...overrides,
  };
}

describe("component playground", () => {
  it("infers useful controls and safe initial state", () => {
    const controls = inferPreviewControls(specimen());

    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "variant",
          kind: "select",
          options: ["solid", "outline", "ghost"],
        }),
        expect.objectContaining({ name: "disabled", kind: "boolean" }),
        expect.objectContaining({ name: "label", kind: "text" }),
        expect.objectContaining({
          name: "lineClamp",
          kind: "select",
          options: ["1", "2", "3"],
        }),
        expect.objectContaining({
          name: "items",
          kind: "json",
          presets: expect.arrayContaining([
            expect.objectContaining({ label: "Sample list" }),
          ]),
        }),
        expect.objectContaining({
          name: "anime",
          kind: "json",
          presets: expect.arrayContaining([
            expect.objectContaining({ label: "Sample data" }),
          ]),
        }),
        expect.objectContaining({ name: "onClick", kind: "action" }),
        expect.objectContaining({
          name: "onClose",
          label: "Close Event",
          kind: "action",
        }),
      ]),
    );
    expect(initialPreviewProps(controls)).toEqual({
      variant: "solid",
      disabled: false,
      label: "Example label",
      lineClamp: 1,
      items: [
        {
          id: "atlas-item",
          name: "Sample item",
          label: "Sample item",
        },
      ],
      anime: expect.objectContaining({
        title: "Sample anime",
        images: {
          jpg: expect.objectContaining({ large_image_url: expect.any(String) }),
          webp: expect.objectContaining({ large_image_url: expect.any(String) }),
        },
      }),
      className: "",
    });
  });

  it("returns a serializable agent contract with relevant tokens", () => {
    const component = specimen();
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "fixture",
        name: "fixture",
        rootPath: "/workspace",
        framework: "vue",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 1,
      },
      components: [component],
      edges: [],
      tokens: [
        {
          name: "button-accent",
          value: "#43d1a0",
          kind: "color",
          sourcePath: "assets/theme.css",
        },
      ],
    };

    const contract = buildPlaygroundContract(graph, component);

    expect(contract.renderable).toBe(true);
    expect(contract.tokens[0]?.name).toBe("button-accent");
    expect(JSON.parse(JSON.stringify(contract))).toMatchObject({
      component: { id: component.id },
      controls: expect.any(Array),
      scenarios: [],
    });
  });

  it("explains the isolated-render boundary for local React components", () => {
    const component = specimen({
      framework: "react",
      exported: false,
      sourcePath: "/workspace/components/Card.tsx",
    });
    const graph: ComponentGraph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      project: {
        id: "fixture",
        name: "fixture",
        rootPath: "/workspace",
        framework: "react",
        scannedAt: new Date(0).toISOString(),
        sourceFiles: 1,
      },
      components: [component],
      edges: [],
      tokens: [],
    };

    const contract = buildPlaygroundContract(graph, component);

    expect(contract.renderable).toBe(false);
    expect(contract.renderabilityReason).toContain("file-local");
  });
});
