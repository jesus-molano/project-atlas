# Frontend Codex Kit reference

This folder contains the portable installer for Project Atlas and its three
skills. New users should follow the
[five-minute quick start](../README.md). This page
documents installer behavior and recovery flags.

Codex is the primary, end-to-end validated client. Claude Code support is a
compatibility preview for skill discovery and the shared MCP core, not a claim
of workflow parity.

## Recommended command

Requirements are Git, Node.js 24+, and pnpm 11.x. Windows PowerShell 5.1 and
PowerShell 7 are supported on Windows. Arch Linux and CachyOS use native Bash
and do not require PowerShell or `pwsh`; the existing Ubuntu/macOS route uses
PowerShell 7.

From a stable Project Atlas clone on Windows:

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

From a stable Project Atlas clone on Arch Linux or CachyOS:

```sh
sudo pacman -Syu --needed git nodejs-lts-krypton pnpm openai-codex
git clone https://github.com/jesus-molano/project-atlas.git
cd project-atlas
bash ./frontend-codex-kit/install.sh --agent codex
bash ./frontend-codex-kit/doctor.sh
```

Arch's rolling `nodejs` package is also valid when it supplies Node 24 or
newer. The documented package command chooses Node 24 LTS. Keep the clone at a
stable path because installed links and the MCP command resolve back to it.

The command:

- installs dependencies and builds the complete local Atlas product;
- installs explicit-only `frontend-task`, `reuse-first`, and `visual-direction`;
- removes the obsolete marked Atlas routing block from Codex `AGENTS.md`;
- adds the local Project Atlas MCP server to Codex;
- confirms the centralized platform application-data storage root.

It does not install plugins, request credentials, connect accounts, or copy
corporate data.

## Installed locations

| Artifact | Default location |
| --- | --- |
| Codex skills | `~/.agents/skills/frontend-task`, `visual-direction`, and `reuse-first` |
| Claude skills | `~/.claude/skills/frontend-task`, `visual-direction`, and `reuse-first` |
| Codex MCP entry | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| Claude MCP entry | User-scoped `component-atlas` entry in `~/.claude.json`, created through the Claude CLI |
| Legacy routing migration | `~/.codex/AGENTS.md` (marked Atlas block removed only) |
| All durable Atlas project data | Windows: `%LOCALAPPDATA%\ProjectAtlas\`; macOS: `~/Library/Application Support/ProjectAtlas/`; Linux: `${XDG_DATA_HOME:-~/.local/share}/ProjectAtlas/` |
| Ephemeral assets/previews | `<platform Atlas storage root>/temp/` |

The product repository is not modified merely by installing or querying Atlas.
Legacy repository-local memory remains read-only compatibility evidence.

## Installer flags

| PowerShell | Bash | Purpose |
| --- | --- | --- |
| `-Agent codex|claude|both` | `--agent codex|claude|both` | Select clients |
| `-InstallMode link|copy` | `--install-mode link|copy` | Link skills by default or copy them |
| `-CodexMcpMode auto|config|cli` | `--codex-mcp-mode auto|config|cli` | Select Codex MCP registration route |
| `-ForceMcpConfig` | `--force-mcp-config` | Replace a conflicting Atlas section after review |
| `-SkipMcp` | `--skip-mcp` | Install without MCP registration |
| `-DryRun` | `--dry-run` | Resolve and print exact actions without writing |
| `-SkipDependencies` | `--skip-dependencies` | Reuse installed workspace dependencies |
| `-SkipBuild` | `--skip-build` | Reuse existing package and GUI builds |
| `-CodexSkillsRoot` | `--codex-skills-root` | Override Codex skill destination |
| `-ClaudeSkillsRoot` | `--claude-skills-root` | Override Claude skill destination |
| `-CodexAgentsPath` | `--codex-agents-path` | Override the managed Codex instruction file |
| `-AtlasRoot` | `--atlas-root` | Select the stable Atlas clone explicitly |

Examples:

```powershell
# Inspect the installation
.\frontend-codex-kit\install.ps1 -Agent codex -DryRun

