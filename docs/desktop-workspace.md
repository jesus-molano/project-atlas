# Desktop workspace and agent bridge

Project Atlas is designed as a desktop evidence workspace even while the first
shell is served on loopback HTTP. The shell, domain contracts, and agent bridge
must not depend on a browser tab, Electron, Tauri, or a future native rewrite.

## Navigation model

The shell has four persistent zones:

1. **Project bar** — active project, checkout/worktree, branch, dirty state,
   snapshot freshness, global search, and the current local/agent activity.
2. **Navigator** — a collapsible, two-level hierarchy:
   - Project: Overview
   - Explore: Code, Design, Memory
   - Work: Task Workbench
   - Review: Decisions & Risks, Memory Inbox
   - System: Connections, Settings
3. **Workspace** — the selected evidence or work surface. It owns the page
   title, purpose, local actions, loading, empty, and error state.
4. **Inspector** — optional detail, provenance, freshness, budget, or approval
   context for the current selection. It is never a second navigation tree.

At wide desktop widths all applicable zones can remain visible. At intermediate
widths the navigator becomes icon-first and the inspector becomes an explicit
drawer. Narrow windows preserve every action through overlays, but the product
does not optimize for phone use.

The persistent selected state in each pane shows the relationship between
navigator, workspace, and inspector. Navigation is at most two levels deep.

## Visual contract

Atlas uses four surface roles only:

- **canvas** for the main workspace;
- **pane** for persistent navigation or inspection;
- **popover** for transient search and compact choices;
- **dialog** for confirmation, approvals, and material questions.

Data rows, ledgers, timelines, graph selections, and split panes are preferred
over stacks of decorative cards. Borders express topology and boundaries.
The [Waypoint Signal](visual-direction.md) system uses neutral graphite working
planes, soft high-contrast text, and coral route signals for orientation and
primary action.
Semantic colors remain deliberately separate:

- success: green;
- Code evidence: steel;
- Design evidence: brass;
- Memory evidence: muted mauve;
- information: steel blue;
- attention: amber;
- blocked/destructive: berry.

Every relevant claim exposes provenance and freshness in its row or inspector.
Counts always have a noun. Confidence and authority are written as labels, not
unexplained numbers. Keyboard focus uses a visible two-pixel perimeter with
high adjacent contrast.

## Action classes

Every action is labeled by its execution boundary:

| Class | Examples | Agent/tokens | Approval |
| --- | --- | ---: | --- |
| Local | Rescan code, Reindex memory, inspect graph, approve a local proposal | No | Semantic writes only |
| Agent-assisted | Prepare task, continue task, ask Codex to inspect connected sources | Yes | Review before launch; questions remain gated |
| External write | Update a ticket, publish docs, commit, push | Yes or external | Always explicit |

The interface does not use a generic **Refresh** label. Activity copy states the
source and boundary, such as “Scanning changed Vue files locally” or “Codex is
checking the confirmed Figma node”.

## Task Workbench flow

1. Select the current checkout and describe or continue the task.
2. Add optional Jira, Confluence, or Figma references. Blank fields allow the
   agent to discover only directly relevant links when connectors exist.
3. Review detected connectors and enrichments. Unavailable optional sources do
   not block the task.
4. Generate the local compact context package.
5. Review the exact intent, references, included Atlas handles, character/token
   estimate, hard cap, truncation, sandbox, and working directory.
6. Start Codex explicitly. `$frontend-task` is invoked inside the thread; Atlas
   does not execute a skill independently.
7. Follow bounded progress events. Material questions and approvals appear as
   native Atlas controls before the run continues.
8. Keep the compact result in the active workspace. The durable local audit
   stores only state, source/selection kinds, budgets, counts, and outcome
   status. Typed memory remains proposal-only. Raw transcripts, task text,
   source URLs, source documents, design payloads, secrets, and transient asset
   URLs are not written to the audit.
9. Continue or correct the same task with a delta prompt and the same agent
   thread when available.

## Agent Adapter

The GUI depends on a provider-neutral `AgentAdapter`, not on Codex process
details. Its contract covers:

- capability/authentication status without reading credentials;
- start and resume;
- progress, message, question, approval, completion, failure, and cancellation
  events;
- hard timeout, output-size, and event-count limits;
- structured compact result;
- a stable external thread handle.

