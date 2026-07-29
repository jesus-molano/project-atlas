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
- Every completed `$frontend-task` result includes a compact `Memory
  candidates` status, even when no durable knowledge was detected. A novel
  durable decision, convention, constraint, integration, known issue, or
  reusable lesson is shown with evidence, canonical scope, confidence, and one
  explicit confirmation question.
- Only after that exact confirmation does an agent use
  `propose_memory_update` for durable knowledge. The proposal contains
  evidence, confidence, relations, and any item it supersedes.
- `apply_memory_update` requires explicit `confirmed: true`, refuses proposals
  with unresolved `decision-required` findings, and requires a second
  `canonical_confirmed: true` acknowledgement before writing canonical Atlas
  storage.
- `record_outcome` may append a local observed/verified episode only after the
  user asks to retain that local result. It does not promote the episode to a
  team rule.
- Contradictions, duplicates, stale items, and prior failed attempts become
  evidence-backed findings instead of silent writes.

The public surface stays deliberately small: `orient_project`,
`search_project_memory`, `get_memory_item`, `get_task_context`,
`check_before_change`, proposal/apply, and outcome recording. A separate
decision-context tool would duplicate typed memory search plus the preventive
gate, so decisions and constraints use those existing contracts.

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
not authorize recording an outcome, creating a proposal, or applying canonical
memory. The closeout reports `none`, `canonical-candidate`, `local-only`,
`canonical-stored`, or `declined`; only an explicit confirmation of the named
write authorizes persistence.

The `AgentCompactResult.memoryCloseout` object is shared across chat and GUI.
Codex determines it once under the frontend-task contract; the GUI presents it
without reclassifying candidates or implementing a separate approval rule.

## Obsidian

Open the repository—or just its approved memory folder—as an Obsidian vault.
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

An Engram adapter may be considered later for explicit import/export, but Atlas
does not install or maintain a second memory system.