# Force direct Codex config registration
.\frontend-codex-kit\install.ps1 -Agent codex -CodexMcpMode config

# Install both supported clients
.\frontend-codex-kit\install.ps1 -Agent both

# Continue without MCP registration
.\frontend-codex-kit\install.ps1 -Agent codex -SkipMcp
```

The same examples on Arch Linux or CachyOS are:

```sh
# Inspect the installation
bash ./frontend-codex-kit/install.sh --agent codex --dry-run

# Force direct Codex config registration
bash ./frontend-codex-kit/install.sh --agent codex --codex-mcp-mode config

# Install both supported clients
bash ./frontend-codex-kit/install.sh --agent both

# Continue without MCP registration
bash ./frontend-codex-kit/install.sh --agent codex --skip-mcp
```

## Codex config safety

Windows `auto` mode writes Codex config directly. It does not execute the
packaged `codex.exe`. The managed section is:

```toml
[mcp_servers.component-atlas]
command = "C:\\absolute\\stable\\path\\to\\node.exe"
args = ["C:\\absolute\\path\\to\\project-atlas\\packages\\mcp\\dist\\index.js", "--profile", "core"]
```

The helper:

- preserves unrelated comments, keys, and sections;
- creates `config.toml.project-atlas.bak` before changing an existing file;
- leaves a matching section byte-identical;
- refuses multiple, stale, or extended Atlas sections unless replacement is
  explicitly authorized with `-ForceMcpConfig` or `--force-mcp-config`;
- escapes Windows paths as TOML;
- resolves a stable Node installation, including active fnm installations;
- performs no config writes in `-DryRun` or `--dry-run`.

Outside Windows, `auto` first tries the supported Codex CLI. If that CLI already
has an entry named `component-atlas`, the installer preserves it because its
human-readable output is not a stable machine contract. Run the doctor to prove
the exact executable, entry path, and `--profile core`; use `config` mode when a
deterministic config comparison or replacement is required.

Restart Codex and open a new task after a config or skill change.

## Read-only doctor

The platform doctor checks the effective Codex installation without modifying
it. On Windows:

```powershell
.\frontend-codex-kit\doctor.ps1
```

On Arch Linux or CachyOS, use native Bash:

```sh
bash ./frontend-codex-kit/doctor.sh
```

On Ubuntu/macOS, the existing PowerShell 7 route remains available:

```sh
pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex
pwsh -NoProfile -File ./frontend-codex-kit/doctor.ps1
```

`link` creates a junction on Windows and a symbolic link on platforms that
support it. Use `-InstallMode copy` or `--install-mode copy` when links are
restricted. Config paths and the Atlas data root follow the current platform;
the doctor prints every resolved path without changing it.

It verifies Git, Node 24+, pnpm 11.x, CLI/MCP build artifacts, a live stdio
smoke of the six-tool core profile, current full copies of all three skills or
links that point exactly to the selected clone, their explicit-only metadata,
and the exact `component-atlas` config target plus `--profile core`. Every
failed check prints one recovery action and the script exits non-zero. Use `-AtlasRoot`,
`-CodexSkillsRoot`, or `-CodexConfigPath` on PowerShell, or `--atlas-root`,
`--codex-skills-root`, or `--codex-config-path` on Bash, to diagnose
non-default locations. `--skip-mcp-smoke` is the Bash equivalent of
`-SkipMcpSmoke`.

## Update and open the local GUI

Update an Arch Linux or CachyOS installation from the same stable clone:

```sh
cd /path/to/project-atlas
git pull --ff-only
bash ./frontend-codex-kit/install.sh --agent codex
bash ./frontend-codex-kit/doctor.sh
```

The installer is idempotent. Restart Codex and open a new task after an update.
To open the optional local GUI from that clone:

```sh
pnpm atlas
pnpm atlas -- "/home/user/dev/product-repository"
```

Keep the terminal open while the loopback viewer is running and press Ctrl+C
there to stop it.

## `AGENTS.md` migration safety

The installer removes only the obsolete text between:

```text
<!-- project-atlas:frontend-task:start -->
<!-- project-atlas:frontend-task:end -->
```

All other instructions are preserved. A missing block is a no-op; duplicate or
malformed markers are refused. Before removal it preserves the original beside
the file as `AGENTS.md.project-atlas.bak` (or a numbered variant). The installer
never adds global frontend routing. Invoke `$frontend-task` explicitly in the
task that needs it.

## Claude Code compatibility preview

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

On Arch Linux or CachyOS, use:

```sh
bash ./frontend-codex-kit/install.sh --agent claude
```

Claude registration uses its supported CLI to install a user-scoped stdio MCP
entry, and Claude discovers the copied/linked `SKILL.md` files from
`~/.claude/skills`. After installation, verify the effective entry and live
tools manually. First inspect the CLI entry:

```powershell
claude mcp get component-atlas
```

Then, inside Claude Code, inspect the live server and invoke the skill:

```text
/mcp
/frontend-task <task description>
```

The MCP entry must point to the stable Node executable, this Atlas clone's MCP
entry, and `--profile core`; `/mcp` must expose the six core tools. The installer
preserves an existing server with the same name, so inspect and replace a stale
entry explicitly rather than assuming the new clone is active.

This path shares Atlas context, receipts, and memory storage with Codex, but it
is best-effort compatibility, not end-to-end parity. Neither `doctor.ps1` nor
`doctor.sh` inspects Claude skills or `~/.claude.json`; the CI suite does not
run a Claude workflow, and the Codex `agents/openai.yaml` explicit-only policy
is not a Claude-specific enforcement mechanism. Invoke `/frontend-task`
deliberately. Configure Jira, Confluence, Figma, GitHub, and any other provider
capability separately in Claude Code.

## Recovery

- **Unknown installation state:** run `doctor.ps1` on Windows or `doctor.sh` on
  Arch/CachyOS first. Both are read-only and report the exact failing layer
  before reinstalling anything.
- **Packaged Codex executable error:** use the normal command or
  `-CodexMcpMode config` / `--codex-mcp-mode config`; neither invokes
  `codex mcp`.
- **MCP conflict:** compare the reported current and expected paths. Use
  `-ForceMcpConfig` or `--force-mcp-config` only after confirming the old
  section should be replaced.
- **Skills already exist elsewhere:** move/remove the conflicting destination
  explicitly or choose an approved override path.
- **Temporary MCP bypass:** use `-SkipMcp` or `--skip-mcp` and configure the
  server later through Codex Settings -> MCP servers.
- **fnm multishell path:** activate a real installed version, confirm `fnm
  current` and `fnm exec --using <version> node --version`, then rerun.

## Kit tests

```powershell
pnpm test:kit
```

Run the native Bash fixtures on Linux with:

```sh
pnpm test:kit:shell
```

The Windows/Ubuntu CI suite covers Codex config creation/preservation/backups/
conflicts, idempotency, platform paths, alternate `CODEX_HOME`, and the
PowerShell kit. Ubuntu and a dedicated Arch Linux container also cover native
Bash dry-run, paths with spaces, real temporary links and copies, safe
conflicts, managed `AGENTS.md`, direct config registration, CLI preservation,
and CLI-to-config fallback. The Arch job also installs the distribution's Git,
Node 24 LTS, pnpm, and Codex packages, builds the real product through the
installer, registers its MCP entry, and runs the live doctor.
Doctor fixtures exercise a live healthy core-profile smoke plus broken installs
and verify that no doctor run changes any fixture hash.
Claude CLI registration, Claude skill invocation, and a provider-backed Claude
workflow are not exercised by this suite.

See the [first-run checklist](FIRST-RUN-CHECKLIST.md) for validation against a
real product repository.