The first implementation uses the official server-side TypeScript Codex SDK.
It reuses Codex's own configured authentication and connectors; Atlas does not
read or copy `auth.json`, API keys, or OAuth material. The current implementation
reports the SDK as unavailable when it cannot load; copying the reviewed package
is the explicit fallback. A future `codex exec --json` adapter can fit the same
boundary, but is not silently invoked today. Experimental app-server APIs do
not cross the adapter boundary.

The default prepare run uses `workspace-write` only after the user reviews the
payload and explicitly starts implementation. Read-only preparation can use
`read-only`. External writes are never preapproved by Atlas.

## Loopback transition security

Until the shell uses native IPC:

- the server binds only to `127.0.0.1`;
- state-changing requests require a loopback `Origin`;
- agent routes require a per-process session token delivered to the same-origin
  app shell, not accepted in query strings;
- cwd must equal the selected, resolved checkout root;
- prompts are constructed from bounded typed fields, never shell strings;
- runs have timeout, cancellation, event-count, and output-size limits;
- only one active run per checkout is allowed;
- no credential file or environment secret is returned to the client;
- the child SDK/CLI receives the minimum sandbox selected in the reviewed
  launch request.

Future desktop packaging replaces the HTTP mutation surface with internal IPC
while preserving the same runtime contracts and view models.

## State model

The shell and every section support:

- loading: named operation and source;
- empty: why the index is empty and the next local or connected action;
- stale: last verified time and an explicit rescan/sync action;
- degraded: usable fallback and missing capability;
- error: scoped failure, safe retry, and retained workspace state;
- blocked: evidence, material question, and recommendation;
- offline/local-only: local indexes remain usable without connector claims.

Navigation, local browsing, and GUI filtering never invoke an agent.

## Surface utility inventory

A surface stays in the primary product only when it helps a person understand,
decide, or act. The inspector absorbs infrequent detail. Related queues share a
navigation group instead of becoming independent dashboard destinations.

| Surface | Human question | Decision | Direct action | Provenance/freshness | Correct or continue | Placement |
| --- | --- | --- | --- | --- | --- | --- |
| Home / Project | Where am I, what changed, and what should I continue? | Choose pending work in the current checkout | Continue task, copy path, rescan stale code | Git remote fingerprint, checkout, branch, HEAD, diff, snapshot revision | Preserve the diff and reopen the Workbench | Primary |
| Code | What already exists, what uses it, what is tested, and what might break? | Reuse, extend, extract, or change | Open file/test, compare candidates, pin to task, ask Codex | Indexed commit/working tree, exact versus inferred relation | Rescan affected files; revise the reuse decision | Explore |
| Design | Which design family/state is relevant and how does it map to code? | Select root, responsive variant, state, or missing evidence | Sync map, isolate subtree, open source, compare, pin to task | File/page/node IDs, source adapter, indexed version, status provenance | Reselect node, refresh scope, correct family membership | Explore |
| Memory | What has this project decided or learned, and is it still authoritative? | Follow, review, supersede, or reject knowledge | Open evidence, relate entities, propose revision, ask Codex | Authority, confidence, source, updated/verified/review dates | Revise proposal, supersede explicitly, restore a prior relation | Explore |
| Task Workbench | What should we do next with this task? | Confirm scope, sources, budget, sandbox, and material answers | Prepare, implement, continue, correct, cancel | Task revision, selected handles, agent thread, source observations | Edit the delta and resume the same thread/worktree | Work |
| Review | What needs a human decision or semantic approval? | Resolve conflict, accept/reject/revise memory, acknowledge risk | Approve, reject, combine, supersede, open evidence, continue task | Finding rule, evidence handles, proposal origin, task/run | Reopen decision, revise proposal, continue originating task | Review |
| Connections | What is actually available now, and what is cached only? | Continue degraded, connect elsewhere, or refresh evidence | Rescan code, reindex memory, sync confirmed design scope, copy setup help | checked-at, adapter, configured/authenticated/detected/cache state | Retry source, keep local-only path | System |
| Settings | What are my local limits and write policies? | Choose budget, top-k, retention, and storage policy | Update local preference, clear local audit metrics | Policy source and effective value | Reset to safe defaults | System |

