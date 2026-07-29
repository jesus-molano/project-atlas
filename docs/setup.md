# Install Project Atlas

This is the authoritative installation reference. For the shortest path, start
with the [root quick start](../README.md).

## Recommended Windows installation

Requirements:

- Git;
- Node.js 24 or newer;
- pnpm 11;
- Codex installed and signed in.

```powershell
git clone https://github.com/jesus-molano/project-atlas.git
Set-Location .\project-atlas
.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions
```

Restart Codex and open a new task. Then open the product repository and run:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

No manual Atlas bootstrap is required for the normal task flow.

## What the installer changes

The installer:

- installs workspace dependencies and builds the CLI, MCP, and local GUI product;
- globally ignores `.component-atlas/` artifacts;
- links or copies `frontend-task`, explicit-only `visual-direction`, and
  `reuse-first` into the selected agent's skill folder;
- optionally maintains one marked routing block in `~/.codex/AGENTS.md`;
- registers the local stdio server in Codex or Claude;
- never installs connectors or stores credentials.

For Codex, the managed technical identifier is
`mcp_servers.component-atlas`. Existing package and CLI identifiers retain
`component-atlas` for compatibility.

## Codex MCP modes

Use `-CodexMcpMode auto|config|cli`:

| Mode | Behavior |
| --- | --- |
| `auto` | Recommended. On Windows, edits Codex `config.toml` directly. Elsewhere, tries the CLI and falls back to config |
| `config` | Always manage the Codex TOML section directly |
| `cli` | Explicitly run `codex mcp get/add`; not recommended for packaged Windows builds |

Codex config is resolved in this order:

1. `$CODEX_HOME/config.toml` when `CODEX_HOME` is defined;
2. `~/.codex/config.toml` otherwise.

The installer manages only:

```toml
[mcp_servers.component-atlas]
command = "C:\\absolute\\stable\\path\\to\\node.exe"
args = ["C:\\absolute\\path\\to\\project-atlas\\packages\\mcp\\dist\\index.js"]
```

It preserves unrelated text, comments, keys, and sections. Before changing an
existing config it creates `config.toml.project-atlas.bak` (or a numbered
variant). A matching block is left byte-identical.

If the section points elsewhere or contains additional settings, installation
stops and prints the current and expected paths. Review them first. Rerun with
`-ForceMcpConfig` only when replacing that exact section is intentional.

The Node path is absolute and validated. With fnm, the installer prefers the
real installation for the active version rather than an ephemeral multishell
path.

## Useful installer flags

```powershell
# Show exact actions and paths without writing
.\frontend-codex-kit\install.ps1 -Agent codex -DryRun

# Force the direct Codex config route
.\frontend-codex-kit\install.ps1 -Agent codex -CodexMcpMode config

# Replace a conflicting Atlas MCP section after reviewing it
.\frontend-codex-kit\install.ps1 -Agent codex -ForceMcpConfig

# Install without registering MCP
.\frontend-codex-kit\install.ps1 -Agent codex -SkipMcp

# Install skills without the optional AGENTS.md routing block
.\frontend-codex-kit\install.ps1 -Agent codex

# Copy skills instead of linking them
.\frontend-codex-kit\install.ps1 -Agent codex -InstallMode copy

# Install Codex and Claude Code support
.\frontend-codex-kit\install.ps1 -Agent both -InstallAgentsInstructions
```

Other recovery/development flags:

- `-SkipDependencies`: do not run `pnpm install`;
- `-SkipBuild`: use existing package and GUI builds;
- `-CodexSkillsRoot`, `-ClaudeSkillsRoot`: override skill destinations;
- `-CodexAgentsPath`: override the opt-in `AGENTS.md` target.

`-DryRun` still resolves the real Node, config, skill, and package paths, but it
does not create directories, links, backups, or config files.

## Update

```powershell
Set-Location "C:\path\to\project-atlas"
git pull --ff-only
.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions
```

The installer is idempotent. Restart Codex and open a new task afterwards.

## Storage and authority

| Location | Purpose |
| --- | --- |
| Product repository | Product code; Atlas queries do not edit it |
| `%LOCALAPPDATA%\ProjectAtlas\projects\<project-id>\` | All durable Atlas data for one logical project |
| `%LOCALAPPDATA%\ProjectAtlas\temp\` | Ephemeral owned sessions with TTL/purge |
| `%LOCALAPPDATA%\ProjectAtlas\recent-projects.json` | Minimal recent-project registry |
| `~/.agents/skills/` | Codex skill links/copies |
| Codex `config.toml` | Local Atlas MCP registration |
| `~/.codex/AGENTS.md` | Optional small managed routing block |

The task skill may scan reconstructible code and read connected sources relevant
to the task. It cannot install plugins, authorize accounts, access unconnected
sources, or confirm durable memory on the user's behalf.

## Manual and advanced installation

Manual build:

```powershell
pnpm install --frozen-lockfile
pnpm build
node .\packages\cli\dist\index.js setup
```

Manual Codex config is documented above. The `cli` mode exists only for hosts
where `codex mcp` is known to work:

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex -CodexMcpMode cli
```

Claude Code uses its supported CLI registration:

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

## Development validation

```powershell
pnpm audit:product
pnpm test
pnpm typecheck
pnpm build
pnpm test:kit
```

See [workflow.md](workflow.md) for normal automatic behavior and advanced CLI
diagnostics. Use
[FIRST-RUN-CHECKLIST.md](../frontend-codex-kit/FIRST-RUN-CHECKLIST.md) for the
first real repository.
