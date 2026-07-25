[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,
  [string]$BlockPath = (Join-Path $PSScriptRoot "templates\AGENTS.frontend-task.block.md"),
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$startMarker = "<!-- project-atlas:frontend-task:start -->"
$endMarker = "<!-- project-atlas:frontend-task:end -->"

if (-not (Test-Path -LiteralPath $BlockPath)) {
  throw "Managed instruction block not found at $BlockPath."
}

$block = [System.IO.File]::ReadAllText(
  [System.IO.Path]::GetFullPath($BlockPath)
).Trim()
$startCount = ([regex]::Matches($block, [regex]::Escape($startMarker))).Count
$endCount = ([regex]::Matches($block, [regex]::Escape($endMarker))).Count
if ($startCount -ne 1 -or $endCount -ne 1) {
  throw "Managed instruction template must contain exactly one marker pair."
}

$absoluteTarget = [System.IO.Path]::GetFullPath($TargetPath)
$existing = if (Test-Path -LiteralPath $absoluteTarget) {
  [System.IO.File]::ReadAllText($absoluteTarget)
} else {
  ""
}
$existingStarts = ([regex]::Matches(
  $existing,
  [regex]::Escape($startMarker)
)).Count
$existingEnds = ([regex]::Matches(
  $existing,
  [regex]::Escape($endMarker)
)).Count
if ($existingStarts -ne $existingEnds -or $existingStarts -gt 1) {
  throw "Refusing to edit $absoluteTarget because its managed markers are malformed or duplicated."
}

$newline = if ($existing.Contains("`r`n")) { "`r`n" } else { "`n" }
$normalizedBlock = $block -replace "`r?`n", $newline
if ($existingStarts -eq 1) {
  $pattern =
    "(?s)$([regex]::Escape($startMarker)).*?$([regex]::Escape($endMarker))"
  $next = [regex]::Replace($existing, $pattern, $normalizedBlock, 1)
} elseif ($existing.Length -eq 0) {
  $next = "$normalizedBlock$newline"
} else {
  $next = "$($existing.TrimEnd())$newline$newline$normalizedBlock$newline"
}

if ($next -ceq $existing) {
  Write-Host "[frontend-codex-kit] Managed AGENTS.md block is already current."
  return
}
if ($DryRun) {
  Write-Host "[frontend-codex-kit] DRY RUN: update managed block in $absoluteTarget"
  return
}

$parent = Split-Path $absoluteTarget -Parent
if ($parent) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
[System.IO.File]::WriteAllText(
  $absoluteTarget,
  $next,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "[frontend-codex-kit] Updated managed AGENTS.md block at $absoluteTarget"
