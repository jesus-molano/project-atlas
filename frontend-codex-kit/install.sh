#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/kit-common.sh
source "$SCRIPT_DIR/lib/kit-common.sh"

usage() {
  cat <<'EOF'
Install Project Atlas for Codex or the Claude Code compatibility preview.

Usage: bash ./frontend-codex-kit/install.sh [options]

Options:
  --atlas-root <path>              Stable Project Atlas clone
  --agent <codex|claude|both>      Client to configure (default: codex)
  --install-mode <link|copy>       Install skills as links or copies
  --codex-skills-root <path>       Codex skill destination
  --claude-skills-root <path>      Claude skill destination
  --codex-agents-path <path>       Legacy AGENTS.md migration target
  --codex-mcp-mode <auto|config|cli>
                                    Codex MCP registration route
  --force-mcp-config               Replace one reviewed conflicting section
  --skip-dependencies              Reuse workspace dependencies
  --skip-build                     Reuse existing build output
  --skip-mcp                       Do not register the MCP server
  --dry-run                        Print exact actions without writing
  -h, --help                       Show this help
EOF
}

require_option_value() {
  local option="$1"
  local remaining="$2"
  local value="${3:-}"
  if (( remaining < 2 )) || [[ -z "$value" || "$value" == -* ]]; then
    atlas_die "Missing value for $option."
    exit 2
  fi
}

install_skill() {
  local source="$1"
  local target_root="$2"
  local name
  local target
  local normalized_source
  local link_target=""
  local source_fingerprint
  local target_fingerprint

  name="$(basename -- "$source")"
  target="$target_root/$name"
  normalized_source="$(realpath -- "$source")"

  if [[ -e "$target" || -L "$target" ]]; then
    link_target="$(atlas_resolve_link_target "$target" 2>/dev/null || true)"
    if [[ -n "$link_target" ]] && atlas_path_equal "$link_target" "$normalized_source"; then
      if [[ "$install_mode" == "link" ]]; then
        atlas_log "$name is already linked at $target"
        return 0
      fi
      atlas_die "$name is linked at $target, but --install-mode copy was requested. Move or remove the link explicitly, then rerun the installer."
      return 1
    fi
    if [[ "$install_mode" == "copy" && -z "$link_target" && -d "$target" ]]; then
      source_fingerprint="$(
        atlas_skill_fingerprint "$node" "$fingerprint_helper" "$source"
      )"
      target_fingerprint="$(
        atlas_skill_fingerprint "$node" "$fingerprint_helper" "$target"
      )"
      if [[ "$source_fingerprint" == "$target_fingerprint" ]]; then
        atlas_log "$name is already copied at $target with matching content"
        return 0
      fi
    fi
    atlas_die "Refusing to overwrite existing skill at $target. Move or remove it explicitly, then rerun the installer."
    return 1
  fi

  if [[ "$dry_run" == "true" ]]; then
    atlas_log "DRY RUN: install $name at $target using $install_mode"
    return 0
  fi

  mkdir -p -- "$target_root"
  if [[ "$install_mode" == "copy" ]]; then
    cp -a -- "$source" "$target"
  else
    ln -s -- "$normalized_source" "$target"
  fi
  atlas_log "Installed $name at $target"
}

ensure_mcp_cli() {
  local client="$1"
  local client_executable="$2"
  local node_executable="$3"
  local mcp_entry="$4"
  local -a arguments

  if [[ "$client" == "codex" ]]; then
    arguments=(
      mcp add component-atlas -- "$node_executable" "$mcp_entry"
      --profile core
    )
  else
    arguments=(
      mcp add --scope user component-atlas -- "$node_executable" "$mcp_entry"
      --profile core
    )
  fi

  if [[ "$dry_run" == "true" ]]; then
    atlas_log "DRY RUN: register Project Atlas MCP for $client"
    atlas_print_command "$client_executable" "${arguments[@]}"
    return 0
  fi

  if "$client_executable" mcp get component-atlas >/dev/null 2>&1; then
    atlas_log "$client already has an MCP server named component-atlas; preserving it."
    atlas_log "Run '$client mcp get component-atlas' and replace it manually if its path is stale."
    return 0
  fi

  atlas_log "register Project Atlas MCP for $client"
  "$client_executable" "${arguments[@]}"
}

ensure_codex_mcp_config() {
  local -a arguments=(
    "$codex_mcp_helper"
    --config "$codex_config_path"
    --node "$node"
    --entry "$mcp_entry"
  )
  if [[ "$force_mcp_config" == "true" ]]; then
    arguments+=(--force)
  fi
  if [[ "$dry_run" == "true" ]]; then
    arguments+=(--dry-run)
  fi

  atlas_log "register Project Atlas MCP in Codex config"
  if "$node" "${arguments[@]}"; then
    :
  else
    local status=$?
    atlas_die "Codex MCP config registration failed with exit code $status."
    return "$status"
  fi
  atlas_log "Codex reads this shared config after an app restart or new task."
}

