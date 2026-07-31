[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$startMarker = "<!-- project-atlas:frontend-task:start -->"
$endMarker = "<!-- project-atlas:frontend-task:end -->"
$absoluteTarget = [System.IO.Path]::GetFullPath($TargetPath)

if (-not (Test-Path -LiteralPath $absoluteTarget)) {
  Write-Host "[frontend-codex-kit] No legacy Atlas AGENTS.md block to migrate."
  return
}

$existing = [System.IO.File]::ReadAllText($absoluteTarget)
$starts = ([regex]::Matches($existing, [regex]::Escape($startMarker))).Count
$ends = ([regex]::Matches($existing, [regex]::Escape($endMarker))).Count
if ($starts -ne $ends -or $starts -gt 1) {
  throw "Refusing to edit $absoluteTarget because its Atlas markers are malformed or duplicated."
}
if ($starts -eq 0) {
  Write-Host "[frontend-codex-kit] No legacy Atlas AGENTS.md block to migrate."
  return
}

$start = $existing.IndexOf($startMarker, [System.StringComparison]::Ordinal)
$end = $existing.IndexOf($endMarker, $start, [System.StringComparison]::Ordinal)
$end += $endMarker.Length
if ($end -lt $existing.Length -and $existing[$end] -eq "`r") { $end += 1 }
if ($end -lt $existing.Length -and $existing[$end] -eq "`n") { $end += 1 }
$next = $existing.Remove($start, $end - $start)

if ($DryRun) {
  Write-Host "[frontend-codex-kit] DRY RUN: remove legacy Atlas routing block from $absoluteTarget"
  return
}

[System.IO.File]::WriteAllText(
  $absoluteTarget,
  $next,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "[frontend-codex-kit] Removed legacy Atlas routing block from $absoluteTarget"
