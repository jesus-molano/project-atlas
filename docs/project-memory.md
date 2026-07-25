# Project Memory

Project Memory gives Codex and Claude the same durable, project-scoped context
without loading an encyclopedia at session start. Markdown is the human source;
SQLite is the searchable local index.

## Knowledge classes

| Class | Authority | Source of truth | Examples |
| --- | --- | --- | --- |
| Derived fact | Reconstructible | Code/Figma index in SQLite | dependencies, component uses, Figma hierarchy |
| Canonical knowledge | Declared or verified | `project-memory/*.md` | domain rules, conventions, decisions |
| Local knowledge | Observed/inferred/decided | `.component-atlas/memory/*.md` | personal notes, unshared constraints |
| Episodic memory | Observed or verified | `.component-atlas/memory/*.md` | attempt, failure, fix, outcome |
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
- An agent uses `propose_memory_update` for durable decisions, conventions, and
  conclusions. The proposal contains evidence, confidence, relations, and any
  item it supersedes.
- `apply_memory_update` requires explicit `confirmed: true`.
- `record_outcome` may append a local observed/verified episode after a task.
  It does not promote the episode to a team rule.
- Contradictions, duplicates, stale items, and prior failed attempts become
  evidence-backed findings instead of silent writes.

The public surface stays deliberately small: `orient_project`,
`search_project_memory`, `get_memory_item`, `get_task_context`,
`check_before_change`, proposal/apply, and outcome recording. A separate
decision-context tool would duplicate typed memory search plus the preventive
gate, so decisions and constraints use those existing contracts.

## Locations and portability

Teams may version `project-memory/` when policy allows. Personal or sensitive
episodes belong in `.component-atlas/memory/`, which `component-atlas setup`
places in the global Git ignore. Both are regular Markdown with frontmatter and
wikilinks, so the folders remain readable without Atlas.

The SQLite database lives under local application data and is isolated by the
repository's stable project ID. It can be rebuilt from Markdown and source
indexes. Moving to another computer means copying/cloning allowed Markdown,
installing Atlas, scanning the repository, and running `atlas memory index`.

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
