# Setup

## Build

Requirements: Node 24+ and pnpm.

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
- `record_component_decision`

All tools take an absolute `root_path`. Read operations automatically use the
existing local graph and scan only when no graph exists.

## Viewer

```powershell
node packages/cli/dist/index.js open "C:\path\to\project"
```

The viewer binds to `127.0.0.1:4173`, refreshes the repository first, and opens
the browser. Use `--port` to choose another port and `--no-browser` for a
headless launch.

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
