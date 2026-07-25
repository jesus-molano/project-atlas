[CmdletBinding()]
param(
  [string]$AtlasRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [ValidateSet("codex", "claude", "both")]
  [string]$Agent = "both",
  [ValidateSet("link", "copy")]
  [string]$InstallMode = "link",
  [string]$CodexSkillsRoot = (Join-Path $HOME ".agents\skills"),
  [string]$ClaudeSkillsRoot = (Join-Path $HOME ".claude\skills"),
  [switch]$SkipDependencies,
  [switch]$SkipBuild,
  [switch]$SkipMcp,
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

function Ensure-Mcp(
  [string]$Client,
  [string]$ClientExecutable,
  [string]$NodeExecutable,
  [string]$McpEntry
) {
  if ($DryRun) {
    if ($Client -eq "codex") {
      Invoke-Native $ClientExecutable @(
        "mcp", "add", "component-atlas", "--", $NodeExecutable, $McpEntry
      ) "register Component Atlas MCP for Codex"
    } else {
      Invoke-Native $ClientExecutable @(
        "mcp", "add", "--scope", "user", "component-atlas", "--",
        $NodeExecutable, $McpEntry
      ) "register Component Atlas MCP for Claude Code"
    }
    return
  }

  & $ClientExecutable mcp get component-atlas *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Step "$Client already has an MCP server named component-atlas; preserving it."
    Write-Step "Run '$Client mcp get component-atlas' and replace it manually if its path is stale."
    return
  }

  if ($Client -eq "codex") {
    Invoke-Native $ClientExecutable @(
      "mcp", "add", "component-atlas", "--", $NodeExecutable, $McpEntry
    ) "register Component Atlas MCP for Codex"
  } else {
    Invoke-Native $ClientExecutable @(
      "mcp", "add", "--scope", "user", "component-atlas", "--",
      $NodeExecutable, $McpEntry
    ) "register Component Atlas MCP for Claude Code"
  }
}

$AtlasRoot = [System.IO.Path]::GetFullPath($AtlasRoot)
$packageJson = Join-Path $AtlasRoot "package.json"
$frontendTask = Join-Path $AtlasRoot "skills\frontend-task"
$reuseFirst = Join-Path $AtlasRoot "skills\reuse-first"
$mcpEntry = Join-Path $AtlasRoot "packages\mcp\dist\index.js"
$cliEntry = Join-Path $AtlasRoot "packages\cli\dist\index.js"

foreach ($requiredPath in @($packageJson, $frontendTask, $reuseFirst)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "AtlasRoot does not contain the expected kit file: $requiredPath"
  }
}

$node = Require-Command "node" "Install Node.js 24 or newer."
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
  $codexClient = Require-Command "codex" "Install or open Codex, then rerun with -Agent codex."
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
  Invoke-Native $pnpm @("build:packages") "build Atlas CLI and MCP packages"
}

if (-not $DryRun -and -not (Test-Path -LiteralPath $cliEntry)) {
  throw "Atlas CLI build is missing at $cliEntry."
}
Invoke-Native $node @($cliEntry, "setup") "globally ignore .component-atlas artifacts"

if ($Agent -in @("codex", "both")) {
  Install-Skill $frontendTask $CodexSkillsRoot
  Install-Skill $reuseFirst $CodexSkillsRoot
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
    Ensure-Mcp "codex" $codexClient $node $mcpEntry
  }
  if ($Agent -in @("claude", "both")) {
    Ensure-Mcp "claude" $claudeClient $node $mcpEntry
  }
}

Write-Step "Installation complete."
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Open a new Codex task or Claude Code session."
Write-Host "  2. Scan a real repository with: node `"$cliEntry`" scan `"C:\path\to\repo`""
Write-Host "  3. Index allowed project memory with: node `"$cliEntry`" memory index `"C:\path\to\repo`""
Write-Host "  4. Invoke `$frontend-task in Codex or /frontend-task in Claude Code."
Write-Host "  5. Connect Jira, Confluence, or Figma only if the task actually has them."
