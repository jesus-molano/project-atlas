[CmdletBinding()]
param(
  [string]$AtlasRoot = "",
  [string]$CodexSkillsRoot = (Join-Path $HOME ".agents/skills"),
  [string]$CodexConfigPath = "",
  [switch]$SkipMcpSmoke
)

$ErrorActionPreference = "Stop"
$script:DoctorFailures = 0
$nodeRuntimeHelper = Join-Path $PSScriptRoot "node-runtime.ps1"
if (-not (Test-Path -LiteralPath $nodeRuntimeHelper -PathType Leaf)) {
  throw "The shared Node runtime helper is missing: $nodeRuntimeHelper"
}
. $nodeRuntimeHelper

function Write-DoctorCheck(
  [bool]$Passed,
  [string]$Name,
  [string]$Detail,
  [string]$Fix
) {
  if ($Passed) {
    Write-Host "[PASS] $Name - $Detail"
    return
  }

  $script:DoctorFailures += 1
  Write-Host "[FAIL] $Name - $Detail"
  if ($Fix) {
    Write-Host "       Fix: $Fix"
  }
}

function Resolve-DoctorCodexConfigPath {
  if ($CodexConfigPath) {
    return [System.IO.Path]::GetFullPath($CodexConfigPath)
  }
  $codexRoot = if ($env:CODEX_HOME) {
    [System.IO.Path]::GetFullPath($env:CODEX_HOME)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $HOME ".codex"))
  }
  return Join-Path $codexRoot "config.toml"
}

function Get-CommandVersion(
  [string]$Name,
  [string[]]$Arguments
) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    return $null
  }
  try {
    $value = (& $command.Source @Arguments 2>$null | Select-Object -First 1)
    return @{
      Path = $command.Source
      Value = [string]$value
    }
  } catch {
    return $null
  }
}

function Get-DoctorSkillContentFingerprint([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    return $null
  }
  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\", "/")
  $entries = Get-ChildItem -LiteralPath $normalizedRoot -Recurse -File -Force |
    ForEach-Object {
      $relative = ($_.FullName.Substring($normalizedRoot.Length)).TrimStart(
        "\", "/"
      ).Replace("\", "/")
      $digest = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      "$relative|$digest"
    } |
    Sort-Object
  $manifest = $entries -join "`n"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($manifest)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace("-", "")
  } finally {
    $hasher.Dispose()
  }
}

function Resolve-DoctorLinkTarget([System.IO.FileSystemInfo]$Item) {
  if (-not $Item.Target) {
    return $null
  }
  $candidate = @($Item.Target)[0]
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $candidate = Join-Path (Split-Path $Item.FullName -Parent) $candidate
  }
  return [System.IO.Path]::GetFullPath($candidate).TrimEnd("\", "/")
}

function Test-DoctorPathEqual([string]$Left, [string]$Right) {
  if (-not $Left -or -not $Right) {
    return $false
  }
  if ($env:OS -eq "Windows_NT") {
    return $Left -ieq $Right
  }
  return $Left -ceq $Right
}

$AtlasRoot = if ($AtlasRoot) {
  [System.IO.Path]::GetFullPath($AtlasRoot)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}
$resolvedConfig = Resolve-DoctorCodexConfigPath
$packageJson = Join-Path $AtlasRoot "package.json"
$mcpEntry = Join-Path $AtlasRoot "packages/mcp/dist/index.js"
$cliEntry = Join-Path $AtlasRoot "packages/cli/dist/index.js"
$configHelper = Join-Path $AtlasRoot "frontend-codex-kit/register-codex-mcp.mjs"
$smokeScript = Join-Path $AtlasRoot "frontend-codex-kit/smoke-core-mcp.mjs"
$installerCommand = if ($env:OS -eq "Windows_NT") {
  ".\frontend-codex-kit\install.ps1 -Agent codex"
} else {
  "pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex"
}

