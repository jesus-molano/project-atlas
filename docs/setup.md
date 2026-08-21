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

On Arch Linux or CachyOS, install the repository packages and use the native
Bash scripts:

```sh
sudo pacman -Syu --needed git nodejs-lts-krypton pnpm openai-codex
git clone https://github.com/jesus-molano/project-atlas.git
cd project-atlas
bash ./frontend-codex-kit/install.sh --agent codex
bash ./frontend-codex-kit/doctor.sh
```

This route does not require PowerShell or `pwsh`. Arch's rolling `nodejs`
package is also supported whenever it provides Node 24 or newer; the command
above selects Node 24 LTS explicitly. Keep the Atlas clone at a stable path:
skill links and the MCP command refer back to that clone, and updates are
applied there.

On Ubuntu/macOS, the existing PowerShell 7 route remains available:

```sh
pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex
pwsh -NoProfile -File ./frontend-codex-kit/doctor.ps1
```

Required on every platform: Git, Node.js 24+, and pnpm 11.x. Windows PowerShell
5.1 or PowerShell 7 works on Windows. Arch/CachyOS uses native Bash; the
Ubuntu/macOS commands above require `pwsh`. Link mode uses a Windows junction
or a symbolic link. Select `-InstallMode copy` on PowerShell or
`--install-mode copy` on Bash if the host policy disallows links.

The doctor is read-only and prints one action for every failed check. After it
passes, restart Codex and open a new task. Then open the product repository and
run:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

No manual Atlas bootstrap is required for the normal task flow.

## Client support status

Codex is the primary route. Its installer, read-only doctor, selective
`frontend-task` policy, explicit child skills, six-tool MCP core, and frontend
workflow are covered by repository CI on Windows and Ubuntu. The native Bash
installer and doctor are additionally covered in an Arch Linux container.

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
- links or copies selectively automatic `frontend-task` plus explicit-only
  `reuse-first` and `visual-direction` into the selected agent's skill folder;
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

Use `-CodexMcpMode auto|config|cli` on PowerShell or
`--codex-mcp-mode auto|config|cli` on Bash:

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
`-ForceMcpConfig` on PowerShell or `--force-mcp-config` on Bash only when
replacing that exact section is intentional.

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

The native Bash installer exposes the equivalent POSIX-style flags:

```sh
# Show exact actions and paths without writing
bash ./frontend-codex-kit/install.sh --agent codex --dry-run

# Force the direct Codex config route
bash ./frontend-codex-kit/install.sh --agent codex --codex-mcp-mode config

# Replace a conflicting Atlas MCP section after reviewing it
bash ./frontend-codex-kit/install.sh --agent codex --force-mcp-config

# Install without registering MCP
bash ./frontend-codex-kit/install.sh --agent codex --skip-mcp

# Copy skills instead of linking them
bash ./frontend-codex-kit/install.sh --agent codex --install-mode copy

# Install Codex plus the Claude Code compatibility preview
bash ./frontend-codex-kit/install.sh --agent both
```

| PowerShell | Bash | Purpose |
| --- | --- | --- |
| `-Agent` | `--agent` | Select `codex`, `claude`, or `both` |
| `-InstallMode` | `--install-mode` | Select `link` or `copy` |
| `-CodexMcpMode` | `--codex-mcp-mode` | Select `auto`, `config`, or `cli` |
| `-ForceMcpConfig` | `--force-mcp-config` | Replace a reviewed conflicting MCP section |
| `-SkipMcp` | `--skip-mcp` | Skip MCP registration |
| `-DryRun` | `--dry-run` | Resolve and report without writing |
| `-SkipDependencies` | `--skip-dependencies` | Reuse installed workspace dependencies |
| `-SkipBuild` | `--skip-build` | Reuse current build artifacts |
| `-CodexSkillsRoot` | `--codex-skills-root` | Override the Codex skill destination |
| `-ClaudeSkillsRoot` | `--claude-skills-root` | Override the Claude skill destination |
| `-CodexAgentsPath` | `--codex-agents-path` | Override the Codex instruction file |
| `-AtlasRoot` | `--atlas-root` | Select a stable Atlas clone explicitly |

