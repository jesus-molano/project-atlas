# Frontend Codex Kit reference

This folder contains the portable installer for Project Atlas and its two
skills. New users should follow the
[five-minute quick start](../README.md). This page
documents installer behavior and recovery flags.

## Recommended command

From a stable Project Atlas clone:

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions
```

The command:

- installs dependencies and builds the complete local Atlas product;
- installs `frontend-task` and `reuse-first`;
- adds/updates the optional marked routing block in Codex `AGENTS.md`;
- adds the local Project Atlas MCP server to Codex;
- adds `.component-atlas/` to the global Git ignore.

It does not install plugins, request credentials, connect accounts, or copy
corporate data.

## Installed locations

| Artifact | Default location |
| --- | --- |
| Codex skills | `~/.agents/skills/frontend-task` and `reuse-first` |
| Claude skills | `~/.claude/skills/frontend-task` and `reuse-first` |
| Codex MCP entry | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| Optional routing block | `~/.codex/AGENTS.md` |
| Reconstructible indexes | Windows LocalAppData |
| Product-local artifacts | `<product-repo>/.component-atlas/` |

The product repository is not modified merely by installing or querying Atlas.
Canonical `project-memory/` is opt-in and policy-dependent.

## Installer flags

| Flag | Purpose |
| --- | --- |
| `-Agent codex|claude|both` | Select clients |
| `-InstallAgentsInstructions` | Maintain the small marked Codex routing block |
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
.\frontend-codex-kit\install.ps1 -Agent both -InstallAgentsInstructions

# Continue without MCP registration
.\frontend-codex-kit\install.ps1 -Agent codex -SkipMcp
```

## Codex config safety

Windows `auto` mode writes Codex config directly. It does not execute the
packaged `codex.exe`. The managed section is:

```toml
[mcp_servers.component-atlas]
command = "C:\\absolute\\stable\\path\\to\\node.exe"
args = ["C:\\absolute\\path\\to\\project-atlas\\packages\\mcp\\dist\\index.js"]
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

Restart Codex and open a new task after a config or skill change.

## `AGENTS.md` safety

`-InstallAgentsInstructions` is opt-in. The installer manages only text between:

```text
<!-- project-atlas:frontend-task:start -->
<!-- project-atlas:frontend-task:end -->
```

All other instructions are preserved. Missing, duplicate, or malformed markers
are handled conservatively; malformed markers are refused.

The block only routes frontend tasks to `frontend-task` when available. It does
not tell Codex to install Atlas or external plugins automatically.

## Claude Code

```powershell
.\frontend-codex-kit\install.ps1 -Agent claude
```

Claude registration uses its supported CLI. Invoke `/frontend-task` in a
product repository. The Atlas context and memory contracts are shared with
Codex.

## Recovery

- **Packaged Codex executable error:** use the normal command or
  `-CodexMcpMode config`; neither invokes `codex mcp`.
- **MCP conflict:** compare the reported current and expected paths. Use
  `-ForceMcpConfig` only after confirming the old section should be replaced.
- **Skills already exist elsewhere:** move/remove the conflicting destination
  explicitly or choose an approved override path.
- **Temporary MCP bypass:** use `-SkipMcp` and configure the server later
  through Codex Settings → MCP servers.
- **fnm multishell path:** activate a real installed version and expose
  `FNM_DIR`, then rerun.

## Kit tests

```powershell
pnpm test:kit
```

The suite covers Codex config creation/preservation/backups/conflicts,
idempotency, Windows paths, alternate `CODEX_HOME`, dry-run, and managed
`AGENTS.md` behavior.

See the [first-run checklist](FIRST-RUN-CHECKLIST.md) for validation against a
real product repository.
