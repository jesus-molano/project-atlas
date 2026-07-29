# Project Atlas GUI

The GUI is a desktop-shaped evidence workspace over the same runtime, SQLite
indexes, and Markdown used by CLI and MCP. It is designed for repeated daily
work: orient, select evidence, prepare or continue a task, review decisions, and
recover from stale or incorrect results. Browsing never invokes an LLM.

After `pnpm install --frozen-lockfile` in the Project Atlas clone, start the
local product. With no path, Atlas opens its project selector; with a path, it
scans and opens that project directly:

```powershell
pnpm atlas
pnpm atlas -- "C:\path\to\product-repository"
```

The launcher checks whether the production build is current, builds it when
needed, ensures `.component-atlas/` is globally ignored by Git, selects a free
loopback port and verifies the exact launched session, starts the viewer, and
opens the default browser. It binds only
to `127.0.0.1` and does not use a fixed port, so it can run beside the selected
project's development server. Keep the launcher terminal open and press Ctrl+C
there to stop Atlas and clean up its viewer process. Use `--port <port>` only
when a fixed port is intentionally needed, or `--no-browser` to suppress
browser opening.

The compiled CLI contract is `project-atlas open [path]`. In a personal clone,
`pnpm atlas` is the public wrapper that keeps that build current; both
`pnpm atlas -- "<path>"` and `pnpm atlas -- open "<path>"` are accepted.

## Desktop shell

The top bar always shows the logical project, checkout/worktree, branch, HEAD,
dirty state, source health, and global search. Navigation is limited to two
levels:

- **Project:** Home and actionable changes since the current snapshot.
- **Explore:** Code, Design, and Memory.
- **Work:** Codex handoff and compact local activity.
- **Review:** Action Center and Memory Inbox.
- **System:** Connections and Settings.

The workspace uses a navigator, a wide evidence area, and a contextual inspector
only where it helps a decision. Exact data uses lists and ledgers; maps are
focused, searchable, and actionable rather than ornamental.

## Projects and folders

The project control always identifies the active logical project, exact
checkout/worktree, branch, HEAD, and dirty state. It also exposes recent
projects and **Open another folder**:

- in the Windows loopback browser, **Choose folder…** opens a constrained local
  directory dialog; dropping or pasting an absolute repository path is also
  supported;
- in a packaged desktop host, **Browse…** opens the native directory dialog,
  returns a path through the versioned folder-picker adapter, and still waits
  for **Open project** confirmation;
- cancelling, an invalid folder, or a failed scan leaves the active project
  unchanged;
- a project becomes recent only after validation and a successful scan;
- local branches come from the active repository rather than the recent-project
  list; branches already checked out in another worktree can be reviewed and
  opened directly;
- a branch without a worktree first shows a proposed sibling folder, branch,
  and HEAD. Confirmation creates a separate Git worktree and opens it without
  changing the branch of the checkout that was active;
- **New branch + worktree** combines a conventional commit-style prefix
  (`feat`, `fix`, `hotfix`, `refactor`, `docs`, `test`, `chore`, and related
  types) with a human name and an explicit local base branch. The current
  eligible branch is selected initially but remains editable; the preview shows
  the normalized branch, selected base and exact base `HEAD`, and sibling
  folder before confirmation;
- if the selected base disappears or moves after review, creation stops and
  requires a fresh preview; no existing checkout changes branches;
- branch movement, a newly occupied destination, a duplicate worktree, or a
  branch without `package.json` stops creation and asks for a fresh review;
- changing projects is disabled while a Codex run owns the current checkout.

