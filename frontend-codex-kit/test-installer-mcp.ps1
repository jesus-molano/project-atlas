$ErrorActionPreference = "Stop"
$root = Join-Path ([System.IO.Path]::GetTempPath()) (
  "project-atlas-installer-mcp-" + [guid]::NewGuid().ToString("N")
)
$codexHome = Join-Path $root "Codex Home With Spaces"
$skillsRoot = Join-Path $root "skills"
$installer = Join-Path $PSScriptRoot "install.ps1"
$doctor = Join-Path $PSScriptRoot "doctor.ps1"
$nodeRuntime = Join-Path $PSScriptRoot "node-runtime.ps1"
. $nodeRuntime
$previousCodexHome = $env:CODEX_HOME

function Get-FixtureFingerprint([string[]]$Roots) {
  $entries = foreach ($fixtureRoot in $Roots) {
    if (-not (Test-Path -LiteralPath $fixtureRoot)) {
      continue
    }
    "root|$([System.IO.Path]::GetFullPath($fixtureRoot))"
    Get-ChildItem -LiteralPath $fixtureRoot -Recurse -Force |
      ForEach-Object {
        if ($_.PSIsContainer) {
          "directory|$($_.FullName)"
        } else {
          "file|$($_.FullName)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
        }
      }
  }
  return (($entries | Sort-Object) -join "`n")
}

function Invoke-DoctorFixture(
  [string]$DoctorRoot,
  [string]$DoctorSkills,
  [string]$DoctorConfig,
  [bool]$SkipSmoke = $true
) {
  $hostExecutable = (Get-Process -Id $PID).Path
  $arguments = @("-NoProfile")
  if ($env:OS -eq "Windows_NT") {
    $arguments += @("-ExecutionPolicy", "Bypass")
  }
  $arguments += @(
    "-File", $doctor,
    "-AtlasRoot", $DoctorRoot,
    "-CodexSkillsRoot", $DoctorSkills,
    "-CodexConfigPath", $DoctorConfig
  )
  if ($SkipSmoke) {
    $arguments += "-SkipMcpSmoke"
  }
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $doctorOutput = & $hostExecutable @arguments 2>&1 | Out-String
    $doctorExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  return @{
    ExitCode = $doctorExitCode
    Output = $doctorOutput
  }
}

function Invoke-RealInstallerFixture(
  [string]$FixtureRoot,
  [string]$FixtureSkillsRoot,
  [ValidateSet("link", "copy")]
  [string]$Mode
) {
  $fixtureAgents = Join-Path $FixtureRoot ".codex/AGENTS.md"
  $installerOutput = & $installer `
    -AtlasRoot $FixtureRoot `
    -Agent codex `
    -InstallMode $Mode `
    -CodexSkillsRoot $FixtureSkillsRoot `
    -CodexAgentsPath $fixtureAgents `
    -SkipDependencies `
    -SkipBuild `
    -SkipMcp *>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Real $Mode-mode installer fixture failed: $installerOutput"
  }
  return $installerOutput
}

function Test-FnmStableResolution {
  $applicationNode = Get-Command node `
    -CommandType Application `
    -ErrorAction Stop |
    Select-Object -First 1
  $existingNodeFunction = Get-Item Function:\node -ErrorAction SilentlyContinue
  $existingFnmFunction = Get-Item Function:\fnm -ErrorAction SilentlyContinue
  $script:ExpectedStableNodeForTest = $applicationNode.Path
  $script:FnmExecObserved = $false
  try {
    Set-Item Function:\node -Value { "v24.0.0" }
    Set-Item Function:\fnm -Value {
      if ($args[0] -eq "current") {
        "v24.0.0"
      } else {
        $script:FnmExecObserved = $true
        $script:ExpectedStableNodeForTest
      }
    }
    $resolved = Resolve-AtlasStableNode
    if ($resolved -cne $script:ExpectedStableNodeForTest) {
      throw "fnm resolution did not select process.execPath from the installed version."
    }
    if (-not $script:FnmExecObserved) {
      throw "fnm resolution did not query process.execPath."
    }
  } finally {
    Remove-Item Function:\node -ErrorAction SilentlyContinue
    Remove-Item Function:\fnm -ErrorAction SilentlyContinue
    if ($existingNodeFunction) {
      Set-Item Function:\node -Value $existingNodeFunction.ScriptBlock
    }
    if ($existingFnmFunction) {
      Set-Item Function:\fnm -Value $existingFnmFunction.ScriptBlock
    }
    Remove-Variable ExpectedStableNodeForTest -Scope Script -ErrorAction SilentlyContinue
    Remove-Variable FnmExecObserved -Scope Script -ErrorAction SilentlyContinue
  }
}

