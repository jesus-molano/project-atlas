#!/usr/bin/env bash

set -Eeuo pipefail

REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
INSTALLER="$REPOSITORY_ROOT/frontend-codex-kit/install.sh"
DOCTOR="$REPOSITORY_ROOT/frontend-codex-kit/doctor.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/project-atlas-shell-kit.XXXXXX")"
REAL_NODE="$(command -v node)"
HOST_KERNEL="$(uname -s)"
if [[ "$HOST_KERNEL" == MINGW* ]]; then
  export MSYS="winsymlinks:sys"
fi

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'Shell kit test failed: %s\n' "$*" >&2
  exit 1
}

tree_fingerprint() {
  local root="$1"
  {
    find "$root" -printf '%y|%m|%p|%l\0' | sort -z
    find "$root" -type f -print0 \
      | sort -z \
      | xargs -0 -r sha256sum
  } | sha256sum | cut -d ' ' -f 1
}

write_fixture() {
  local root="$1"
  mkdir -p \
    "$root/frontend-codex-kit" \
    "$root/packages/cli/dist" \
    "$root/packages/mcp/dist"
  printf '{"type":"module"}\n' > "$root/package.json"
  printf 'process.exit(0);\n' > "$root/packages/cli/dist/index.js"
  printf 'process.exit(0);\n' > "$root/packages/mcp/dist/index.js"
  cp -a -- "$REPOSITORY_ROOT/skills" "$root/skills"
  mkdir -p -- "$root/skills/frontend-task/empty-fixture-directory"
  cp -- \
    "$REPOSITORY_ROOT/frontend-codex-kit/register-codex-mcp.mjs" \
    "$REPOSITORY_ROOT/frontend-codex-kit/remove-agents-instructions.mjs" \
    "$REPOSITORY_ROOT/frontend-codex-kit/skill-content-fingerprint.mjs" \
    "$root/frontend-codex-kit/"
}

FAKE_BIN="$TEST_ROOT/fake bin"
mkdir -p -- "$FAKE_BIN"
cat > "$FAKE_BIN/uname" <<'EOF'
#!/usr/bin/env bash
printf 'Linux\n'
EOF
cat > "$FAKE_BIN/node" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-p" && "${2:-}" == "process.execPath" ]]; then
  realpath -- "$0"
  exit 0
