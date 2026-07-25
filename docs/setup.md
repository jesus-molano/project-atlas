# Setup

## Portable installation

Requirements: Git, Node 24+, pnpm 11, and at least one supported agent client.

On Windows, the supported path is the safe installer:

```powershell
cd "C:\path\to\project-atlas"
.\frontend-codex-kit\install.ps1 -Agent codex
```

Use `-Agent claude` or `-Agent both` as needed. Run with `-DryRun` first to
inspect every filesystem, build, Git-ignore, and MCP action. The installer:

- installs dependencies and builds CLI/MCP packages;
- globally ignores `.component-atlas/` project artifacts;
- links `frontend-task` and `reuse-first` to the selected client skill folders;
- optionally adds an idempotent managed routing block to
  `~/.codex/AGENTS.md` with `-InstallAgentsInstructions`, preserving all other
  content;
- registers the local stdio MCP without credentials or dependence on the
  packaged Codex executable;
- preserves existing unrelated skills, TOML sections, and comments;
- creates a config backup and refuses to overwrite a conflicting
  `component-atlas` MCP entry without `-ForceMcpConfig`.

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

## Codex MCP registration

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex -CodexMcpMode config
```

The Windows `auto` mode already selects this route. It writes the standard
`[mcp_servers.component-atlas]` block to `$CODEX_HOME/config.toml` or
`~/.codex/config.toml`, using absolute stable Node and MCP entrypoint paths. It
does not invoke `codex.exe`. Restart Codex and open a new task afterwards.

Run with `-DryRun` to inspect the exact target without writing. If a different
block already exists, review the reported current and expected paths; only use
`-ForceMcpConfig` when replacement is intentional. `-SkipMcp` installs the
remaining kit without registering the server.

Link both skills:

```powershell
New-Item -ItemType Directory -Force "$HOME\.agents\skills"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\frontend-task" `
  -Target "C:\path\to\project-atlas\skills\frontend-task"
New-Item -ItemType Junction `
  -Path "$HOME\.agents\skills\reuse-first" `
  -Target "C:\path\to\project-atlas\skills\reuse-first"
```

Codex uses `~/.agents/skills` for personal skills. It detects skill file changes
automatically; restart once if the top-level folder did not exist when the
client started.

Optional global routing instruction:

```powershell
.\frontend-codex-kit\install.ps1 `
  -Agent codex `
  -InstallAgentsInstructions
```

The managed marker block says to use `frontend-task` for frontend work and
Atlas only when connected and useful. It never instructs Codex to install or
initialize plugins automatically. A new task or instruction reload may be
needed after changing `~/.codex/AGENTS.md`.

## Manual Claude Code connection

```powershell
claude mcp add --scope user component-atlas -- node "C:\path\to\project-atlas\packages\mcp\dist\index.js"
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

## Project Atlas GUI

```powershell
node packages/cli/dist/index.js open "C:\path\to\project"
```

The local GUI binds to `127.0.0.1:4173`. It covers Code Atlas, Design Atlas,
Project Memory, decisions and risks, bounded Task Context, proposal review,
integration health, and settings. Browsing local indexes uses no agent tokens.

## Validate development changes

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:kit
```

Official client references:

- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
