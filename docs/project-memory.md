# Project Memory

Project Memory gives Codex and Claude the same durable, project-scoped context
without loading an encyclopedia at session start. Markdown and its searchable
SQLite index both live in centralized Project Atlas storage, outside the
analyzed checkout.

## Knowledge classes

| Class | Authority | Source of truth | Examples |
| --- | --- | --- | --- |
| Derived fact | Reconstructible | Code/Figma index in SQLite | dependencies, component uses, Figma hierarchy |
| Canonical knowledge | Declared or verified | `ProjectAtlas/projects/<id>/memory/canonical/*.md` | domain rules, conventions, decisions |
| Local knowledge | Observed/inferred/decided | `ProjectAtlas/projects/<id>/memory/local/*.md` | personal notes, unshared constraints |
| Episodic memory | Observed or verified | `ProjectAtlas/projects/<id>/memory/local/*.md` | attempt, failure, fix, outcome |
| Hypothesis | Inferred | either Markdown scope | suspected cause, unverified convention |

`inferred` is always shown as a hypothesis. It never silently becomes a fact.

## Item schema

Types include project, domain, glossary term, subsystem/module, convention,
decision, constraint, integration, known issue, fragile area, attempt, outcome,
plan, debt, and note.

Every item has a stable ID and project namespace plus title, compact summary,
status, confidence, authority, scope, timestamps, tags, provenance, optional
review/expiry dates, and typed relationships. Important relationships include
`depends_on`, `affects`, `contradicts`, `supersedes`, `verified_by`,
`failed_for`, `fixed_by`, `references_code`, `references_design`, and
`references_ticket`.

Statuses are explicit: `proposed`, `active`, `superseded`, `archived`, or
`rejected`. A replacement links both `supersedes` and `superseded_by`; nothing
important is overwritten invisibly.

## Write policy

- Reads and rebuilds are automatic.
- Repository and Figma facts may refresh automatically because they are
  reconstructible.
- Technical completion is independent of memory. `$frontend-task` closes a
  verified implementation with `atlas_task_state` action `complete`; this
  records task state but does not create an episode or proposal.
- `atlas_memory` is the only core memory gateway. `review-proposal` reads one
  exact proposal ID without mutating it. Every mutating call requires literal
  user consent that matches one explicit action and target; generic approval to
  implement or close the task is insufficient.
- Consent is a two-call, payload-bound protocol. The first unchanged mutation
  request omits `consent`, performs no write, and returns the complete bounded
  scope, an issued receipt, and a token. After showing that exact scope and
  receiving literal approval, the caller repeats the exact payload with the
  token. Any change of task, action, proposal, content, evidence, or target
  requires a fresh token; success returns a consumed receipt.
- The second call advances a durable write-once audit chain from `issued` to
  `executing`, `committed`, and `consumed`. The payload hash is also the memory
  operation's idempotency key, so a retry can recover a committed result or
  repeat only an unfinished operation without duplicating the mutation.
- `record-episodic` stores one local observed or verified episode only when the
  user explicitly asks to retain that result. It never promotes the episode to
  a team rule.
- `propose-canonical` creates a reviewable proposal for a named durable
  decision, convention, constraint, integration, known issue, or reusable
  lesson. The proposal includes evidence, confidence, relations, scope, and any
  item it supersedes.
- `apply-canonical` requires a separate literal confirmation of the exact
  proposal and refuses unresolved `decision-required` findings.
- `reject-proposal` requires literal confirmation of the exact proposal to
  reject. Rejection remains auditable.
- Contradictions, duplicates, stale items, and prior failed attempts become
  evidence-backed findings instead of silent writes.

The public core surface stays deliberately small: `atlas_prepare_task`,
`atlas_expand_context`, `atlas_lock_change_scope`, `atlas_validate_change`,
`atlas_task_state`, and `atlas_memory`. Indexed retrieval arrives as bounded
results or handles from prepare/expand; exact proposal review and all writes go
through `atlas_memory`.

## Locations and portability

New canonical and local memory is written only below the single Project Atlas
application-data root. Legacy repository-local `project-memory/` remains
readable as versioned project evidence. Legacy `.component-atlas/memory/` is
imported with `pnpm atlas storage migrate <repo> --apply`; add
`--remove-source` to delete the verified `.component-atlas` directory after
import.

The SQLite database is isolated by the repository's stable project ID. Use
`pnpm atlas storage` to inspect its location and sizes. `memory index` remains
available for explicit diagnostics or automation.

Invoking `$frontend-task` permits it to read relevant indexed memory. It does
not authorize recording an episode, proposing or applying canonical memory, or
rejecting a proposal. A named proposal may be read with `review-proposal`, but
that review grants no mutation authority. Closeout reports `none`, `episodic-candidate`,
`canonical-candidate`, `proposal-pending`, `stored`, or `declined`; only literal
consent for the named `atlas_memory` action and target authorizes persistence.
The GUI may present the same proposal/state for review, but it cannot infer
consent, reclassify the candidate, or complete a native Codex task.

## Obsidian

Open the repository, or just its approved memory folder, as an Obsidian vault.
Frontmatter, `[[wikilinks]]`, and backlinks work directly. Obsidian is only an
optional editor/visualizer over the same files: there is no plugin and no
parallel memory database.

Do not sync local corporate memory through a personal Obsidian Sync account
unless organizational policy explicitly allows it.

## Safety and limits

Memory writes reject common secret-like patterns such as private keys, assigned
API tokens, and known credential formats. Error messages report the field and
pattern class without echoing the value. This is preventive pattern matching,
not a substitute for secret scanning or security review. Never place
credentials in Project Memory, fixtures, prompts, or global synced folders.

Each normal memory operation preflights every destination, rejects symlinks,
stages and syncs files, and commits related SQLite rows atomically; an ordinary
error rolls back filesystem replacements and the database operation. The
consent chain reconciles application-level interruption, but Atlas does not yet
maintain a filesystem/database recovery journal for a process or power loss in
the narrow commit window. After such an interruption, run storage diagnostics
and rebuild/reconcile the affected index before trusting the last operation;
only a `committed`/`consumed` result says the lifecycle observed completion.

An Engram adapter may be considered later for explicit import/export, but Atlas
does not install or maintain a second memory system.
