$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) (
  "project-atlas-agents-" + [guid]::NewGuid().ToString("N")
)
$target = Join-Path $root ".codex\AGENTS.md"
$dryRunTarget = Join-Path $root "dry-run\.codex\AGENTS.md"
$malformedTarget = Join-Path $root "malformed\.codex\AGENTS.md"
$migration = Join-Path $PSScriptRoot "remove-agents-instructions.ps1"
$skillManifest = Join-Path $PSScriptRoot "..\skills\frontend-task\agents\openai.yaml"
$skillDefinition = Join-Path $PSScriptRoot "..\skills\frontend-task\SKILL.md"
$installer = Join-Path $PSScriptRoot "install.ps1"

try {
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) |
    Out-Null
  [System.IO.File]::WriteAllText(
    $target,
    "# Existing instructions`r`n`r`nKeep this text.`r`n`r`n<!-- project-atlas:frontend-task:start -->`r`nFor frontend work, use `frontend-task` when available.`r`n<!-- project-atlas:frontend-task:end -->`r`n`r`nKeep this too.`r`n",
    [System.Text.UTF8Encoding]::new($false)
  )

  & $migration -TargetPath $target
  $first = [System.IO.File]::ReadAllText($target)
  if (-not $first.Contains("# Existing instructions") -or
      -not $first.Contains("Keep this text.") -or
      -not $first.Contains("Keep this too.")) {
    throw "Existing AGENTS.md content was not preserved."
  }
  if ($first.Contains("project-atlas:frontend-task")) {
    throw "Legacy Atlas routing block was not removed."
  }
  & $migration -TargetPath $target
  $second = [System.IO.File]::ReadAllText($target)
  if ($first -cne $second) {
    throw "Managed block removal is not idempotent."
  }

  & $migration -TargetPath $dryRunTarget -DryRun
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
    & $migration -TargetPath $malformedTarget
  } catch {
    $refusedMalformed = $true
  }
  if (-not $refusedMalformed) {
    throw "Malformed managed markers were not refused."
  }

  $manifest = [System.IO.File]::ReadAllText((Resolve-Path $skillManifest))
  $definition = [System.IO.File]::ReadAllText((Resolve-Path $skillDefinition))
  $installerSource = [System.IO.File]::ReadAllText((Resolve-Path $installer))
  if ($manifest -notmatch "allow_implicit_invocation:\s*false") {
    throw "A generic frontend prompt could still activate frontend-task implicitly."
  }
  if ($definition -notmatch 'Invoke only when the user writes `\$frontend-task`') {
    throw "The explicit frontend-task activation contract is missing."
  }
  if ($installerSource.Contains('For frontend work, use `frontend-task`')) {
    throw "The installer still writes the obsolete global frontend routing rule."
  }

  Write-Host "Explicit skill activation and AGENTS.md migration tests passed."
} finally {
  if (Test-Path -LiteralPath $root) {
    [System.IO.Directory]::Delete($root, $true)
  }
}
