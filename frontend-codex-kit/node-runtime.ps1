function Test-AtlasNodeExecutable([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) {
    return $false
  }
  try {
    $version = (& $Candidate --version 2>$null | Select-Object -First 1)
    return [bool]($version -match "^v\d+\.\d+\.\d+")
  } catch {
    return $false
  }
}

function Get-AtlasCommandExecutable([System.Management.Automation.CommandInfo]$Command) {
  if ($Command.Path) {
    return $Command.Path
  }
  if ($Command.Source) {
    return $Command.Source
  }
  return $Command.Name
}

function Resolve-AtlasStableNode {
  $nodeCommand = Get-Command "node" `
    -CommandType Application `
    -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $nodeCommand) {
    throw "node is required. Install Node.js 24 or newer."
  }
  $resolved = Get-AtlasCommandExecutable $nodeCommand

  $fnmCommand = Get-Command "fnm" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($fnmCommand) {
    $fnmExecutable = Get-AtlasCommandExecutable $fnmCommand
    try {
      $activeVersion = (& $fnmExecutable current 2>$null | Select-Object -First 1)
      if ($activeVersion) {
        $activeVersion = $activeVersion.Trim()
        $fnmNodes = @(
          & $fnmExecutable exec --using $activeVersion node -p "process.execPath" 2>$null
        )
        foreach ($candidate in $fnmNodes) {
          if (
            $candidate -and
            $candidate -notmatch "[\\/]fnm_multishells[\\/]" -and
            (Test-AtlasNodeExecutable $candidate.Trim())
          ) {
            return [System.IO.Path]::GetFullPath($candidate.Trim())
          }
        }
      }
    } catch {
      # Fall through to the validated executable resolved from PATH.
    }
  }

  $resolved = [System.IO.Path]::GetFullPath([string]$resolved)
  if ($resolved -match "[\\/]fnm_multishells[\\/]") {
    throw "Node resolves to an ephemeral fnm multishell path ($resolved). Activate an installed fnm version, then rerun."
  }
  if (-not (Test-AtlasNodeExecutable $resolved)) {
    throw "The resolved Node executable is not usable: $resolved"
  }
  return $resolved
}
