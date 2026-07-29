$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) (
  "project-atlas-installer-mcp-" + [guid]::NewGuid().ToString("N")
)
$codexHome = Join-Path $root "Codex Home With Spaces"
$skillsRoot = Join-Path $root "skills"
$installer = Join-Path $PSScriptRoot "install.ps1"
$previousCodexHome = $env:CODEX_HOME

try {
  $env:CODEX_HOME = $codexHome
  $output = & $installer `
    -Agent codex `
    -CodexMcpMode auto `
    -CodexSkillsRoot $skillsRoot `
    -SkipDependencies `
    -SkipBuild `
    -DryRun 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Installer dry run failed: $output"
  }
  $expectedConfig = Join-Path $codexHome "config.toml"
  if (-not $output.Contains($expectedConfig)) {
    throw "Dry run did not target CODEX_HOME config.toml: $output"
  }
  if (-not $output.Contains("[mcp_servers.component-atlas]")) {
    throw "Dry run did not report the managed MCP section."
  }
  if ($output.Contains("codex mcp")) {
    throw "Windows auto mode attempted to use the Codex CLI."
  }
  if (-not $output.Contains("visual-direction")) {
    throw "Dry run did not include the explicit visual-direction skill."
  }
  if (Test-Path -LiteralPath $codexHome) {
    throw "Dry run wrote to the alternate CODEX_HOME."
  }
  Write-Host "Installer MCP dry-run/CODEX_HOME test passed."
} finally {
  $env:CODEX_HOME = $previousCodexHome
  if (Test-Path -LiteralPath $root) {
    [System.IO.Directory]::Delete($root, $true)
  }
}