Browser-only directory handles are not used because they do not provide a
stable absolute path for the local runtime. The loopback fallback launches only
an allowlisted Windows directory dialog behind same-origin and session checks;
it cannot execute a user-supplied command. The desktop picker contract and
boundary are documented in
[desktop-workspace.md](desktop-workspace.md#folder-selection-boundary).

## Evidence views

**Code** answers three common questions directly: what can I reuse, what could
break, and where is it tested. Composition edges are derived relations;
similarity is labeled as inference. A component, route, layout, consumer, or
test path can be copied or pinned into a task. The component catalog, graph
canvas, and detail inspector own independent scrolling. Selecting an item does
not scroll the page or refit the full graph. Explicit controls reset the view,
fit the selection, or fit the graph. At laptop and tablet widths the inspector
becomes a drawer with a sticky close control; `Escape` closes it and restores
focus.

**Design** orients from cached file/page hierarchy to sparse frames, families,
states, responsive variants, tokens, and code links. Ready for Dev shows
`observed`, `user-confirmed`, `source-unavailable`, or `absent` provenance.
Transient localhost assets are never opened or retained as durable evidence.
Sync and deep inspection are agent-assisted actions because they may access a
connected Figma source.

**Memory** provides a bounded concept map and a chronological view over domains,
decisions, constraints, conventions, attempts, and outcomes. Each item exposes
authority, scope, confidence, freshness, provenance, relations, and backlinks.
Proposed or superseded knowledge is visually distinct from active canonical
knowledge.

**Action Center** projects decisions, contradictions, risks, warnings, missing
evidence, and paused-run questions into one queue. The inspector explains the
detection, consequence, affected task, evidence fingerprint, and allowed human
actions. Safe review actions can be triaged together; authority choices, risk
acceptance, and agent continuation remain individual gates. See
[action-center.md](action-center.md) for the mutation and Codex boundaries.

## Codex handoff sidecar

Native Codex with `$frontend-task` is the primary conversation and execution
surface. The former Workbench is deliberately presented as a Codex handoff
sidecar: it supports new, continue, and correct modes, autodetects explicit
source links, records grouped source decisions, and accepts pinned Atlas
handles. Its embedded runner is labelled experimental.
When one exact Figma node is confirmed but its current receipt is missing, the
sidecar exposes **Synchronize exact target** before **Prepare task**. This
read-only bootstrap invokes Codex only to read sparse metadata from Figma
Desktop MCP local and call `map_figma_file` for the immutable
`fileKey+nodeId`; it generates no task context, queries no unrelated connector,
and never accepts a ranked Atlas candidate. The same compact band shows the
prerequisite, exact identity, progress, success, a retryable error, and the
next step. Task preparation remains disabled until the exact current receipt
exists.
Before launch it shows:

- exact project, worktree, branch, and snapshot fingerprint;
- read-only or workspace-write permission;
- connected and unavailable capabilities;
- selected sources and possible writes;
- hard character cap, actual characters, estimated tokens, and truncation.
- compact retrieval hits/misses/retries and receipt IDs;
- a progressively disclosed 4 KB resume capsule with covered/remaining scope,
  HEAD, and the next safe action.

After review, the server regenerates the package from trusted local state and
starts the provider-neutral Agent Adapter. The first implementation uses the
official `@openai/codex-sdk`. Progress is translated into human phases; raw
commands and external documents are not copied into the activity log. One run
owns a checkout at a time. Runs can be cancelled, material questions answered,
and completed work corrected or continued using the same Codex thread.

The sidecar never renders a second chat transcript or a noisy task dashboard.
Milestones, provenance, receipts, and capsule state are disclosed on demand
using the established tokens, responsive grid, keyboard focus, and non-color
status labels.

External writes are prohibited by the initial run contract. Jira, Confluence,
Figma, GitHub, commit/push, and canonical memory require a separate explicit
approval.

## Privacy and local metrics

The persistent run audit is capped and contains only IDs generated by Atlas,
timestamps, modes, states, source kinds, selected evidence kinds, budgets,
counts, truncation, and outcome status. It does not contain task text, source
URLs, code, documents, raw prompts, raw responses, or credentials.

Optional product metrics are disabled by default. When enabled they add a
one-way task fingerprint plus preparation time, context size, question count,
conflicts, and correction state. Both audit and metrics are local and clearable
from Settings. There is no telemetry.

## Keyboard, accessibility, and recovery

- `Ctrl/Cmd + K` opens universal evidence search.
- `Ctrl/Cmd + 1`, `2`, and `3` open Home, Code, and Codex handoff.
- `Escape` closes transient surfaces.
- All controls have visible focus, accessible names, non-color labels, and
  reduced-motion support.
- Wide, normal, and compact desktop widths keep core actions visible. Secondary
  inspectors become a controlled drawer or overlay rather than covering their
  own open/close action.
- Empty, stale, permission, conflict, and error states explain the next safe
  action instead of showing dead text.

The full product contract, human questions, journeys, action/risk matrix, and
wireframes live in [desktop-workspace.md](desktop-workspace.md).
