# First-run checklist

## Installation

- [ ] Clone or pull `project-atlas` to a stable local path.
- [ ] Check `node --version` is 24+ and `pnpm --version` is 11+.
- [ ] Run
      `.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions`.
- [ ] Confirm the installer reports `[mcp_servers.component-atlas]` in the
      expected `$CODEX_HOME/config.toml` or `~/.codex/config.toml`.
- [ ] Restart Codex and open a new task so it reloads the shared MCP config.
- [ ] Open the real frontend repository in Codex.
- [ ] Start with
      `/plan $frontend-task Prepara e implementa esta tarea: <description>`.

## First task acceptance check

- [ ] The brief uses only available sources and identifies unavailable optional
      sources without blocking.
- [ ] The skill performs the Code Atlas scan; no manual bootstrap command was
      required.
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
- [ ] One selected DesignContract produces one implementation worktree and one
      production solution.
- [ ] Preview, sandbox, contact-sheet, and review-capture paths stay outside the
      repository and are purged on selection/close; cleanup failures remain
      visible and retryable.
- [ ] The final implementation records a reuse decision and runs repository
      validation.
- [ ] Task context reports its hard budget and does not dump every source.
- [ ] `check_before_change` surfaces only evidence-backed conflicts/warnings.
- [ ] A durable memory lesson is proposed, not silently applied.
- [ ] `pnpm atlas -- "<repo>"` exposes all nine GUI sections and Task Context shows
      the budget used before copying a package.

## Optional GUI check

From the Project Atlas clone:

```powershell
pnpm atlas
pnpm atlas -- "C:\path\to\product-repository"
```

- [ ] The browser opens the free loopback URL printed by the launcher.
- [ ] Starting without a path shows the project selector.
- [ ] Code Atlas relationships and impact match one known component.
- [ ] Design Atlas provenance/status matches an approved Figma source, if used.
- [ ] One Task Context package stays within its displayed hard cap.
- [ ] One synthetic memory proposal can be reviewed before real knowledge is
      written.

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
