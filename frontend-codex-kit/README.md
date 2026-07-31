# Frontend Codex Kit reference

This folder contains the portable installer for Project Atlas and its three
skills. New users should follow the
[five-minute quick start](../README.md). This page
documents installer behavior and recovery flags.

## Recommended command

Requirements are Git, Node.js 24+, pnpm 11.x, and PowerShell 7 (`pwsh`) on
Linux/macOS. Windows PowerShell 5.1 and PowerShell 7 are both supported.

From a stable Project Atlas clone on Windows:

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

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
| Legacy routing migration | `~/.codex/AGENTS.md` (marked Atlas block removed only) |
| All durable Atlas project data | Windows: `%LOCALAPPDATA%\ProjectAtlas\`; macOS: `~/Library/Application Support/ProjectAtlas/`; Linux: `${XDG_DATA_HOME:-~/.local/share}/ProjectAtlas/` |
| Ephemeral assets/previews | `<platform Atlas storage root>/temp/` |

The product repository is not modified merely by installing or querying Atlas.
Legacy repository-local memory remains read-only compatibility evidence.

## Installer flags

| Flag | Purpose |
| --- | --- |
| `-Agent codex|claude|both` | Select clients |
| `-InstallMode link|copy` | Link skills by default or copy them |
| `-CodexMcpMode auto|config|cli` | Select Codex MCP registration route |
| `-ForceMcpConfig` | Replace a conflicting Atlas section after review |
| `-SkipMcp` | Install without MCP registration |
| `-DryRun` | Resolve and print exact actions without writing |
| `-SkipDependencies` | Reuse installed workspace dependencies |
| `-SkipBuild` | Reuse existing package and GUI builds |
| `-CodexSkillsRoot` | Override Codex skill destination |
| `-ClaudeSkillsRoot` | Override Claude skill destination |
| `-CodexAgentsPath` | Override the managed Codex instruction file |

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
  explicitly authorized with `-ForceMcpConfig`;
- escapes Windows paths as TOML;
- resolves a stable Node installation, including active fnm installations;
- performs no config writes in `-DryRun`.

Outside Windows, `auto` first tries the supported Codex CLI. If that CLI already
has an entry named `component-atlas`, the installer preserves it because its
human-readable output is not a stable machine contract. Run the doctor to prove
the exact executable, entry path, and `--profile core`; use `config` mode when a
deterministic config comparison or replacement is required.

Restart Codex and open a new task after a config or skill change.

## Read-only doctor

`doctor.ps1` checks the effective Codex installation without modifying it:

```powershell
.\frontend-codex-kit\doctor.ps1
```

On Ubuntu/macOS, invoke the same scripts explicitly through PowerShell 7:

```sh
pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex
pwsh -NoProfile -File ./frontend-codex-kit/doctor.ps1
```

`link` creates a junction on Windows and a symbolic link on platforms that
support it. Use `-InstallMode copy` when links are restricted. Config paths and
the Atlas data root follow the current platform; the doctor prints every
resolved path without changing it.

It verifies Git, Node 24+, pnpm 11.x, CLI/MCP build artifacts, a live stdio
smoke of the six-tool core profile, current full copies of all three skills or
links that point exactly to the selected clone, their explicit-only metadata,
and the exact `component-atlas` config target plus `--profile core`. Every
failed check prints one recovery action and the script exits non-zero. Use `-AtlasRoot`,
`-CodexSkillsRoot`, or `-CodexConfigPath` to diagnose non-default locations.

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

## Claude Code

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

Claude registration uses its supported CLI. Invoke `/frontend-task` in a
product repository. The Atlas context and memory contracts are shared with
Codex.

## Recovery

- **Unknown installation state:** run `doctor.ps1` first. It is read-only and
  reports the exact failing layer before reinstalling anything.
- **Packaged Codex executable error:** use the normal command or
  `-CodexMcpMode config`; neither invokes `codex mcp`.
- **MCP conflict:** compare the reported current and expected paths. Use
  `-ForceMcpConfig` only after confirming the old section should be replaced.
- **Skills already exist elsewhere:** move/remove the conflicting destination
  explicitly or choose an approved override path.
- **Temporary MCP bypass:** use `-SkipMcp` and configure the server later
  through Codex Settings -> MCP servers.
- **fnm multishell path:** activate a real installed version, confirm `fnm
  current` and `fnm exec --using <version> node --version`, then rerun.

## Kit tests

```powershell
pnpm test:kit
```

The Windows/Ubuntu CI suite covers Codex config creation/preservation/backups/
conflicts, idempotency, platform paths, alternate `CODEX_HOME`, dry-run, real
temporary link/junction and copy installs, and managed `AGENTS.md` behavior.
Doctor fixtures exercise a live healthy core-profile smoke plus broken installs
and verify that no doctor run changes any fixture hash.

See the [first-run checklist](FIRST-RUN-CHECKLIST.md) for validation against a
real product repository.