function Test-PathNodeResolution {
  $applicationNode = Get-Command node `
    -CommandType Application `
    -ErrorAction Stop |
    Select-Object -First 1
  $existingNodeFunction = Get-Item Function:\node -ErrorAction SilentlyContinue
  $existingFnmFunction = Get-Item Function:\fnm -ErrorAction SilentlyContinue
  try {
    Set-Item Function:\node -Value { "v24.0.0" }
    Set-Item Function:\fnm -Value { throw "fnm unavailable" }
    $resolved = Resolve-AtlasStableNode
    if ($resolved -cne $applicationNode.Path) {
      throw "PATH fallback did not select the first Node application."
    }
  } finally {
    Remove-Item Function:\node -ErrorAction SilentlyContinue
    Remove-Item Function:\fnm -ErrorAction SilentlyContinue
    if ($existingNodeFunction) {
      Set-Item Function:\node -Value $existingNodeFunction.ScriptBlock
    }
    if ($existingFnmFunction) {
      Set-Item Function:\fnm -Value $existingFnmFunction.ScriptBlock
    }
  }
}

try {
  Test-FnmStableResolution
  Test-PathNodeResolution
  $env:CODEX_HOME = $codexHome
  $deterministicConfigMode = if ($env:OS -eq "Windows_NT") {
    "auto"
  } else {
    "config"
  }
  $hostExecutable = (Get-Process -Id $PID).Path
  $processPrefix = @("-NoProfile")
  if ($env:OS -eq "Windows_NT") {
    $processPrefix += @("-ExecutionPolicy", "Bypass")
  }
  $defaultSkillsRoot = Join-Path $root "Default Root Skills"
  $defaultAgentsPath = Join-Path $root "Default Root Codex/AGENTS.md"
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $defaultInstallerOutput = & $hostExecutable @processPrefix @(
      "-File", $installer,
      "-Agent", "codex",
      "-CodexSkillsRoot", $defaultSkillsRoot,
      "-CodexAgentsPath", $defaultAgentsPath,
      "-SkipDependencies",
      "-SkipBuild",
      "-SkipMcp",
      "-DryRun"
    ) 2>&1 | Out-String
    $defaultInstallerExit = $LASTEXITCODE
    $defaultDoctorOutput = & $hostExecutable @processPrefix @(
      "-File", $doctor,
      "-CodexSkillsRoot", (Join-Path $root "Missing Doctor Skills"),
      "-CodexConfigPath", (Join-Path $root "Missing Doctor Config/config.toml"),
      "-SkipMcpSmoke"
    ) 2>&1 | Out-String
    $defaultDoctorExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $expectedDefaultRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..")
  )
  if (
    $defaultInstallerExit -ne 0 -or
    -not $defaultInstallerOutput.Contains("Atlas root: $expectedDefaultRoot")
  ) {
    throw "A process-level installer call could not resolve its default Atlas root: $defaultInstallerOutput"
  }
  if (
    $defaultDoctorExit -ne 1 -or
    -not $defaultDoctorOutput.Contains("Atlas:  $expectedDefaultRoot") -or
    $defaultDoctorOutput.Contains("Cannot bind argument to parameter 'Path'")
  ) {
    throw "A process-level doctor call did not resolve its default Atlas root safely: $defaultDoctorOutput"
  }
  if ((Test-Path -LiteralPath $defaultSkillsRoot) -or
      (Test-Path -LiteralPath $defaultAgentsPath)) {
    throw "A process-level installer dry run created skill or AGENTS.md paths."
  }
  $output = & $installer `
    -Agent codex `
    -CodexMcpMode $deterministicConfigMode `
    -CodexSkillsRoot $skillsRoot `
    -SkipDependencies `
    -SkipBuild `
    -DryRun *>&1 | Out-String
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

  New-Item -ItemType Directory -Force -Path $skillsRoot | Out-Null
  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../skills/$skillName") `
      -Destination (Join-Path $skillsRoot $skillName) -Recurse
  }
  $copyBefore = Get-FixtureFingerprint @($skillsRoot)
  $copyOutput = & $installer `
    -Agent codex `
    -InstallMode copy `
    -CodexMcpMode $deterministicConfigMode `
    -CodexSkillsRoot $skillsRoot `
    -SkipDependencies `
    -SkipBuild `
    -DryRun *>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    throw "Idempotent copy-mode dry run failed: $copyOutput"
  }
  if ($copyOutput -notmatch "matching content") {
    throw "Copy mode did not recognize an identical installed skill."
  }
  if ($copyBefore -cne (Get-FixtureFingerprint @($skillsRoot))) {
    throw "Idempotent copy-mode dry run changed installed skills."
  }

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $installRoot = Join-Path $root "Real Install Fixture With Spaces"
  $installCli = Join-Path $installRoot "packages/cli/dist/index.js"
  $installHelper = Join-Path $installRoot "frontend-codex-kit/register-codex-mcp.mjs"
  $installMigration = Join-Path $installRoot "frontend-codex-kit/remove-agents-instructions.ps1"
  foreach ($fixtureDirectory in @(
    (Split-Path $installCli -Parent),
    (Split-Path $installHelper -Parent),
    (Join-Path $installRoot "skills")
  )) {
    New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $installRoot "package.json"),
    '{"type":"module"}',
    $utf8NoBom
  )
  [System.IO.File]::WriteAllText($installCli, "process.exitCode = 0;", $utf8NoBom)
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "register-codex-mcp.mjs") `
    -Destination $installHelper
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "remove-agents-instructions.ps1") `
    -Destination $installMigration
  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "../skills/$skillName") `
      -Destination (Join-Path $installRoot "skills/$skillName") -Recurse
  }

  $linkSkills = Join-Path $root "Real Linked Skills"
  Invoke-RealInstallerFixture $installRoot $linkSkills "link" | Out-Null
  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    $installedSkill = Get-Item -LiteralPath (Join-Path $linkSkills $skillName) -Force
    $isLink = [bool]$installedSkill.LinkType -or [bool](
      $installedSkill.Attributes -band [System.IO.FileAttributes]::ReparsePoint
    )
    if (-not $isLink -or
        -not (Test-Path -LiteralPath (Join-Path $installedSkill.FullName "SKILL.md"))) {
      throw "Link mode did not create a usable link for $skillName."
    }
  }
  $linkAgain = Invoke-RealInstallerFixture $installRoot $linkSkills "link"
  if ($linkAgain -notmatch "already linked") {
    throw "A repeated real link-mode install was not idempotent."
  }

  $copiedSkills = Join-Path $root "Real Copied Skills"
  Invoke-RealInstallerFixture $installRoot $copiedSkills "copy" | Out-Null
  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    $installedSkill = Get-Item -LiteralPath (Join-Path $copiedSkills $skillName) -Force
    $isLink = [bool]$installedSkill.LinkType -or [bool](
      $installedSkill.Attributes -band [System.IO.FileAttributes]::ReparsePoint
    )
    if ($isLink -or
        -not (Test-Path -LiteralPath (Join-Path $installedSkill.FullName "SKILL.md"))) {
      throw "Copy mode did not create a usable independent copy for $skillName."
    }
  }
  $copyAgain = Invoke-RealInstallerFixture $installRoot $copiedSkills "copy"
  if ($copyAgain -notmatch "matching content") {
    throw "A repeated real copy-mode install was not idempotent."
  }

  $doctorRoot = Join-Path $root "Atlas Fixture With Spaces"
  $doctorSkills = Join-Path $root "Doctor Skills"
  $doctorConfig = Join-Path $root "Doctor Codex Home/config.toml"
  $doctorMcp = Join-Path $doctorRoot "packages/mcp/dist/index.js"
  $doctorCli = Join-Path $doctorRoot "packages/cli/dist/index.js"
  $doctorHelper = Join-Path $doctorRoot "frontend-codex-kit/register-codex-mcp.mjs"
  $doctorSmoke = Join-Path $doctorRoot "frontend-codex-kit/smoke-core-mcp.mjs"
  foreach ($fixtureDirectory in @(
    (Split-Path $doctorMcp -Parent),
    (Split-Path $doctorCli -Parent),
    (Split-Path $doctorHelper -Parent),
    (Split-Path $doctorConfig -Parent)
  )) {
    New-Item -ItemType Directory -Force -Path $fixtureDirectory | Out-Null
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $doctorRoot "package.json"),
    "{}",
    $utf8NoBom
  )
  $mcpFixture = @'