Write-Host "Project Atlas doctor (read-only)"
Write-Host "  Atlas:  $AtlasRoot"
Write-Host "  Config: $resolvedConfig"
Write-Host ""

Write-DoctorCheck `
  (Test-Path -LiteralPath $packageJson -PathType Leaf) `
  "Atlas clone" `
  "package.json at the selected root" `
  "Pass -AtlasRoot with the stable Project Atlas clone."

$git = Get-CommandVersion "git" @("--version")
Write-DoctorCheck `
  ([bool]$git) `
  "Git" `
  $(if ($git) { $git.Value } else { "command not found" }) `
  "Install Git and open a new PowerShell session."

$node = $null
$nodeResolutionError = ""
try {
  $stableNode = Resolve-AtlasStableNode
  $node = @{
    Path = $stableNode
    Value = [string](& $stableNode --version 2>$null | Select-Object -First 1)
  }
} catch {
  $nodeResolutionError = $_.Exception.Message
}
$nodeMajor = 0
if ($node -and $node.Value -match "^v?(\d+)\.") {
  $nodeMajor = [int]$Matches[1]
}
$nodeDetail = if ($node) {
  "$($node.Value) at $($node.Path)"
} elseif ($nodeResolutionError) {
  $nodeResolutionError
} else {
  "command not found"
}
Write-DoctorCheck `
  ([bool]$node -and $nodeMajor -ge 24) `
  "Node.js" `
  $nodeDetail `
  "Install or activate Node.js 24+; avoid an ephemeral fnm multishell path."

$pnpm = Get-CommandVersion "pnpm" @("--version")
$pnpmMajor = 0
if ($pnpm -and $pnpm.Value -match "^(\d+)\.") {
  $pnpmMajor = [int]$Matches[1]
}
Write-DoctorCheck `
  ([bool]$pnpm -and $pnpmMajor -eq 11) `
  "pnpm" `
  $(if ($pnpm) { $pnpm.Value } else { "command not found" }) `
  "Install pnpm 11.x or enable the repository version through Corepack."

Write-DoctorCheck `
  (Test-Path -LiteralPath $mcpEntry -PathType Leaf) `
  "MCP build" `
  $mcpEntry `
  "Run $installerCommand from this clone without -SkipBuild."

Write-DoctorCheck `
  (Test-Path -LiteralPath $cliEntry -PathType Leaf) `
  "CLI build" `
  $cliEntry `
  "Run $installerCommand from this clone without -SkipBuild."

if (-not $SkipMcpSmoke) {
  $smokePassed = $false
  $smokeDetail = "Node.js, the smoke script, or the MCP build is unavailable"
  if (
    $node -and
    (Test-Path -LiteralPath $smokeScript -PathType Leaf) -and
    (Test-Path -LiteralPath $mcpEntry -PathType Leaf)
  ) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $smokeOutput = @(& $node.Path $smokeScript $mcpEntry 2>&1)
      $smokeExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    $smokeDetail = ($smokeOutput -join "`n").Trim()
    $smokePassed = $smokeExit -eq 0 -and $smokeDetail -match "Core MCP smoke passed"
  }
  Write-DoctorCheck `
    $smokePassed `
    "Core MCP runtime" `
    $smokeDetail `
    "Run pnpm build:packages, then rerun doctor.ps1."
}

foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
  $sourceManifest = Join-Path $AtlasRoot "skills/$skillName/SKILL.md"
  $sourceRoot = Split-Path $sourceManifest -Parent
  $installedRoot = Join-Path $CodexSkillsRoot $skillName
  $installedManifest = Join-Path $installedRoot "SKILL.md"
  $installedMetadata = Join-Path $installedRoot "agents/openai.yaml"
  $installed = $false
  $sourceAvailable = $false
  $matchesSource = $false
  $linkTarget = $null
  $skillInspectionError = ""
  try {
    $installed = Test-Path -LiteralPath $installedManifest -PathType Leaf
    $sourceAvailable = Test-Path -LiteralPath $sourceManifest -PathType Leaf
    if ($installed -and $sourceAvailable) {
      $installedItem = Get-Item -LiteralPath $installedRoot -Force
      $linkTarget = Resolve-DoctorLinkTarget $installedItem
      $matchesSource = if ($linkTarget) {
        Test-DoctorPathEqual `
          $linkTarget `
          ([System.IO.Path]::GetFullPath($sourceRoot).TrimEnd("\", "/"))
      } else {
        (Get-DoctorSkillContentFingerprint $sourceRoot) -ceq
          (Get-DoctorSkillContentFingerprint $installedRoot)
      }
    }
  } catch {
    $skillInspectionError = $_.Exception.Message
  }
  $skillDetail = if ($skillInspectionError) {
    "inspection failed: $skillInspectionError"
  } elseif (-not $sourceAvailable) {
    "source skill is missing from the selected clone at $sourceRoot"
  } elseif (-not $installed) {
    "missing at $installedRoot"
  } elseif ($linkTarget -and -not $matchesSource) {
    "link points to $linkTarget instead of this clone at $sourceRoot"
  } elseif (-not $matchesSource) {
    "installed copy has stale references, scripts, metadata, or manifest"
  } else {
    "installed and current"
  }
  Write-DoctorCheck `
    ($installed -and $matchesSource) `
    "Skill $skillName" `
    $skillDetail `
    "Move a conflicting destination if present, then run $installerCommand."

  $expectedImplicit = if ($skillName -eq "frontend-task") { "true" } else { "false" }
  $expectedPolicyDetail = if ($skillName -eq "frontend-task") {
    "automatic-selective"
  } else {
    "explicit-only"
  }
  $policyReady = $false
  $policyInspectionError = ""
  try {
    if (Test-Path -LiteralPath $installedMetadata -PathType Leaf) {
      $policyReady = [bool](Select-String `
        -LiteralPath $installedMetadata `
        -Pattern "^\s*allow_implicit_invocation:\s*$expectedImplicit\s*$" `
        -Quiet)
    }
  } catch {
    $policyInspectionError = $_.Exception.Message
  }
  $policyDetail = if ($policyReady) {
    $expectedPolicyDetail
  } elseif ($policyInspectionError) {
    "inspection failed: $policyInspectionError"
  } else {
    "expected allow_implicit_invocation: $expectedImplicit"
  }
  Write-DoctorCheck `
    $policyReady `
    "Skill policy $skillName" `
    $policyDetail `
    "Run $installerCommand from the current Atlas clone."
}

$configReady = $false
$configDetail = "config or helper unavailable"
if (
  $node -and
  (Test-Path -LiteralPath $resolvedConfig -PathType Leaf) -and
  (Test-Path -LiteralPath $configHelper -PathType Leaf) -and
  (Test-Path -LiteralPath $mcpEntry -PathType Leaf)
) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $configOutput = @(& $node.Path @(
      $configHelper,
      "--config", $resolvedConfig,
      "--node", $node.Path,
      "--entry", $mcpEntry,
      "--dry-run"
    ) 2>&1)
    $configExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $configText = $configOutput -join "`n"
  $configReady = $configExit -eq 0 -and $configText -match "Already configured"
  $configDetail = if ($configReady) {
    "component-atlas points to this clone with --profile core"
  } elseif ($configExit -ne 0) {
    "the managed section conflicts with the expected command or arguments:`n$configText"
  } else {
    "the expected component-atlas core section is not active:`n$configText"
  }
}
Write-DoctorCheck `
  $configReady `
  "Codex MCP config" `
  $configDetail `
  "Review $resolvedConfig, then run $installerCommand; append -ForceMcpConfig only after confirming replacement is intentional."

Write-Host ""
if ($script:DoctorFailures -gt 0) {
  Write-Host "Doctor found $($script:DoctorFailures) failed check(s). No files were changed."
  exit 1
}

Write-Host "All checks passed. Restart Codex and open a new task if installation changed."
exit 0
