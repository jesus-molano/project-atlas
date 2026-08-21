$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) (
  "project-atlas-agents-" + [guid]::NewGuid().ToString("N")
)
$target = Join-Path $root ".codex/AGENTS.md"
$dryRunTarget = Join-Path $root "dry-run/.codex/AGENTS.md"
$malformedTarget = Join-Path $root "malformed/.codex/AGENTS.md"
$migration = Join-Path $PSScriptRoot "remove-agents-instructions.ps1"
$skillsRoot = Join-Path $PSScriptRoot "../skills"
$frontendTaskDefinition = Join-Path $skillsRoot "frontend-task/SKILL.md"
$installer = Join-Path $PSScriptRoot "install.ps1"

try {
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) |
    Out-Null
  [System.IO.File]::WriteAllText(
    $target,
    "# Existing instructions`r`n`r`nKeep this text.`r`n`r`n<!-- project-atlas:frontend-task:start -->`r`nFor frontend work, use `frontend-task` when available.`r`n<!-- project-atlas:frontend-task:end -->`r`n`r`nKeep this too.`r`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  $original = [System.IO.File]::ReadAllText($target)

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
  $backup = "$target.project-atlas.bak"
  if (-not (Test-Path -LiteralPath $backup -PathType Leaf) -or
      [System.IO.File]::ReadAllText($backup) -cne $original) {
    throw "AGENTS.md migration did not preserve an exact original backup."
  }
  & $migration -TargetPath $target
  $second = [System.IO.File]::ReadAllText($target)
  if ($first -cne $second) {
    throw "Managed block removal is not idempotent."
  }
  if (Test-Path -LiteralPath "$backup.1") {
    throw "Idempotent migration created an unnecessary second backup."
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
  if (Test-Path -LiteralPath "$malformedTarget.project-atlas.bak") {
    throw "Refused malformed markers still created a backup or mutation."
  }

  $frontendManifest = Join-Path $skillsRoot "frontend-task/agents/openai.yaml"
  $frontendPolicy = [System.IO.File]::ReadAllText(
    (Resolve-Path $frontendManifest)
  )
  if ($frontendPolicy -notmatch "allow_implicit_invocation:\s*true") {
    throw "frontend-task is not available for selective implicit activation."
  }
  foreach ($skillName in @("reuse-first", "visual-direction")) {
    $skillManifest = Join-Path $skillsRoot "$skillName/agents/openai.yaml"
    $manifest = [System.IO.File]::ReadAllText((Resolve-Path $skillManifest))
    if ($manifest -notmatch "allow_implicit_invocation:\s*false") {
      throw "$skillName could still activate implicitly."
    }
  }
  $definition = [System.IO.File]::ReadAllText(
    (Resolve-Path $frontendTaskDefinition)
  )
  $installerSource = [System.IO.File]::ReadAllText((Resolve-Path $installer))
  if ($definition -notmatch 'Activate implicitly only\s+for frontend\s+implementation') {
    throw "The selective frontend-task activation contract is missing."
  }
  if ($definition -notmatch 'Skip small edits, research, diagnosis, and review') {
    throw "The frontend-task small-task exclusion is missing."
  }
  if ($installerSource.Contains('For frontend work, use `frontend-task`')) {
    throw "The installer still writes the obsolete global frontend routing rule."
  }

  Write-Host "Selective skill activation and AGENTS.md migration tests passed."
} finally {
  if (Test-Path -LiteralPath $root) {
    [System.IO.Directory]::Delete($root, $true)
  }
}