if [[ "$(uname -s)" != "Linux" ]]; then
  atlas_die "This native installer supports Linux. On Windows use install.ps1."
  exit 1
fi

atlas_root=""
agent="codex"
install_mode="link"
codex_skills_root="$HOME/.agents/skills"
claude_skills_root="$HOME/.claude/skills"
codex_agents_path="$HOME/.codex/AGENTS.md"
skip_dependencies="false"
skip_build="false"
skip_mcp="false"
codex_mcp_mode="auto"
force_mcp_config="false"
dry_run="false"

while (( $# > 0 )); do
  case "$1" in
    --atlas-root)
      require_option_value "$1" "$#" "${2:-}"
      atlas_root="$2"
      shift 2
      ;;
    --agent)
      require_option_value "$1" "$#" "${2:-}"
      agent="$2"
      shift 2
      ;;
    --install-mode)
      require_option_value "$1" "$#" "${2:-}"
      install_mode="$2"
      shift 2
      ;;
    --codex-skills-root)
      require_option_value "$1" "$#" "${2:-}"
      codex_skills_root="$2"
      shift 2
      ;;
    --claude-skills-root)
      require_option_value "$1" "$#" "${2:-}"
      claude_skills_root="$2"
      shift 2
      ;;
    --codex-agents-path)
      require_option_value "$1" "$#" "${2:-}"
      codex_agents_path="$2"
      shift 2
      ;;
    --codex-mcp-mode)
      require_option_value "$1" "$#" "${2:-}"
      codex_mcp_mode="$2"
      shift 2
      ;;
    --skip-dependencies)
      skip_dependencies="true"
      shift
      ;;
    --skip-build)
      skip_build="true"
      shift
      ;;
    --skip-mcp)
      skip_mcp="true"
      shift
      ;;
    --force-mcp-config)
      force_mcp_config="true"
      shift
      ;;
    --dry-run)
      dry_run="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      atlas_die "Unknown option: $1"
      usage >&2
      exit 2
      ;;
  esac
done

atlas_validate_choice "--agent" "$agent" codex claude both || exit 2
atlas_validate_choice "--install-mode" "$install_mode" link copy || exit 2
atlas_validate_choice "--codex-mcp-mode" "$codex_mcp_mode" auto config cli \
  || exit 2

if [[ -n "$atlas_root" ]]; then
  if [[ ! -d "$atlas_root" ]]; then
    atlas_die "Atlas root is not a directory: $atlas_root"
    exit 1
  fi
  atlas_root="$(cd -- "$atlas_root" && pwd -P)"
else
  atlas_root="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
fi
codex_skills_root="$(atlas_absolute_path "$codex_skills_root")"
claude_skills_root="$(atlas_absolute_path "$claude_skills_root")"
codex_agents_path="$(atlas_absolute_path "$codex_agents_path")"
codex_root="${CODEX_HOME:-$HOME/.codex}"
codex_config_path="$(atlas_absolute_path "$codex_root/config.toml")"

package_json="$atlas_root/package.json"
frontend_task="$atlas_root/skills/frontend-task"
reuse_first="$atlas_root/skills/reuse-first"
visual_direction="$atlas_root/skills/visual-direction"
mcp_entry="$atlas_root/packages/mcp/dist/index.js"
cli_entry="$atlas_root/packages/cli/dist/index.js"
agents_migration="$atlas_root/frontend-codex-kit/remove-agents-instructions.mjs"
codex_mcp_helper="$atlas_root/frontend-codex-kit/register-codex-mcp.mjs"
fingerprint_helper="$atlas_root/frontend-codex-kit/skill-content-fingerprint.mjs"

for required_path in \
  "$package_json" \
  "$frontend_task" \
  "$reuse_first" \
  "$visual_direction" \
  "$agents_migration" \
  "$codex_mcp_helper" \
  "$fingerprint_helper"; do
  if [[ ! -e "$required_path" ]]; then
    atlas_die "Atlas root does not contain the expected kit file: $required_path"
    exit 1
  fi
done

cd -- "$atlas_root"
node="$(atlas_resolve_stable_node)"
node_version="$("$node" --version | head -n 1)"
if [[ ! "$node_version" =~ ^v([0-9]+)\. ]]; then
  atlas_die "Could not parse the Node.js version: $node_version"
  exit 1
fi
if (( BASH_REMATCH[1] < 24 )); then
  atlas_die "Node.js 24 or newer is required; found ${node_version#v}."
  exit 1
fi

