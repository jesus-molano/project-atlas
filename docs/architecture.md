# Architecture

Component Atlas is local-first and deliberately split into analysis, storage,
agent access, and presentation.

```mermaid
flowchart LR
  R[Vue/Nuxt or React/Next repository]
  V[Vue adapter]
  X[React adapter]
  G[Framework-neutral graph]
  S[(SQLite in local app data)]
  A[.component-atlas catalog and decisions]
  C[CLI]
  M[MCP server]
  P[Vite preview runtime]
  W[Nuxt Map and Lab viewer]
  K[reuse-first skill]

  R --> V
  R --> X
  V --> G
  X --> G
  G --> S
  G --> A
  S --> C
  S --> M
  S --> W
  R --> P
  P --> W
  K --> M
  K -. fallback .-> C
```

## Package boundaries

- `core`: graph schema, search, explainable similarity, impact traversal, and
  framework-neutral playground contracts.
- `adapter-vue`: Vue SFC macros, templates, Nuxt runtime names, autoimports, and
  mirrored tests.
- `adapter-react`: exported and file-local React components, props, JSX
  composition, styling tokens, and tests.
- `store`: SQLite persistence using Node's built-in `node:sqlite`.
- `runtime`: detection, indexing orchestration, design-token discovery,
  scenarios, artifacts, and decision records.
- `preview`: loopback-only Vite runtime that imports components from their real
  repository and streams prop, token, background, viewport, and action state.
- `cli`: human and script interface.
- `mcp`: agent-facing tools over stdio.
- `viewer`: local Nuxt application with a relationship Map and interactive
  component Lab. It reads the database through a minimal server boundary and
  persists only explicit preview scenarios.

## Graph model

A component node records:

- source and effective runtime names;
- public, feature, or private scope;
- props, emits, slots, and models;
- rendered component names and imports;
- tests, source location, class tokens, and a content hash.

The project graph also records CSS custom properties as semantic design tokens.
Each component playground contract combines the indexed component, inferred
controls, relevant tokens, renderability, and saved scenarios. The contract is
plain JSON so the viewer, CLI, Codex, and Claude can share exactly the same
state.

The graph currently has three edge types:

- `renders`: source composition and impact traversal;
- `similar_to`: weighted structural evidence, never an automatic refactor;
- `tested_by`: component-to-test traceability.

Similarity weights are intentionally deterministic:

- name intent: 30%;
- shared props: 25%;
- rendered children: 20%;
- static class tokens: 15%;
- matching API shape: 10%.

Every similarity result includes the shared evidence so a developer or agent can
reject a superficially similar match.

## Storage

Large and machine-oriented state is written to:

```text
%LOCALAPPDATA%\ComponentAtlas\projects\<project-id>\atlas.sqlite
```

The analyzed repository receives only:

```text
.component-atlas/
├── project.json
├── catalog.md
├── decisions/
└── scenarios/
```

The CLI setup command adds `.component-atlas/` to the Git global excludes file.
This keeps the artifacts available to local agents without polluting project
commits.

## Scope semantics

- `public`: shared UI, layout, or common component.
- `feature`: exported component owned by one product feature.
- `private`: file-local React component or explicitly local Vue component.

A private component is a discovery candidate, but never a valid cross-feature
import. The reuse gate must choose `extract-and-reuse` when its responsibility
should become shared.
