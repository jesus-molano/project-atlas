# Install Project Atlas

This is the authoritative installation reference. For the shortest path, start
with the [root quick start](../README.md).

## Recommended installation

Requirements:

- Git;
- Node.js 24 or newer;
- pnpm 11;
- Codex installed and signed in.

```powershell
git clone https://github.com/jesus-molano/project-atlas.git
Set-Location .\project-atlas
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

On Ubuntu/macOS install PowerShell 7 and use:

```sh
pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex
pwsh -NoProfile -File ./frontend-codex-kit/doctor.ps1
```

Required on every platform: Git, Node.js 24+, and pnpm 11.x. Windows PowerShell
5.1 or PowerShell 7 works on Windows; non-Windows requires `pwsh`. Link mode
uses a Windows junction or a symbolic link; select `-InstallMode copy` if the
host policy disallows links.

The doctor is read-only and prints one action for every failed check. After it
passes, restart Codex and open a new task. Then open the product repository and
run:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

No manual Atlas bootstrap is required for the normal task flow.

## Client support status

Codex is the primary route. Its installer, read-only doctor, explicit-only skill
policy, six-tool MCP core, and frontend workflow are covered by repository CI on
Windows and Ubuntu.

Claude Code is a compatibility preview. The installer can place the same Agent
Skills under `~/.claude/skills` and register the same host-neutral MCP core with
the supported Claude CLI. The repository does not yet provide a Claude-aware
doctor, Claude-specific explicit-only enforcement, provider setup, or an
end-to-end Claude workflow test. Configure external connectors independently and
verify the effective MCP entry manually before use.

## What the installer changes

The installer:

- installs workspace dependencies and builds the CLI, MCP, and local GUI product;
- does not add repository-local Atlas state or alter Git ignore configuration;
- links or copies explicit-only `frontend-task`, `reuse-first`, and
  `visual-direction` into the selected agent's skill folder;
- removes only the obsolete marked Atlas routing block from
  `~/.codex/AGENTS.md`, preserving a neighboring backup, and never adds global
  routing;
- registers the local stdio server in Codex, or through the best-effort Claude
  compatibility route, with the `core` profile;
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

On non-Windows systems, `auto` preserves an existing CLI entry with the same
name because CLI display output is not a stable machine-readable contract. The
doctor still verifies its exact executable, Atlas entry path, and
`--profile core`. Use `config` mode for deterministic comparison and
conflict-safe replacement.

Codex config is resolved in this order:

1. `$CODEX_HOME/config.toml` when `CODEX_HOME` is defined;
2. `~/.codex/config.toml` otherwise.

The installer manages only:

```toml
[mcp_servers.component-atlas]
command = "C:\\absolute\\stable\\path\\to\\node.exe"
args = ["C:\\absolute\\path\\to\\project-atlas\\packages\\mcp\\dist\\index.js", "--profile", "core"]
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

# Copy skills instead of linking them
.\frontend-codex-kit\install.ps1 -Agent codex -InstallMode copy

# Install Codex plus the Claude Code compatibility preview
.\frontend-codex-kit\install.ps1 -Agent both
```

Other recovery/development flags:

- `-SkipDependencies`: do not run `pnpm install`;
- `-SkipBuild`: use existing package and GUI builds;
- `-CodexSkillsRoot`, `-ClaudeSkillsRoot`: override skill destinations;
- `-CodexAgentsPath`: override the `AGENTS.md` path used only for legacy-block
  removal.

`-DryRun` still resolves the real Node, config, skill, and package paths, but it
does not create directories, links, backups, or config files.

## Read-only doctor

Run after installation, update, or an MCP/skill detection problem:

```powershell
.\frontend-codex-kit\doctor.ps1
```

It verifies Git, a stable Node 24+ executable, pnpm 11.x, CLI/MCP builds, the
live six-tool core contract through a stdio MCP smoke test, all three
installed skill manifests, their explicit-only policy, and the exact
`component-atlas` Codex entry pointing to this clone with `--profile core`. It
never writes. A failed check prints the reinstall/config action; review
conflicts before using `-ForceMcpConfig`.

The doctor validates Codex only. It does not inspect `~/.claude/skills` or
`~/.claude.json`; use the manual Claude checks below for the compatibility
preview.

## Update

```powershell
Set-Location "C:\path\to\project-atlas"
git pull --ff-only
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

The installer is idempotent. Restart Codex and open a new task afterwards.

## Storage and authority

| Location | Purpose |
| --- | --- |
| Product repository | Product code; Atlas queries do not edit it |
| Platform application-data root (`%LOCALAPPDATA%\ProjectAtlas\` on Windows, `~/Library/Application Support/ProjectAtlas/` on macOS, `${XDG_DATA_HOME:-~/.local/share}/ProjectAtlas/` on Linux) | Durable `projects/` and `recent-projects.json`, plus managed ephemeral data under `temp/` |
| `~/.agents/skills/` | Codex skill links/copies |
| Codex `config.toml` | Local Atlas MCP registration |
| `~/.codex/AGENTS.md` | Personal instructions; obsolete marked Atlas block removed only |
| `~/.claude/skills/` | Claude compatibility-preview skill links/copies when selected |
| `~/.claude.json` | Claude user-scoped MCP registration created by the supported CLI when selected |

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

Claude Code uses its supported CLI registration as a compatibility preview:

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

Then run `claude mcp get component-atlas` and inspect `/mcp` in Claude Code.
Confirm the entry uses the stable Node executable, this clone's MCP entry,
`--profile core`, and exposes all six core tools. The installer preserves an
existing server with the same name, and there is no Claude-aware doctor to
detect a stale path. Invoke `/frontend-task` deliberately: the instructions ask
for explicit use, but the Codex `agents/openai.yaml` policy does not enforce
Claude behavior. Configure Jira, Confluence, Figma, GitHub, and other provider
capabilities independently. This route has not been validated end to end and
does not claim parity with Codex.

## Development validation

```powershell
pnpm audit:product
pnpm test
pnpm typecheck
pnpm build
pnpm test:kit
```

## Repository protection policy

The repository-owned CI contract is `.github/workflows/ci.yml`. Protect
`main` with a GitHub ruleset that requires pull requests, resolved review
threads, a current branch, and these two stable status checks:

- `Validate (ubuntu-latest)`;
- `Validate (windows-latest)`.

Disable force pushes and branch deletion. The workflow also handles
`merge_group`, so those same checks can gate a merge queue if the repository
enables one. Requiring approvals or CODEOWNERS is an organization policy choice,
but administrators should not bypass the two CI checks for normal delivery.
GitHub stores and enforces branch rules outside the Git checkout, so cloning
this repository cannot activate them automatically; an owner must configure or
audit the ruleset in repository settings.

See [workflow.md](workflow.md) for normal automatic behavior and advanced CLI
diagnostics. Use
[FIRST-RUN-CHECKLIST.md](../frontend-codex-kit/FIRST-RUN-CHECKLIST.md) for the
first real repository.