pnpm=""
if [[ "$skip_dependencies" == "false" || "$skip_build" == "false" ]]; then
  pnpm="$(atlas_require_command pnpm 'On Arch/CachyOS run: sudo pacman -Syu --needed pnpm')"
  if [[ "$dry_run" == "true" ]]; then
    pnpm_version="$(
      pnpm_config_pm_on_fail=ignore "$pnpm" --version 2>/dev/null \
        | head -n 1 \
        || true
    )"
  else
    pnpm_version="$("$pnpm" --version 2>/dev/null | head -n 1 || true)"
  fi
  if [[ ! "$pnpm_version" =~ ^11\. ]]; then
    atlas_die "pnpm 11.x is required; found $pnpm_version."
    exit 1
  fi
fi
git="$(atlas_require_command git 'On Arch/CachyOS run: sudo pacman -Syu --needed git')"

codex_client=""
claude_client=""
if [[ "$skip_mcp" == "false" && ( "$agent" == "codex" || "$agent" == "both" ) ]]; then
  if [[ "$codex_mcp_mode" == "cli" ]]; then
    codex_client="$(atlas_require_command codex 'Install Codex, or use --codex-mcp-mode config.')"
  elif [[ "$codex_mcp_mode" == "auto" ]]; then
    codex_client="$(command -v codex 2>/dev/null || true)"
  fi
fi
if [[ "$skip_mcp" == "false" && ( "$agent" == "claude" || "$agent" == "both" ) ]]; then
  claude_client="$(atlas_require_command claude 'Install Claude Code, then rerun with --agent claude.')"
fi

atlas_log "Atlas root: $atlas_root"
atlas_log "Node ${node_version#v}; Git $("$git" --version)"

if [[ "$skip_dependencies" == "false" ]]; then
  atlas_run "$dry_run" "install workspace dependencies" \
    "$pnpm" install --frozen-lockfile
fi
if [[ "$skip_build" == "false" ]]; then
  atlas_run "$dry_run" "build Project Atlas packages and local product" \
    "$pnpm" build
fi

if [[ "$dry_run" == "false" && ! -f "$cli_entry" ]]; then
  atlas_die "Atlas CLI build is missing at $cli_entry."
  exit 1
fi
atlas_run "$dry_run" "confirm centralized Project Atlas storage" \
  "$node" "$cli_entry" setup

if [[ "$agent" == "codex" || "$agent" == "both" ]]; then
  install_skill "$frontend_task" "$codex_skills_root"
  install_skill "$reuse_first" "$codex_skills_root"
  install_skill "$visual_direction" "$codex_skills_root"
  migration_arguments=("$agents_migration" --target "$codex_agents_path")
  if [[ "$dry_run" == "true" ]]; then
    migration_arguments+=(--dry-run)
  fi
  "$node" "${migration_arguments[@]}"
fi
if [[ "$agent" == "claude" || "$agent" == "both" ]]; then
  install_skill "$frontend_task" "$claude_skills_root"
  install_skill "$reuse_first" "$claude_skills_root"
  install_skill "$visual_direction" "$claude_skills_root"
fi

if [[ "$skip_mcp" == "false" ]]; then
  if [[ "$dry_run" == "false" && ! -f "$mcp_entry" ]]; then
    atlas_die "Atlas MCP build is missing at $mcp_entry."
    exit 1
  fi
  if [[ "$agent" == "codex" || "$agent" == "both" ]]; then
    if [[ "$codex_mcp_mode" == "config" ]]; then
      ensure_codex_mcp_config
    elif [[ "$codex_mcp_mode" == "cli" ]]; then
      if ensure_mcp_cli codex "$codex_client" "$node" "$mcp_entry"; then
        :
      else
        status=$?
        atlas_die "Codex MCP CLI registration failed with exit code $status."
        exit "$status"
      fi
    elif [[ -n "$codex_client" ]]; then
      if ensure_mcp_cli codex "$codex_client" "$node" "$mcp_entry"; then
        :
      else
        atlas_log "Codex CLI registration failed; falling back to config.toml."
        ensure_codex_mcp_config
      fi
    else
      ensure_codex_mcp_config
    fi
  fi
  if [[ "$agent" == "claude" || "$agent" == "both" ]]; then
    if ensure_mcp_cli claude "$claude_client" "$node" "$mcp_entry"; then
      :
    else
      status=$?
      atlas_die "Claude MCP CLI registration failed with exit code $status."
      exit "$status"
    fi
  fi
fi

atlas_log "Installation complete."
printf '\nNext:\n'
printf '  1. Run: bash %q\n' "$atlas_root/frontend-codex-kit/doctor.sh"
printf '  2. Restart the agent and open a new task/session.\n'
printf '  3. Open the product repository in your agent.\n'
printf '  4. Invoke /plan $frontend-task in Codex or /frontend-task in Claude Code.\n'
printf '  5. Describe the task; the skill handles source preflight and compact retrieval.\n'
printf '  6. Connect Jira, Confluence, or Figma only when the task needs them.\n'
printf "  7. Optional local product: from %q run 'pnpm atlas'.\n" "$atlas_root"
