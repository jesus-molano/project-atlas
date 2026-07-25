# Setup

## Portable installation

Requirements: Git, Node 24+, pnpm 11, and at least one supported agent client.

On Windows, the supported path is the safe installer:

```powershell
cd "C:\path\to\component-atlas"
.\frontend-codex-kit\install.ps1 -Agent codex
```

Use `-Agent claude` or `-Agent both` as needed. Run with `-DryRun` first to
inspect every filesystem, build, Git-ignore, and MCP action. The installer:

- installs dependencies and builds CLI/MCP packages;
- globally ignores `.component-atlas/` project artifacts;
- links `frontend-task` and `reuse-first` to the selected client skill folders;
- registers the local stdio MCP without credentials;
- preserves existing unrelated skills and existing `component-atlas` MCP
  entries instead of overwriting them.

See [../frontend-codex-kit/README.md](../frontend-codex-kit/README.md) for the
complete new-computer guide and
[../frontend-codex-kit/TOMORROW.md](../frontend-codex-kit/TOMORROW.md) for the
first real-work checklist.

## Manual build

```powershell
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js setup
```

Use `node packages/cli/dist/index.js` in place of `component-atlas` unless the
CLI package has been linked or installed globally.

## Manual Codex connection

```powershell
codex mcp add component-atlas -- node "C:\path\to\component-atlas\packages\mcp\dist\index.js"
codex mcp get component-atlas
```

Link both skills:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\frontend-task" `
  -Target "C:\path\to\component-atlas\skills\frontend-task"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\reuse-first" `
  -Target "C:\path\to\component-atlas\skills\reuse-first"
```

Codex uses `~/.agents/skills` for personal skills. It detects skill file changes
automatically; restart once if the top-level folder did not exist when the
client started.

## Manual Claude Code connection

```powershell
claude mcp add --scope user component-atlas -- node "C:\path\to\component-atlas\packages\mcp\dist\index.js"
claude mcp get component-atlas
```

Link the same skill sources into `~/.claude/skills`. Invoke
`/frontend-task` or `/reuse-first` in Claude Code.

## MCP tools

- `scan_repository`
- `get_reuse_context`
- `search_components`
- `get_component`
- `find_similar_components`
- `list_component_usages`
- `analyze_prop_change_impact`
- `record_component_decision`
- `map_figma_file`
- `list_figma_indexes`
- `find_design_candidates`
- `inspect_design_node`
- `orient_project`
- `search_project_memory`
- `get_memory_item`
- `get_task_context`
- `check_before_change`
- `propose_memory_update`
- `apply_memory_update`
- `record_outcome`

All tools take an absolute `root_path`. Read operations use the existing local
graph and scan only when none exists. Query tools return compact native
`structuredContent` plus a minimal text status; they do not duplicate the full
result. Project queries include hard budget metrics. Set `raw: true` only when
diagnosing the older component index itself.

Figma tools accept metadata supplied by the calling agent; Atlas does not store
Figma credentials. Ready for dev, Code Connect, global Variables, Jira, and
Confluence are optional enrichments, not prerequisites.

Project Memory can be indexed and queried without any external connector:

```powershell
node packages/cli/dist/index.js memory index "C:\path\to\project"
node packages/cli/dist/index.js memory task "C:\path\to\project" `
  "add study filter to search" --budget 3600
```

See [project-memory.md](project-memory.md) before deciding whether canonical
Markdown may be committed by the team.

## Optional relationship map

```powershell
node packages/cli/dist/index.js open "C:\path\to\project"
```

The read-only map binds to `127.0.0.1:4173`. It does not execute or preview
project components. There is no Lab server.

## Validate development changes

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Official client references:

- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
