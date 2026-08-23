# First-run checklist

## Installation

- [ ] Clone or pull `project-atlas` to a stable local path.
- [ ] Check `node --version` is 24+ and `pnpm --version` is 11.x.
- [ ] On Arch Linux or CachyOS, install the supported packages with
      `sudo pacman -Syu --needed git nodejs-lts-krypton pnpm openai-codex`.
      The rolling `nodejs` package is also valid when it provides Node 24+.
- [ ] On Windows run `.\frontend-codex-kit\install.ps1 -Agent codex`; on Arch
      Linux/CachyOS run
      `bash ./frontend-codex-kit/install.sh --agent codex`; on
      Ubuntu/macOS run
      `pwsh -NoProfile -File ./frontend-codex-kit/install.ps1 -Agent codex`.
- [ ] Run `.\frontend-codex-kit\doctor.ps1` on Windows,
      `bash ./frontend-codex-kit/doctor.sh` on Arch Linux/CachyOS, or
      `pwsh -NoProfile -File ./frontend-codex-kit/doctor.ps1` on
      Ubuntu/macOS; every check passes and no file is changed by the doctor.
- [ ] On Arch Linux/CachyOS, confirm the native Bash route required no
      PowerShell or `pwsh`.
- [ ] Confirm the doctor reports `[PASS] Codex MCP config` for the expected
      `$CODEX_HOME/config.toml` or `~/.codex/config.toml`.
- [ ] Restart Codex and open a new task so it reloads the shared MCP config.
- [ ] Open the real frontend repository in Codex.
- [ ] Confirm a small local frontend prompt stays on the normal Codex flow.
- [ ] Confirm a frontend implementation with multiple material authorities can
      select `frontend-task` automatically and names the decisive signal.
- [ ] Use `$frontend-task Implementa este cambio localizado: <description>` to
      force Atlas; use `/plan $frontend-task ...` for an explicit reviewed gate.
- [ ] Confirm the host workflow is clear: Codex/`frontend-task` implement,
      Orca manages workspaces/orchestration, and Atlas only retains bounded
      local evidence.

## First task acceptance check

- [ ] The brief uses only available sources and identifies unavailable optional
      sources without blocking.
- [ ] Bare external references remain pending and no deep scan/retrieval starts
      until they are confirmed, omitted, replaced, or marked unavailable.
- [ ] Once preflight is resolved, `atlas_prepare_task` refreshes Code Atlas as
      needed; no manual bootstrap command was required.
- [ ] A medium or large task records its immutable evidence contract after
      preparation: acceptance criteria, source decisions, constraints,
      exclusions and recovery handles.
- [ ] Existing allowed memory is indexed/reused without loading every item.
- [ ] Atlas proposes existing components before new component creation.
- [ ] Each candidate includes source/scope and a reason.
- [ ] Any question contains evidence and a recommended default.
- [ ] A supplied direct Figma node bypasses broad mapping.
- [ ] A supplied Figma file/page produces few candidates before deep retrieval.
- [ ] Ready for dev boosts a result when present but its absence does not filter
      candidates.
- [ ] `source-unavailable` triggers direct/status-capable verification, not a
      conclusion that the node has no Ready for dev state.
- [ ] A large screen is narrowed to the relevant child subtree before deep
      context, and target truncation is reported rather than hidden.
- [ ] Exact Figma enters `fidelity` with zero alternatives and preserves the
      original file/node identity.
- [ ] An unresolved existing component/section compares no more than two small
      directions; greenfield or explicit redesign compares three.
- [ ] A selected DesignContract leads to one production solution in the
      checkout/workspace chosen by the host; Atlas does not create it.
- [ ] Preview, sandbox, contact-sheet, and review-capture paths stay outside the
      repository and are purged on selection/close; cleanup failures remain
      visible and retryable.