The metric-first Overview is not a standalone destination. Its useful
project identity, changes, queues, and continuation actions become Home. Counts
without a direct interpretation or action move to section headers or the
inspector. Agent Activity remains inside the Task Workbench until there is
evidence that a separate cross-task run log is necessary. The current local
activity ledger intentionally stores only content-free run metadata.

The loopback shell can activate an existing local repository from a reviewed
absolute path. The server validates the directory, builds the initial local
index, and only then changes the active project and records it as recent.
Cancellation or validation failure retains the current project. This mutation
uses the same-origin and per-process session checks as the agent bridge, and it
never launches a shell, Explorer, or another process.

### Folder selection boundary

Folder selection is a versioned desktop-host capability rather than browser
feature detection. The renderer accepts an optional
`window.projectAtlasDesktopHost` adapter with this narrow contract:

```ts
interface AtlasDesktopFolderPicker {
  version: 1;
  capabilities: { selectDirectory: true };
  selectDirectory(): Promise<
    | { status: "selected"; absolutePath: string }
    | { status: "cancelled" }
  >;
}
```

A packaged desktop host implements this method with its native directory
dialog and returns only the selected absolute path through constrained IPC.
Selecting a directory fills the path field; it does not scan, activate a
project, or start an agent. The user reviews the path and chooses **Open
project** before the server validates and scans it. Cancelling is a no-op and
focus returns to the **Browse…** control.

The loopback browser keeps the manual absolute-path field and recent-project
rows. It displays **Browse is available in the desktop app** when the adapter is
absent. Atlas intentionally does not use `showDirectoryPicker`,
`webkitdirectory`, PowerShell, or Explorer as substitutes: a browser file
handle is not a trustworthy absolute backend path, and a loopback endpoint must
not become a general process launcher. Cloning remains an explicit CLI or Git
operation until a future desktop host can expose a separately reviewed,
allowlisted contract.

## Daily journeys

### Open and continue

1. Home opens the last logical project and exact checkout.
2. Git state and changes since the last Atlas snapshot are visible before any
   action.
3. A pending task or review can be continued in one action.
4. The Workbench shows only the delta since the previous brief and preserves the
   worktree diff.

### Find before creating

1. Universal search returns code, consumers, tests, design families, memory,
   decisions, and tasks.
2. Each result exposes actions: inspect, compare, pin to task, open evidence, or
   ask Codex.
3. Code offers goal views: **Reuse**, **Impact**, and **Tests**. Exact graph
   relations and inferred similarity remain visually distinct.
4. A selected candidate moves to the Workbench as an Atlas handle, not a copied
   graph payload.

### Prepare and run

1. The user describes a task; source fields remain optional.
2. Atlas detects explicit references and current capabilities without accessing
   irrelevant systems.
3. Local context is composed and shown before Codex starts.
4. The user reviews project, checkout, sources, sandbox, budget, potential local
   writes, and prohibited external writes.
5. Codex runs `$frontend-task`; activity uses human language and can be
   cancelled.
6. A material question pauses progress. The answer resumes the same thread.
7. The compact result shows evidence, changes, unresolved items, verification,
   and next actions. Memory remains a proposal until approved.

### Review and correct

1. Review groups small queues by **Needs decision**, **Memory proposals**,
   **Stale evidence**, and **Resolved recently**.
2. Opening an item retains its originating task, evidence, and snapshot.
3. The user can revise the result or scope and continue the same task instead of
   onboarding again.
4. If the current snapshot changed during the run, Atlas shows the conflict and
   requires a rebase/review decision instead of silently applying stale output.

## Wireframes

Wide desktop:

```text
┌ Project Atlas ─ Project / checkout / branch / dirty ─ Search ─ activity ┐
│ NAVIGATOR       │ WORKSPACE                               │ INSPECTOR    │
│ Project         │ Section purpose · freshness · actions   │ Selection    │
│  Home           │─────────────────────────────────────────│ provenance   │
│ Explore         │                                         │ relations    │
│  Code           │       evidence / work canvas            │ actions      │
│  Design         │                                         │ budget       │
│  Memory         │                                         │              │
│ Work            │                                         │              │
│  Task           │                                         │              │
│ Review          │                                         │              │
│  Decisions      │                                         │              │
│  Memory Inbox   │                                         │              │
│ System          │                                         │              │
│  Connections    │                                         │              │
│  Settings       │                                         │              │
└─────────────────┴─────────────────────────────────────────┴──────────────┘
```

