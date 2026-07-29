[CmdletBinding()]
param(
  [string]$AtlasRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [ValidateSet("codex", "claude", "both")]
  [string]$Agent = "both",
  [ValidateSet("link", "copy")]
  [string]$InstallMode = "link",
  [string]$CodexSkillsRoot = (Join-Path $HOME ".agents\skills"),
  [string]$ClaudeSkillsRoot = (Join-Path $HOME ".claude\skills"),
  [switch]$InstallAgentsInstructions,
  [string]$CodexAgentsPath = (Join-Path $HOME ".codex\AGENTS.md"),
  [switch]$SkipDependencies,
  [switch]$SkipBuild,
  [switch]$SkipMcp,
  [ValidateSet("auto", "config", "cli")]
  [string]$CodexMcpMode = "auto",
  [switch]$ForceMcpConfig,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "[frontend-codex-kit] $Message"
}

function Require-Command([string]$Name, [string]$Guidance) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name is required. $Guidance"
  }
  return $command.Source
}

function Test-NodeExecutable([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate)) {
    return $false
  }
  try {
    $version = (& $Candidate --version 2>$null | Select-Object -First 1)
    return [bool]($version -match "^v\d+\.\d+\.\d+")
  } catch {
    return $false
  }
}

function Resolve-StableNode {
  $resolved = Require-Command "node" "Install Node.js 24 or newer."
  $runningOnWindows = ($env:OS -eq "Windows_NT") -or [bool]$IsWindows
  if (-not $runningOnWindows) {
    return [System.IO.Path]::GetFullPath($resolved)
  }

  $fnm = Get-Command "fnm" -ErrorAction SilentlyContinue
  if ($fnm) {
    $activeVersion = (& $fnm.Source current 2>$null | Select-Object -First 1)
    if ($activeVersion) {
      $activeVersion = $activeVersion.Trim()
      $fnmRoots = @(
        $env:FNM_DIR,
        (Join-Path $env:APPDATA "fnm"),
        (Join-Path $env:LOCALAPPDATA "fnm")
      ) | Where-Object { $_ } | Select-Object -Unique
      foreach ($root in $fnmRoots) {
        $candidate = Join-Path $root (
          "node-versions\$activeVersion\installation\node.exe"
        )
        if (Test-NodeExecutable $candidate) {
          return [System.IO.Path]::GetFullPath($candidate)
        }
      }

      try {
        $fnmNodes = & $fnm.Source exec --using $activeVersion where.exe node 2>$null
        foreach ($candidate in @($fnmNodes)) {
          if (
            $candidate -and
            $candidate -notmatch "[\\/]fnm_multishells[\\/]" -and
            (Test-NodeExecutable $candidate)
          ) {
            return [System.IO.Path]::GetFullPath($candidate)
          }
        }
      } catch {
        # Fall through to the validated node resolved from PATH.
      }
    }
  }

  $resolved = [System.IO.Path]::GetFullPath($resolved)
  if ($resolved -match "[\\/]fnm_multishells[\\/]") {
    throw "Node resolves to an ephemeral fnm multishell path ($resolved). Set FNM_DIR or activate an installed fnm version, then rerun."
  }
  if (-not (Test-NodeExecutable $resolved)) {
    throw "The resolved Node executable is not usable: $resolved"
  }
  return $resolved
}

function Resolve-CodexConfigPath {
  $codexRoot = if ($env:CODEX_HOME) {
    [System.IO.Path]::GetFullPath($env:CODEX_HOME)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $HOME ".codex"))
  }
  return Join-Path $codexRoot "config.toml"
}

