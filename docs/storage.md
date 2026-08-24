# Project Atlas storage

Project Atlas never writes indexes, receipts, task state, journals, previews,
generated catalogs, decisions, or local/canonical memory into a repository it
analyzes.

The single default root on Windows is:

```text
%LOCALAPPDATA%\ProjectAtlas\
```

The other platform defaults are:

- macOS: `~/Library/Application Support/ProjectAtlas/`;
- Linux: `${XDG_DATA_HOME:-~/.local/share}/ProjectAtlas/`.

`PROJECT_ATLAS_HOME` may override that root for tests or managed
installations. Atlas does not use `.codex` for project content. Codex's own MCP
registration remains in Codex configuration because that file belongs to the
host, not to Atlas.

## Layout

```text
ProjectAtlas/
├── recent-projects.json
├── projects/
│   └── <logical-project-id>/
│       ├── atlas.sqlite
│       ├── project.json
│       ├── catalog.md
│       ├── decisions/
│       ├── memory/
│       │   ├── canonical/
│       │   └── local/
│       ├── task-state/
│       │   ├── capsules/
│       │   ├── continuations/
│       │   ├── evidence-contracts/
│       │   ├── figma-snapshots/
│       │   ├── ledgers/
│       │   ├── journals/
│       │   ├── manifests/
│       │   ├── receipts/
│       │   ├── retrieval/
│       │   └── retrieval-results/
│       └── migrations/
│           └── repository-local-v1/
└── temp/
    ├── visual-direction/
    └── assets/
```

`projects/` is durable. `temp/` is ephemeral and every owned session has an
expiry plus explicit close/cancel cleanup. Cleanup verifies ownership and
never recursively deletes an unverified path.

`temp/assets/` contains only validated Figma bytes plus small ownership/expiry
metadata addressed by opaque handles. It stores no Desktop MCP localhost URL.
Expired entries are purged individually after schema/handle verification;
selected assets enter a checkout only through the explicit production-asset
materialization command.

`ledgers/` holds the complete immutable source decisions, provider policies,
and cross-source scope relations. Capsules contain only a bounded resume
projection, so a long confirmed URL is never truncated at the trust boundary
and later checkpoints do not require the user to repeat it.

`task-state/` also owns checkout-and-branch focus records, immutable feedback
events, Git reconciliation records, Git baselines, immutable
final/technical-outcome receipts, source receipts, visual contracts/reviews,
evidence contracts, continuation bundles, semantic Figma snapshots, and the
write-once memory-consent chain. These durable artifacts are intentionally
separate from expiring capsules, so completion, feedback lineage, visual review,
and an approved memory mutation remain auditable after resume state is pruned.

New source observations use SourceReceipt v3 IDs: `receipt-` followed by the
64-character SHA-256 of the complete normalized semantic payload. Version 1
and 2 receipts with 16-character IDs remain readable for migration and audit,
but are historical evidence only and cannot authorize a new ChangeSurface,
Figma asset, or source-dependent implementation.

ChangeSurface v2 locks are write-once artifacts under
`task-state/change-surfaces/<sha256>.json`. Each artifact binds the logical
project checkout, task ID, normalized scope, Git baseline, and integrity hash.
Active capsules store only the lock ID, revision, and integrity hash; resume
rehydrates the complete lock from its artifact. The artifact has a separate
12 KB bound and does not consume the 4 KB resume-capsule budget. Capsule pruning
never deletes these locks. Completion intents and delivery
receipts use the same durable separation so identical retries can reconcile
after interruption while conflicting completion payloads are rejected. The
intent freezes result/summary/verification plus HEAD, lock/delta, source
receipts, context handles, and the exact visual-review hash; the immutable
commit makes post-expiry retries independent of the transient capsule.

Evidence contracts and continuation bundles are content-addressed, per-task
artifacts. A continuation references its contract and, once scope is locked,
the active ChangeSurface. The latest pointer is published only after its capsule
checkpoint succeeds. Semantic Figma snapshots retain only bounded
node/component/style/state/asset-reference metadata and current source receipt
identity; they reject raw Figma payloads and require a linked successor when
the observed source changes.

Focus records are keyed by checkout identity and branch, not objective text.
They point to one active or blocked task and never reopen a completed task.
Feedback events form a content-addressed per-task chain. Capsules retain only a
bounded queue summary and lineage pointer. Git reconciliation classifies the
stored and current HEAD as same, advanced, diverged, or unknown; it records
commits as evidence without converting them into acceptance evidence.

Logical project identity is based on the normalized Git remote, then the Git
common directory, and finally the canonical path. Worktrees share the logical
project while checkout-specific graphs and local outcomes retain their
checkout ID.

## Diagnostics

```powershell
pnpm atlas storage
pnpm atlas storage --json
```

The command prints the effective root, category sizes, which categories are
ephemeral, and any older application-data roots detected.

## Migrate repository-local legacy data

`scan`, project preparation, synchronization, and resume never import or delete
repository-local legacy data implicitly. Inspect one project first:

```powershell
pnpm atlas storage migrate "C:\path\to\product-repository" --status
pnpm atlas storage migrate "C:\path\to\product-repository" --dry-run
```

The report inventories `project.json`, `catalog.md`, decisions, memory,
task-state, and a matching old `ComponentAtlas` SQLite database. It distinguishes
importable, already imported, conflict-preserved, and invalid content. Dry-run
does not create the destination directory.

To import and then remove the verified repository-local directory in one
explicit operation:

```powershell
pnpm atlas storage migrate "C:\path\to\product-repository" --apply --remove-source
```

Atlas imports into `<platform Atlas storage root>/projects/<logical-project-id>/`
(`%LOCALAPPDATA%\ProjectAtlas\projects\<logical-project-id>\` on Windows), rechecks every
source hash, and removes only `<repo>\.component-atlas` after all recognized
repository-local files are present in centralized storage. It refuses cleanup
after a partial import, an invalid file, a source change, or an unrecognized
file. It never removes the repository, the centralized project directory, or
the older `%LOCALAPPDATA%\ComponentAtlas\` database.

If migration was already applied without cleanup, the equivalent explicit
recovery command is:

```powershell
pnpm atlas storage cleanup-legacy "C:\path\to\product-repository" --confirm
```

Plain `--apply` keeps `.component-atlas` for review. No legacy content is
deleted automatically.