const readline = require("node:readline");
const tools = [
  "atlas_expand_context",
  "atlas_lock_change_scope",
  "atlas_memory",
  "atlas_prepare_task",
  "atlas_task_state",
  "atlas_validate_change",
].map((name) => ({
  name,
  description: "Doctor fixture tool.",
  inputSchema: { type: "object", properties: {} },
}));
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "doctor-fixture", version: "0.1.0" },
      },
    })}\n`);
  } else if (message.method === "tools/list") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools },
    })}\n`);
  }
});
'@
  [System.IO.File]::WriteAllText($doctorMcp, $mcpFixture, $utf8NoBom)
  [System.IO.File]::WriteAllText($doctorCli, "fixture-cli", $utf8NoBom)
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "register-codex-mcp.mjs") `
    -Destination $doctorHelper
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "smoke-core-mcp.mjs") `
    -Destination $doctorSmoke

  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    $sourceSkill = Join-Path $doctorRoot "skills/$skillName"
    $installedSkill = Join-Path $doctorSkills $skillName
    foreach ($skillDirectory in @(
      (Join-Path $sourceSkill "agents"),
      (Join-Path $sourceSkill "references"),
      (Join-Path $installedSkill "references"),
      (Join-Path $installedSkill "agents")
    )) {
      New-Item -ItemType Directory -Force -Path $skillDirectory | Out-Null
    }
    $skillText = "---`nname: $skillName`ndescription: Doctor fixture.`n---`n"
    $metadataText = "policy:`n  allow_implicit_invocation: false`n"
    [System.IO.File]::WriteAllText(
      (Join-Path $sourceSkill "SKILL.md"),
      $skillText,
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $installedSkill "SKILL.md"),
      $skillText,
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $installedSkill "agents/openai.yaml"),
      $metadataText,
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $sourceSkill "agents/openai.yaml"),
      $metadataText,
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $sourceSkill "references/workflow.md"),
      "current workflow reference`n",
      $utf8NoBom
    )
    [System.IO.File]::WriteAllText(
      (Join-Path $installedSkill "references/workflow.md"),
      "current workflow reference`n",
      $utf8NoBom
    )
  }

  $nodeExecutable = Resolve-AtlasStableNode
  $nodeJson = ConvertTo-Json -InputObject $nodeExecutable -Compress
  $mcpJson = ConvertTo-Json -InputObject $doctorMcp -Compress
  $healthyConfig = @(
    "[mcp_servers.component-atlas]",
    "command = $nodeJson",
    "args = [$mcpJson, `"--profile`", `"core`"]",
    ""
  ) -join "`n"
  [System.IO.File]::WriteAllText($doctorConfig, $healthyConfig, $utf8NoBom)

  $fixtureRoots = @($doctorRoot, $doctorSkills, (Split-Path $doctorConfig -Parent))
  $healthyBefore = Get-FixtureFingerprint $fixtureRoots
  $healthyResult = Invoke-DoctorFixture $doctorRoot $doctorSkills $doctorConfig $false
  $healthyAfter = Get-FixtureFingerprint $fixtureRoots
  if ($healthyResult.ExitCode -ne 0) {
    throw "Doctor rejected a healthy fixture: $($healthyResult.Output)"
  }
  if ($healthyResult.Output -notmatch "All checks passed") {
    throw "Doctor did not report a healthy fixture clearly."
  }
  if ($healthyBefore -cne $healthyAfter) {
    throw "Doctor changed a healthy fixture despite its read-only contract."
  }

  $foreignLinkResult = Invoke-DoctorFixture `
    $doctorRoot `
    $linkSkills `
    $doctorConfig
  if ($foreignLinkResult.ExitCode -eq 0) {
    throw "Doctor accepted skill links that point to a different Atlas clone."
  }
  if ($foreignLinkResult.Output -notmatch "link points to .* instead of this clone") {
    throw "Doctor did not diagnose the foreign skill-link target clearly: $($foreignLinkResult.Output)"
  }

  $staleReference = Join-Path $doctorSkills "frontend-task/references/workflow.md"
  [System.IO.File]::WriteAllText(
    $staleReference,
    "stale workflow reference`n",
    $utf8NoBom
  )
  $staleBefore = Get-FixtureFingerprint $fixtureRoots
  $staleResult = Invoke-DoctorFixture $doctorRoot $doctorSkills $doctorConfig
  $staleAfter = Get-FixtureFingerprint $fixtureRoots
  if ($staleResult.ExitCode -eq 0) {
    throw "Doctor accepted a skill whose routed reference was stale."
  }
  if ($staleResult.Output -notmatch "\[FAIL\] Skill frontend-task") {
    throw "Doctor did not identify the skill with stale routed content."
  }
  if ($staleBefore -cne $staleAfter) {
    throw "Doctor changed a stale skill fixture despite its read-only contract."
  }
  [System.IO.File]::WriteAllText(
    $staleReference,
    "current workflow reference`n",
    $utf8NoBom
  )

  $brokenConfig = $healthyConfig.Replace('"core"', '"legacy"')
  [System.IO.File]::WriteAllText($doctorConfig, $brokenConfig, $utf8NoBom)
  $brokenBefore = Get-FixtureFingerprint $fixtureRoots
  $brokenResult = Invoke-DoctorFixture $doctorRoot $doctorSkills $doctorConfig
  $brokenAfter = Get-FixtureFingerprint $fixtureRoots
  if ($brokenResult.ExitCode -eq 0) {
    throw "Doctor accepted a fixture without the required core profile."
  }
  if ($brokenResult.Output -notmatch "\[FAIL\] Codex MCP config") {
    throw "Doctor did not diagnose the broken MCP profile."
  }
  if ($brokenResult.Output -notmatch "Current command:" -or
      $brokenResult.Output -notmatch "Expected command:") {
    throw "Doctor omitted the current/expected MCP paths needed for recovery."
  }
  if ($brokenBefore -cne $brokenAfter) {
    throw "Doctor changed a broken fixture despite its read-only contract."
  }

  Write-Host "Installer MCP dry-run/CODEX_HOME test passed."
  Write-Host "Doctor healthy/broken read-only fixture tests passed."
} finally {
  $env:CODEX_HOME = $previousCodexHome
  $linkSkillsToClean = Join-Path $root "Real Linked Skills"
  foreach ($skillName in @("frontend-task", "reuse-first", "visual-direction")) {
    $linkedSkill = Join-Path $linkSkillsToClean $skillName
    if (Test-Path -LiteralPath $linkedSkill) {
      [System.IO.Directory]::Delete($linkedSkill, $false)
    }
  }
  if (Test-Path -LiteralPath $root) {
    [System.IO.Directory]::Delete($root, $true)
  }
}