Normal desktop:

```text
┌ Project / checkout / branch ─ Search ─ activity ┐
│ compact nav │ workspace                         │
│             │                                   │
│             │ inspector opens as a right drawer │
└─────────────┴───────────────────────────────────┘
```

Task Workbench:

```text
┌ Task / Continue / Correct ─────────────── Local context status ┐
│ Intent                                                     │
│ Source chips: Jira · Confluence · Figma · + reference       │
│ Detected capabilities and only material missing-source ask  │
├ Brief & candidates ──────────────── Context inspector        │
│ Evidence · decisions · risks       2,840 / 3,600 chars      │
│                                    ~710 tokens · not cut     │
├──────────────────────────────────────────────────────────────│
│ [Prepare only · read-only] [Implement with Codex]            │
│ Local action / Agent action / External write legend          │
└──────────────────────────────────────────────────────────────┘
```

During a run, the lower region becomes an activity ledger. A question opens a
dialog anchored to the exact evidence, not a generic chat transcript.

## Action and capability manifest

Native actions are defined by a versioned manifest, not by one hard-coded button
per skill. Each entry declares:

- stable action ID and human intent;
- local runtime, skill, and agent adapter;
- required and optional typed inputs;
- required/recommended capabilities and source kinds;
- execution class: local, agent-assisted, external-write;
- risk level and possible write scopes;
- expected questions and structured result schema;
- cancellation, timeout, and resume behavior;
- availability reason and fallback action.

The first manifest exposes:

| Intent | Runtime | Class | Risk | Writes |
| --- | --- | --- | --- | --- |
| Rescan code | Atlas runtime | Local | low | Derived index |
| Reindex memory | Atlas runtime | Local | low | Rebuilt local index |
| Prepare frontend task | `frontend-task` through Agent Adapter | Agent | medium | None |
| Implement frontend task | `frontend-task` through Agent Adapter | Agent | high | Selected checkout |
| Continue/correct task | Agent Adapter resume | Agent | risk inherited from task | Selected checkout |
| Review memory proposal | Atlas runtime | Local | medium | Local or canonical only after explicit target approval |
| Ask Codex about selection | Agent Adapter | Agent | medium | None by default |

Unknown capabilities use **Ask Codex with this selection**. Atlas never claims a
native integration it cannot model, cancel, and validate.

## Concurrency and recovery

- Every run owns one logical project, checkout, starting snapshot fingerprint,
  and optional Codex thread.
- One write-capable agent run per checkout is allowed. Read-only local searches
  continue.
- Code/design/memory refresh publishes a new atomic revision. A run completing
  against an older revision is marked stale before any result is promoted.
- Selectors never launch work. Only explicit action controls can start local,
  agent, or external operations.
- Cancellation aborts the adapter turn and retains the worktree. It does not
  reset files.
- Resume uses the same thread only when project and checkout identity still
  match. Otherwise Atlas starts a correction brief with explicit evidence of
  the context change.
- Prompt construction separates trusted system rules, user intent, external
  source references, and serialized Atlas evidence. External content is data,
  never executable instruction.

## Local success measures

Evaluation is opt-in, local, aggregated, capped, and clearable. It stores no
task text, source URLs, documents, code, or raw agent output.

- time to open or prepare a task;
- manual source/setup steps avoided;
- actions completed without a terminal;
- continuation without repeated onboarding;
- correction without starting a new task/thread;
- local searches that lead to inspect, compare, pin, or run;
- necessary versus unnecessary questions;
- context characters and estimated/actual tokens;
- run failures, cancellations, stale-result conflicts, and rework.

These measures evaluate completion and recovery, not clicks or time spent in
Atlas.

## Explicit product limits

Atlas does not become a code editor, terminal, full chat client, issue tracker,
design renderer, or source-document archive. It opens evidence in the owning
tool and hands reviewed work to Codex. Native UI is reserved for project
orientation, evidence selection, bounded task preparation, run control,
decisions, and memory review.

## Evidence behind the contract

- [Apple Human Interface Guidelines: Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [Apple Human Interface Guidelines: Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)
- [Windows NavigationView](https://learn.microsoft.com/en-us/windows/apps/design/controls/navigationview)
- [WCAG 2.2 focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- [OpenAI Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [OpenAI Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
