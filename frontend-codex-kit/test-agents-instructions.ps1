$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) (
  "project-atlas-agents-" + [guid]::NewGuid().ToString("N")
)
$target = Join-Path $root ".codex\AGENTS.md"
$emptyTarget = Join-Path $root "empty\.codex\AGENTS.md"
$dryRunTarget = Join-Path $root "dry-run\.codex\AGENTS.md"
$malformedTarget = Join-Path $root "malformed\.codex\AGENTS.md"
$installer = Join-Path $PSScriptRoot "install-agents-instructions.ps1"
$block = Join-Path $PSScriptRoot "templates\AGENTS.frontend-task.block.md"

try {
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) |
    Out-Null
  [System.IO.File]::WriteAllText(
    $target,
    "# Existing instructions`r`n`r`nKeep this text.`r`n",
    [System.Text.UTF8Encoding]::new($false)
  )

  & $installer -TargetPath $target -BlockPath $block
  $first = [System.IO.File]::ReadAllText($target)
  if (-not $first.Contains("# Existing instructions") -or
      -not $first.Contains("Keep this text.")) {
    throw "Existing AGENTS.md content was not preserved."
  }
  & $installer -TargetPath $target -BlockPath $block
  $second = [System.IO.File]::ReadAllText($target)
  if ($first -cne $second) {
    throw "Managed block installation is not idempotent."
  }
  if (([regex]::Matches(
        $second,
        "<!-- project-atlas:frontend-task:start -->"
      )).Count -ne 1) {
    throw "Managed block was duplicated."
  }

  & $installer -TargetPath $emptyTarget -BlockPath $block
  if (-not (Test-Path -LiteralPath $emptyTarget)) {
    throw "Missing AGENTS.md was not created."
  }
  & $installer -TargetPath $dryRunTarget -BlockPath $block -DryRun
  if (Test-Path -LiteralPath $dryRunTarget) {
    throw "Dry run changed the target filesystem."
  }

  New-Item -ItemType Directory -Force -Path (
    Split-Path $malformedTarget -Parent
  ) | Out-Null
  [System.IO.File]::WriteAllText(
    $malformedTarget,
    "<!-- project-atlas:frontend-task:start -->`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $refusedMalformed = $false
  try {
    & $installer -TargetPath $malformedTarget -BlockPath $block
  } catch {
    $refusedMalformed = $true
  }
  if (-not $refusedMalformed) {
    throw "Malformed managed markers were not refused."
  }

  Write-Host "AGENTS.md managed-block tests passed."
} finally {
  if (Test-Path -LiteralPath $root) {
    [System.IO.Directory]::Delete($root, $true)
  }
}