- [ ] A visual task attaches a pre-clean immutable review while registered
      captures exist, then a final review for the locked contract with full
      capture SHA256s, complete state matrix, unique viewport/state pairs, and
      a task-bound `clean` receipt before close.
- [ ] An authoritative Figma task records a bounded semantic snapshot before
      locking. It binds the receipt to `fileKey`/`nodeId`/`version`/
      `lastModified`, with explicit coverage/omissions. After locking, new Figma
      evidence requires an explicit relock window and a linked successor when
      identity or required coverage changed.
- [ ] The reuse/extend/compose/extract/create/not-applicable decision is visible
      and persisted by `atlas_lock_change_scope` before the first edit.
- [ ] The initial continuation is checkpointed against that lock before the
      first edit. Later semantic milestones write linked checkpoints rather than
      relying on conversation history. Resuming without a task ID succeeds only
      for one active task with the same exact checkout; otherwise the host selects it.
- [ ] The final implementation runs repository validation and
      `atlas_validate_change` against the complete task delta.
- [ ] Task context reports its hard budget and does not dump every source.
- [ ] `atlas_validate_change` surfaces only evidence-backed conflicts/warnings.
- [ ] Technical close uses `atlas_task_state` action `complete` and writes no
      memory.
- [ ] Atlas rejects a `success` close when required contract criteria,
      decisions, or current validation evidence remain incomplete. The native
      workflow completes its applicable independent review before requesting
      success; use `partial` or `failure` when that is the honest outcome.
- [ ] A proposal can be reviewed by exact ID, but a durable lesson is only
      recorded/proposed/applied/rejected through the matching consent-bound
      `atlas_memory` action; generic completion approval does not count.
- [ ] The first mutating memory call writes nothing and returns the complete
      bounded scope plus an issued token/receipt; only an unchanged second call
      after literal approval writes and returns a consumed receipt.
- [ ] `pnpm atlas -- "<repo>"` exposes the evidence/review GUI and no model
      execution controls, task-execution routes, or branch/worktree creation.
- [ ] Small, medium, and large fixtures receive proportionate planning,
      validation, and independent review.
- [ ] `to-tickets`, if used after an approved specification, produces an
      optional human delivery backlog and does not become an Atlas task queue.

## Optional GUI check

From the Project Atlas clone:

```sh
pnpm atlas
pnpm atlas -- "/home/user/dev/product-repository"
```

On Windows, use `pnpm atlas -- "C:\path\to\product-repository"` for a direct
repository path.

- [ ] The browser opens the free loopback URL printed by the launcher.
- [ ] Starting without a path shows the project selector.
- [ ] Code Atlas relationships and impact match one known component.
- [ ] Design Atlas provenance/status matches an approved Figma source, if used.
- [ ] One Task Context package stays within its displayed hard cap.
- [ ] One exact synthetic proposal can be reviewed without mutation; applying
      or rejecting it still requires literal action-specific consent.

## Real-data validation

- [ ] Confirm read access to one Figma file or active selection.
- [ ] Map one real page/file and confirm version or `lastModified` refresh.
- [ ] Check whether global Variables is permitted; otherwise confirm the
      selection-only fallback.
- [ ] Check whether Code Connect exists in the organization; keep it optional.
- [ ] Scan one real Vue/Nuxt repository and review scope classification.
- [ ] Run `pnpm atlas storage` and confirm all durable data is under the single
      Project Atlas application-data root.
- [ ] Verify the secret-prevention policy against corporate scanning rules
      without using real credentials.
- [ ] Run five real tasks:
  - [ ] conversation/repository only;
  - [ ] Jira plus repository;
  - [ ] direct Figma node;
  - [ ] general Figma file/page;
  - [ ] one task with conflicting or incomplete evidence.
- [ ] Record candidate usefulness, incorrect matches, links/copies avoided, and
      questions that were unnecessary.

Do not paste credentials into prompts, fixtures, profiles, or this repository.
If corporate policy blocks a connector, record that source as unavailable and
continue with repository plus conversation.