function Invoke-Native(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$Description
) {
  if ($DryRun) {
    Write-Step "DRY RUN: $Description"
    Write-Host "  $Executable $($Arguments -join ' ')"
    return
  }
  Write-Step $Description
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Resolve-LinkTarget([System.IO.FileSystemInfo]$Item) {
  if (-not $Item.Target) {
    return $null
  }
  $candidate = @($Item.Target)[0]
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $candidate = Join-Path $Item.DirectoryName $candidate
  }
  return [System.IO.Path]::GetFullPath($candidate).TrimEnd("\", "/")
}

function Install-Skill([string]$Source, [string]$TargetRoot) {
  $name = Split-Path $Source -Leaf
  $target = Join-Path $TargetRoot $name
  $normalizedSource = [System.IO.Path]::GetFullPath($Source).TrimEnd("\", "/")

  if (Test-Path -LiteralPath $target) {
    $item = Get-Item -LiteralPath $target -Force
    $linkTarget = Resolve-LinkTarget $item
    if ($linkTarget -and $linkTarget -ieq $normalizedSource) {
      Write-Step "$name is already linked at $target"
      return
    }
    throw "Refusing to overwrite existing skill at $target. Move or remove it explicitly, then rerun the installer."
  }

  if ($DryRun) {
    Write-Step "DRY RUN: install $name at $target using $InstallMode"
    return
  }

  New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
  if ($InstallMode -eq "copy") {
    Copy-Item -LiteralPath $Source -Destination $target -Recurse
  } elseif ($IsWindows -or $env:OS -eq "Windows_NT") {
    New-Item -ItemType Junction -Path $target -Target $Source | Out-Null
  } else {
    New-Item -ItemType SymbolicLink -Path $target -Target $Source | Out-Null
  }
  Write-Step "Installed $name at $target"
}

function Ensure-McpCli(
  [string]$Client,
  [string]$ClientExecutable,
  [string]$NodeExecutable,
  [string]$McpEntry
) {
  if ($DryRun) {
    if ($Client -eq "codex") {
      Invoke-Native $ClientExecutable @(
        "mcp", "add", "component-atlas", "--", $NodeExecutable, $McpEntry
      ) "register Project Atlas MCP for Codex"
    } else {
      Invoke-Native $ClientExecutable @(
        "mcp", "add", "--scope", "user", "component-atlas", "--",
        $NodeExecutable, $McpEntry
      ) "register Project Atlas MCP for Claude Code"
    }
    return
  }

  & $ClientExecutable mcp get component-atlas
  if ($LASTEXITCODE -eq 0) {
    Write-Step "$Client already has an MCP server named component-atlas; preserving it."
    Write-Step "Run '$Client mcp get component-atlas' and replace it manually if its path is stale."
    return
  }

  if ($Client -eq "codex") {
    Invoke-Native $ClientExecutable @(
      "mcp", "add", "component-atlas", "--", $NodeExecutable, $McpEntry
    ) "register Project Atlas MCP for Codex"
  } else {
    Invoke-Native $ClientExecutable @(
      "mcp", "add", "--scope", "user", "component-atlas", "--",
      $NodeExecutable, $McpEntry
    ) "register Project Atlas MCP for Claude Code"
  }
}

function Ensure-CodexMcpConfig(
  [string]$NodeExecutable,
  [string]$McpEntry,
  [string]$Helper
) {
  $configPath = Resolve-CodexConfigPath
  $arguments = @(
    $Helper,
    "--config", $configPath,
    "--node", $NodeExecutable,
    "--entry", $McpEntry
  )
  if ($ForceMcpConfig) {
    $arguments += "--force"
  }
  if ($DryRun) {
    $arguments += "--dry-run"
  }

  Write-Step "register Project Atlas MCP in Codex config"
  & $NodeExecutable @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Codex MCP config registration failed with exit code $LASTEXITCODE."
  }
  Write-Step "Codex reads this shared config after an app restart or new task."
}

$AtlasRoot = [System.IO.Path]::GetFullPath($AtlasRoot)
$packageJson = Join-Path $AtlasRoot "package.json"
$frontendTask = Join-Path $AtlasRoot "skills\frontend-task"
$reuseFirst = Join-Path $AtlasRoot "skills\reuse-first"
$mcpEntry = Join-Path $AtlasRoot "packages\mcp\dist\index.js"
$cliEntry = Join-Path $AtlasRoot "packages\cli\dist\index.js"
$agentsInstaller = Join-Path $AtlasRoot "frontend-codex-kit\install-agents-instructions.ps1"
$agentsBlock = Join-Path $AtlasRoot "frontend-codex-kit\templates\AGENTS.frontend-task.block.md"
$codexMcpHelper = Join-Path $AtlasRoot "frontend-codex-kit\register-codex-mcp.mjs"

foreach ($requiredPath in @(
  $packageJson,
  $frontendTask,
  $reuseFirst,
  $codexMcpHelper
)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "AtlasRoot does not contain the expected kit file: $requiredPath"
  }
}