fi
node_arguments=("$@")
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
  for argument_index in "${!node_arguments[@]}"; do
    if [[ "${node_arguments[$argument_index]}" == /* ]]; then
      node_arguments[$argument_index]="$(
        cygpath -w -- "${node_arguments[$argument_index]}"
      )"
    fi
  done
fi
exec "$ATLAS_TEST_REAL_NODE" "${node_arguments[@]}"
EOF
cat > "$FAKE_BIN/pnpm" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  if [[ -n "${ATLAS_TEST_EXPECT_PNPM_CWD:-}" \
    && "$PWD" != "$ATLAS_TEST_EXPECT_PNPM_CWD" ]]; then
    printf 'pnpm ran from %s instead of %s\n' \
      "$PWD" "$ATLAS_TEST_EXPECT_PNPM_CWD" >&2
    exit 92
  fi
  if [[ "${ATLAS_TEST_EXPECT_PNPM_READ_ONLY:-false}" == "true" \
    && "${pnpm_config_pm_on_fail:-}" != "ignore" ]]; then
    printf 'doctor did not disable pnpm version auto-download\n' >&2
    exit 93
  fi
  printf '11.9.0\n'
  exit 0
fi
printf 'pnpm should not run in this fixture\n' >&2
exit 91
EOF
cat > "$FAKE_BIN/codex" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$ATLAS_TEST_CODEX_LOG"
case "${ATLAS_TEST_CODEX_MODE:-add-success}:$*" in
  existing:'mcp get component-atlas') exit 0 ;;
  *:'mcp get component-atlas') exit 1 ;;
  add-fail:'mcp add component-atlas'*) exit 7 ;;
  *:'mcp add component-atlas'*) exit 0 ;;
  *) exit 2 ;;
esac
EOF
chmod +x "$FAKE_BIN/uname" "$FAKE_BIN/node" "$FAKE_BIN/pnpm" "$FAKE_BIN/codex"
export PATH="$FAKE_BIN:$PATH"
export ATLAS_TEST_REAL_NODE="$REAL_NODE"

FIXTURE_ROOT="$TEST_ROOT/Atlas clone's path with spaces"
write_fixture "$FIXTURE_ROOT"
export ATLAS_TEST_EXPECT_PNPM_CWD="$FIXTURE_ROOT"

# A missing option value never consumes the next flag or writes to its name.
INVALID_HOME="$TEST_ROOT/invalid home"
INVALID_CWD="$TEST_ROOT/invalid cwd"
mkdir -p -- "$INVALID_HOME" "$INVALID_CWD"
invalid_status=0
(cd -- "$INVALID_CWD" \
  && HOME="$INVALID_HOME" CODEX_HOME="$INVALID_HOME/codex" \
    bash "$INSTALLER" \
      --atlas-root "$FIXTURE_ROOT" \
      --codex-skills-root --dry-run \
      --skip-dependencies \
      --skip-build \
      --skip-mcp >/dev/null 2>&1) \
  || invalid_status=$?
[[ "$invalid_status" -eq 2 ]] \
  || fail "installer did not reject a missing option value with status 2"
[[ ! -e "$INVALID_CWD/--dry-run" ]] \
  || fail "installer treated --dry-run as a writable path"
invalid_status=0
bash "$DOCTOR" --codex-skills-root --skip-mcp-smoke >/dev/null 2>&1 \
  || invalid_status=$?
[[ "$invalid_status" -eq 2 ]] \
  || fail "doctor did not reject a missing option value with status 2"
invalid_status=0
bash "$INSTALLER" --agent unsupported >/dev/null 2>&1 \
  || invalid_status=$?
[[ "$invalid_status" -eq 2 ]] \
  || fail "installer did not reject an invalid choice with status 2"

# Dry-run resolves and inspects every source without changing its targets.
DRY_SKILLS="$TEST_ROOT/dry skills"
DRY_AGENTS="$TEST_ROOT/dry home/AGENTS.md"
mkdir -p -- "$(dirname -- "$DRY_AGENTS")"
printf '%s\nlegacy\n%s\nkeep\n' \
  '<!-- project-atlas:frontend-task:start -->' \
  '<!-- project-atlas:frontend-task:end -->' > "$DRY_AGENTS"
dry_before="$(tree_fingerprint "$TEST_ROOT/dry home")"
DRY_CODEX_HOME="$TEST_ROOT/dry codex home"
export ATLAS_TEST_EXPECT_PNPM_READ_ONLY="true"
CODEX_HOME="$DRY_CODEX_HOME" bash "$INSTALLER" \
  --atlas-root "$FIXTURE_ROOT" \
  --agent codex \
  --install-mode copy \
  --codex-skills-root "$DRY_SKILLS" \
  --codex-agents-path "$DRY_AGENTS" \
  --codex-mcp-mode config \
  --dry-run >/dev/null
dry_after="$(tree_fingerprint "$TEST_ROOT/dry home")"
[[ "$dry_before" == "$dry_after" ]] || fail "dry-run changed AGENTS.md"
[[ ! -e "$DRY_SKILLS" ]] || fail "dry-run created a skill root"
[[ ! -e "$DRY_CODEX_HOME" ]] || fail "dry-run created a Codex config root"

# Copy installation is repeatable and migration preserves one exact backup.
COPY_SKILLS="$TEST_ROOT/copied skills"
COPY_AGENTS="$TEST_ROOT/copy home/AGENTS.md"
mkdir -p -- "$(dirname -- "$COPY_AGENTS")"
printf '%s\nlegacy\n%s\nkeep\n' \
  '<!-- project-atlas:frontend-task:start -->' \
  '<!-- project-atlas:frontend-task:end -->' > "$COPY_AGENTS"
copy_original="$(sha256sum "$COPY_AGENTS" | cut -d ' ' -f 1)"
copy_arguments=(
  --atlas-root "$FIXTURE_ROOT"
  --agent codex
  --install-mode copy
  --codex-skills-root "$COPY_SKILLS"
  --codex-agents-path "$COPY_AGENTS"
  --skip-dependencies
  --skip-build
  --skip-mcp
)
bash "$INSTALLER" "${copy_arguments[@]}" >/dev/null
for skill in frontend-task reuse-first visual-direction; do
  [[ -f "$COPY_SKILLS/$skill/SKILL.md" ]] \
    || fail "copy install omitted $skill"
done
grep -q '^keep$' "$COPY_AGENTS" || fail "migration removed unrelated content"
! grep -q 'project-atlas:frontend-task' "$COPY_AGENTS" \
  || fail "migration left the legacy markers"
[[ "$(sha256sum "$COPY_AGENTS.project-atlas.bak" | cut -d ' ' -f 1)" == "$copy_original" ]] \
  || fail "migration backup does not match the original"
bash "$INSTALLER" "${copy_arguments[@]}" >/dev/null
[[ ! -e "$COPY_AGENTS.project-atlas.bak.1" ]] \
  || fail "repeat install created an unnecessary backup"
rmdir -- "$COPY_SKILLS/frontend-task/empty-fixture-directory"
if bash "$INSTALLER" "${copy_arguments[@]}" >/dev/null 2>&1; then
  fail "copy install ignored a missing empty source directory"
fi
mkdir -p -- "$COPY_SKILLS/frontend-task/empty-fixture-directory"

# A foreign destination is never overwritten.
CONFLICT_SKILLS="$TEST_ROOT/conflicting skills"
mkdir -p -- "$CONFLICT_SKILLS/frontend-task"
printf 'foreign\n' > "$CONFLICT_SKILLS/frontend-task/SKILL.md"
if bash "$INSTALLER" \
  --atlas-root "$FIXTURE_ROOT" \
  --agent codex \
  --install-mode copy \
  --codex-skills-root "$CONFLICT_SKILLS" \
  --codex-agents-path "$TEST_ROOT/conflict AGENTS.md" \
  --skip-dependencies \
  --skip-build \
  --skip-mcp >/dev/null 2>&1; then
  fail "installer overwrote a foreign skill"
fi
grep -q '^foreign$' "$CONFLICT_SKILLS/frontend-task/SKILL.md" \
  || fail "foreign skill content changed"

# Link mode points at this exact clone and is repeatable.
LINK_SKILLS="$TEST_ROOT/linked skills"
link_arguments=(
  --atlas-root "$FIXTURE_ROOT"
  --agent codex
  --install-mode link
  --codex-skills-root "$LINK_SKILLS"
  --codex-agents-path "$TEST_ROOT/missing AGENTS.md"
  --skip-dependencies
  --skip-build
  --skip-mcp
)
bash "$INSTALLER" "${link_arguments[@]}" >/dev/null
bash "$INSTALLER" "${link_arguments[@]}" >/dev/null
for skill in frontend-task reuse-first visual-direction; do
  link_target="$(readlink "$LINK_SKILLS/$skill" 2>/dev/null || true)"
  [[ -n "$link_target" ]] || fail "link install omitted $skill"
  if [[ "$link_target" == /* ]]; then
    resolved_link_target="$(realpath -m "$link_target")"
  else
    resolved_link_target="$(
      realpath -m "$(dirname "$LINK_SKILLS/$skill")/$link_target"
    )"
  fi
  [[ "$resolved_link_target" == "$(realpath "$FIXTURE_ROOT/skills/$skill")" ]] \
    || fail "$skill points to the wrong clone"
done
if bash "$INSTALLER" \
  --atlas-root "$FIXTURE_ROOT" \
  --agent codex \
  --install-mode copy \
  --codex-skills-root "$LINK_SKILLS" \
  --codex-agents-path "$TEST_ROOT/missing AGENTS.md" \
  --skip-dependencies \
  --skip-build \
  --skip-mcp >/dev/null 2>&1; then
  fail "copy mode accepted an existing link"
fi
[[ -L "$LINK_SKILLS/frontend-task" ]] \
  || fail "copy-mode refusal changed an existing link"

# Direct config installation plus the doctor form a healthy read-only pair.
CONFIG_HOME="$TEST_ROOT/config home"
CONFIG_SKILLS="$TEST_ROOT/config skills"
CONFIG_AGENTS="$TEST_ROOT/config AGENTS.md"
CONFIG_PATH="$CONFIG_HOME/config.toml"
CODEX_HOME="$CONFIG_HOME" bash "$INSTALLER" \
  --atlas-root "$FIXTURE_ROOT" \
  --agent codex \
  --install-mode copy \
  --codex-skills-root "$CONFIG_SKILLS" \
  --codex-agents-path "$CONFIG_AGENTS" \
  --skip-dependencies \
  --skip-build \
  --codex-mcp-mode config >/dev/null
grep -q '^\[mcp_servers\.component-atlas\]$' "$CONFIG_PATH" \
  || fail "config mode did not register the MCP server"
doctor_before="$(tree_fingerprint "$TEST_ROOT")"
doctor_output="$(bash "$DOCTOR" \
  --atlas-root "$FIXTURE_ROOT" \
  --codex-skills-root "$CONFIG_SKILLS" \
  --codex-config-path "$CONFIG_PATH" \
  --skip-mcp-smoke)"
doctor_after="$(tree_fingerprint "$TEST_ROOT")"
[[ "$doctor_output" == *"All checks passed"* ]] \
  || fail "doctor rejected a healthy shell installation"
[[ "$doctor_before" == "$doctor_after" ]] \
  || fail "doctor changed its fixture"

# An unusable command is reported as a failed check instead of aborting early.
cat > "$FAKE_BIN/git" <<'EOF'
#!/usr/bin/env bash
printf 'simulated git failure\n' >&2
exit 41
EOF
chmod +x "$FAKE_BIN/git"
if broken_doctor_output="$(bash "$DOCTOR" \
  --atlas-root "$FIXTURE_ROOT" \
  --codex-skills-root "$CONFIG_SKILLS" \
  --codex-config-path "$CONFIG_PATH" \
  --skip-mcp-smoke 2>&1)"; then
  fail "doctor accepted an unusable Git command"
fi
[[ "$broken_doctor_output" == *"[FAIL] Git - simulated git failure"* ]] \
  || fail "doctor did not report the unusable Git command"
[[ "$broken_doctor_output" == *"Doctor found 1 failed check(s)"* ]] \
  || fail "doctor aborted before its complete failure summary"
rm -- "$FAKE_BIN/git"

# Linux auto mode exercises successful CLI registration, preservation, and fallback.
for mode in add-success existing add-fail; do
  AUTO_ROOT="$TEST_ROOT/auto $mode"
  AUTO_SKILLS="$AUTO_ROOT/skills"
  AUTO_CONFIG="$AUTO_ROOT/codex/config.toml"
  export ATLAS_TEST_CODEX_MODE="$mode"
  export ATLAS_TEST_CODEX_LOG="$AUTO_ROOT/codex.log"
  mkdir -p -- "$AUTO_ROOT"
  CODEX_HOME="$AUTO_ROOT/codex" bash "$INSTALLER" \
    --atlas-root "$FIXTURE_ROOT" \
    --agent codex \
    --install-mode link \
    --codex-skills-root "$AUTO_SKILLS" \
    --codex-agents-path "$AUTO_ROOT/AGENTS.md" \
    --skip-dependencies \
    --skip-build \
    --codex-mcp-mode auto >/dev/null
  grep -q '^mcp get component-atlas$' "$ATLAS_TEST_CODEX_LOG" \
    || fail "auto $mode did not inspect the existing CLI entry"
  if [[ "$mode" == "add-success" ]]; then
    grep -q '^mcp add component-atlas ' "$ATLAS_TEST_CODEX_LOG" \
      || fail "auto mode did not add a missing CLI entry"
    [[ ! -e "$AUTO_CONFIG" ]] \
      || fail "successful CLI registration unexpectedly wrote config"
  elif [[ "$mode" == "existing" ]]; then
    ! grep -q '^mcp add component-atlas ' "$ATLAS_TEST_CODEX_LOG" \
      || fail "auto mode replaced an existing CLI entry"
    [[ ! -e "$AUTO_CONFIG" ]] \
      || fail "existing CLI entry unexpectedly wrote config"
  else
    [[ -f "$AUTO_CONFIG" ]] \
      || fail "failed CLI registration did not fall back to config"
  fi
done

printf 'Native Linux installer and doctor fixture tests passed.\n'