Other recovery/development flags:

- `-SkipDependencies`: do not run `pnpm install`;
- `-SkipBuild`: use existing package and GUI builds;
- `-CodexSkillsRoot`, `-ClaudeSkillsRoot`: override skill destinations;
- `-CodexAgentsPath`: override the `AGENTS.md` path used only for legacy-block
  removal.

`-DryRun` and `--dry-run` still resolve the real Node, config, skill, and
package paths, but do not create directories, links, backups, or config files.

## Read-only doctor

Run after installation, update, or an MCP/skill detection problem:

```powershell
.\frontend-codex-kit\doctor.ps1
```

On Arch Linux or CachyOS:

```sh
bash ./frontend-codex-kit/doctor.sh
```

It verifies Git, a stable Node 24+ executable, pnpm 11.x, CLI/MCP builds, the
live six-tool core contract through a stdio MCP smoke test, all three installed
skill manifests, the selective `frontend-task` policy, the explicit child-skill
policies, and the exact `component-atlas` Codex entry pointing to this clone
with `--profile core`. It
never writes. A failed check prints the reinstall/config action; review
conflicts before using `-ForceMcpConfig` or `--force-mcp-config`.

The Bash doctor accepts `--atlas-root`, `--codex-skills-root`,
`--codex-config-path`, and `--skip-mcp-smoke`, equivalent to the PowerShell
doctor options. Both doctors validate Codex only and remain read-only.

They do not inspect `~/.claude/skills` or `~/.claude.json`; use the manual
Claude checks below for the compatibility preview.

## Update

```powershell
Set-Location "C:\path\to\project-atlas"
git pull --ff-only
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

On Arch Linux or CachyOS, update the same stable clone and rerun the native
installer and doctor:

```sh
cd /path/to/project-atlas
git pull --ff-only
bash ./frontend-codex-kit/install.sh --agent codex
bash ./frontend-codex-kit/doctor.sh
```

The installer is idempotent. Restart Codex and open a new task afterwards.

## Optional local GUI

The installer builds the local GUI as part of the same stable clone. Open its
project selector, or pass one product repository directly:

```sh
pnpm atlas
pnpm atlas -- "/home/user/dev/product-repository"
```

On Windows, the direct path can use the usual form
`pnpm atlas -- "C:\path\to\product-repository"`. Keep the launching terminal
open; press Ctrl+C there to stop the loopback viewer.

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

On Arch Linux or CachyOS, the equivalent command is:

```sh
bash ./frontend-codex-kit/install.sh --agent codex --codex-mcp-mode cli
```

Claude Code uses its supported CLI registration as a compatibility preview:

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

The native Bash equivalent is
`bash ./frontend-codex-kit/install.sh --agent claude`.

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

```text
pnpm audit:product
pnpm test
pnpm typecheck
pnpm build
pnpm test:kit
# Linux only
pnpm test:kit:shell
```

## Repository protection policy

The repository-owned CI contract is `.github/workflows/ci.yml`. Protect
`main` with a GitHub ruleset that requires pull requests, resolved review
threads, a current branch, and these three stable status checks:

- `Validate (ubuntu-latest)`;
- `Validate (windows-latest)`;
- `Validate native installer (Arch Linux)`.

Disable force pushes and branch deletion. The workflow also handles
`merge_group`, so those same checks can gate a merge queue if the repository
enables one. Requiring approvals or CODEOWNERS is an organization policy choice,
but administrators should not bypass the three CI checks for normal delivery.
GitHub stores and enforces branch rules outside the Git checkout, so cloning
this repository cannot activate them automatically; an owner must configure or
audit the ruleset in repository settings.

See [workflow.md](workflow.md) for normal automatic behavior and advanced CLI
diagnostics. Use
[FIRST-RUN-CHECKLIST.md](../frontend-codex-kit/FIRST-RUN-CHECKLIST.md) for the
first real repository.
