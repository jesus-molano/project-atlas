# Setup

## Build

Requirements: Node 24+ and pnpm.

The workspace resolves Nuxt 4.5.0, TypeScript 7.0.2, and Vite 8.1.5.

```powershell
cd "C:\Users\jessu\dev\component-atlas"
pnpm install
pnpm build
node packages/cli/dist/index.js setup
```

Use `node packages/cli/dist/index.js` in place of `component-atlas` unless the
CLI package has been linked or installed globally.

## Connect Codex

```powershell
codex mcp add component-atlas -- node "C:\Users\jessu\dev\component-atlas\packages\mcp\dist\index.js"
codex mcp list
```

For the workflow module:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\reuse-first" `
  -Target "C:\Users\jessu\dev\component-atlas\skills\reuse-first"
```

## Connect Claude Code

```powershell
claude mcp add component-atlas -- node "C:\Users\jessu\dev\component-atlas\packages\mcp\dist\index.js"
claude mcp list
```

Use `skills/reuse-first/SKILL.md` as a Claude command or project instruction.

## MCP tools

- `scan_repository`
- `get_reuse_context`
- `search_components`
- `get_component`
- `find_similar_components`
- `list_component_usages`
- `analyze_prop_change_impact`
- `record_component_decision`

All tools take an absolute `root_path`. Read operations use the existing local
graph and scan only when none exists.

## Optional relationship map

```powershell
node packages/cli/dist/index.js open "C:\path\to\project"
```

The read-only map binds to `127.0.0.1:4173`. It does not execute or preview
project components.

## Validate development changes

```powershell
pnpm test
pnpm typecheck
pnpm build
```
