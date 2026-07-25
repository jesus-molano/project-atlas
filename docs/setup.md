# Setup

## Build

Requirements: Node 24+ and pnpm.

The workspace currently resolves Nuxt 4.5.0, TypeScript 7.0.2, and Vite 8.1.5.
TypeScript 7.0 is the workspace compiler. Because 7.0 does not yet ship a
stable programmatic Compiler API, the React and Vue AST adapters follow the
official side-by-side migration: they import the TypeScript 6 compatibility
package while package builds and typechecks run with the TypeScript 7 `tsc`.
Vite uses its native `resolve.tsconfigPaths` support rather than the legacy
`vite-tsconfig-paths` plugin.

```powershell
cd "C:\Users\jessu\dev\component-atlas"
pnpm install
pnpm build
node packages/cli/dist/index.js setup
```

Use `node packages/cli/dist/index.js` in place of `component-atlas` unless the
CLI package has been linked or installed globally.

## Connect Codex

Codex supports stdio MCP servers through `codex mcp add`:

```powershell
codex mcp add component-atlas -- node "C:\Users\jessu\dev\component-atlas\packages\mcp\dist\index.js"
codex mcp list
```

For a personal skill, link or copy the skill directory into the documented user
skill location:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\reuse-first" `
  -Target "C:\Users\jessu\dev\component-atlas\skills\reuse-first"
```

Codex detects local skill changes automatically; restart it if the skill does
not appear. Invoke it explicitly with `$reuse-first`, or let its description
trigger on frontend component work.

## Connect Claude Code

The installed Claude Code CLI accepts the same stdio server:

```powershell
claude mcp add component-atlas -- node "C:\Users\jessu\dev\component-atlas\packages\mcp\dist\index.js"
claude mcp list
```

Use `skills/reuse-first/SKILL.md` as the source for a Claude command, project
instruction, or equivalent reusable workflow.

## MCP tools

- `scan_repository`
- `search_components`
- `get_component`
- `find_similar_components`
- `list_component_usages`
- `analyze_prop_change_impact`
- `get_component_playground`
- `save_component_scenario`
- `record_component_decision`

All tools take an absolute `root_path`. Read operations automatically use the
existing local graph and scan only when no graph exists.

## Viewer

```powershell
node packages/cli/dist/index.js open "C:\path\to\project"
```

The viewer binds to `127.0.0.1:4173`, refreshes the repository first, and opens
the browser. Its isolated component runtime binds to `127.0.0.1:4174`. Use
`--port` and `--preview-port` to choose other ports, or `--no-browser` for a
headless launch.

Map mode explains composition, similarity, and impact. Lab mode renders source
components with inferred prop controls, semantic CSS-token overrides, viewport
presets, and saved scenarios. A saved scenario is available immediately through
the CLI and MCP, so humans and coding agents inspect the same state.

Install the target repository's dependencies before using Lab mode. Atlas
provides framework fallbacks for simple isolated components, but components that
import project libraries, Nuxt modules, or Next packages need the repository's
normal `node_modules`.

## Validate development changes

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Real-repository smoke tests:

```powershell
node packages/cli/dist/index.js scan "C:\Users\jessu\dev\vuenime"
node packages/cli/dist/index.js scan "C:\Users\jessu\dev\Expense Log App"
```