$node = Resolve-StableNode
$nodeVersion = (& $node --version).TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 24) {
  throw "Node.js 24 or newer is required; found $nodeVersion."
}
$pnpm = $null
if (-not $SkipDependencies -or -not $SkipBuild) {
  $pnpm = Require-Command "pnpm" "Install pnpm 11 or enable it through Corepack."
}
$git = Require-Command "git" "Install Git before running the kit."
$codexClient = $null
$claudeClient = $null
if (-not $SkipMcp -and $Agent -in @("codex", "both")) {
  if ($CodexMcpMode -eq "cli") {
    $codexClient = Require-Command "codex" "Install or open Codex, or use -CodexMcpMode config."
  } elseif ($CodexMcpMode -eq "auto" -and $env:OS -ne "Windows_NT") {
    $codexClient = (Get-Command "codex" -ErrorAction SilentlyContinue).Source
  }
}
if (-not $SkipMcp -and $Agent -in @("claude", "both")) {
  $claudeClient = Require-Command "claude" "Install Claude Code, then rerun with -Agent claude."
}

Write-Step "Atlas root: $AtlasRoot"
Write-Step "Node $nodeVersion; Git $(& $git --version)"

if (-not $SkipDependencies) {
  Invoke-Native $pnpm @("install", "--frozen-lockfile") "install workspace dependencies"
}
if (-not $SkipBuild) {
  Invoke-Native $pnpm @("build") "build Project Atlas packages and local product"
}

if (-not $DryRun -and -not (Test-Path -LiteralPath $cliEntry)) {
  throw "Atlas CLI build is missing at $cliEntry."
}
Invoke-Native $node @($cliEntry, "setup") "globally ignore .component-atlas artifacts"

if ($Agent -in @("codex", "both")) {
  Install-Skill $frontendTask $CodexSkillsRoot
  Install-Skill $reuseFirst $CodexSkillsRoot
  if ($InstallAgentsInstructions) {
    & $agentsInstaller `
      -TargetPath $CodexAgentsPath `
      -BlockPath $agentsBlock `
      -DryRun:$DryRun
  }
}
if ($Agent -in @("claude", "both")) {
  Install-Skill $frontendTask $ClaudeSkillsRoot
  Install-Skill $reuseFirst $ClaudeSkillsRoot
}

if (-not $SkipMcp) {
  if (-not $DryRun -and -not (Test-Path -LiteralPath $mcpEntry)) {
    throw "Atlas MCP build is missing at $mcpEntry."
  }
  if ($Agent -in @("codex", "both")) {
    $useConfig = $CodexMcpMode -eq "config" -or (
      $CodexMcpMode -eq "auto" -and $env:OS -eq "Windows_NT"
    )
    if ($useConfig) {
      Ensure-CodexMcpConfig $node $mcpEntry $codexMcpHelper
    } elseif ($CodexMcpMode -eq "cli") {
      Ensure-McpCli "codex" $codexClient $node $mcpEntry
    } elseif ($codexClient) {
      try {
        Ensure-McpCli "codex" $codexClient $node $mcpEntry
      } catch {
        Write-Step "Codex CLI registration failed; falling back to config.toml."
        Ensure-CodexMcpConfig $node $mcpEntry $codexMcpHelper
      }
    } else {
      Ensure-CodexMcpConfig $node $mcpEntry $codexMcpHelper
    }
  }
  if ($Agent -in @("claude", "both")) {
    Ensure-McpCli "claude" $claudeClient $node $mcpEntry
  }
}

Write-Step "Installation complete."
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Restart the agent and open a new task/session."
Write-Host "  2. Open the product repository in your agent."
Write-Host "  3. Invoke `$frontend-task in Codex or /frontend-task in Claude Code."
Write-Host "  4. Describe the task; the skill handles Atlas bootstrap and compact retrieval."
Write-Host "  5. Connect Jira, Confluence, or Figma only when the task needs them."
Write-Host "  6. Optional local product: from $AtlasRoot run 'pnpm atlas'."
