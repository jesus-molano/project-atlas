---
name: frontend-task
description: Prepare and execute frontend tasks from repository and conversation context plus any optional Jira, Confluence, Figma, Swagger/OpenAPI, screenshot, or pasted evidence. Use when the user says "prepara esta tarea", asks to implement or review frontend UI, supplies a design, ticket, or API contract, or needs requirements clarified and existing Vue, Nuxt, React, or Next components evaluated before code changes.
---

# Frontend Task

Turn uneven task evidence into a minimal implementation brief, make an explicit
reuse decision, and scale questions and verification to actual risk. Repository
and conversation are the baseline; never assume an external source exists.

## Prepare the task

1. Detect whether this is a new task or a continuation/correction. Default to
   `new`. Enter continuation mode only when the user unequivocally says they
   are resuming, correcting, or finishing the same task and the prior objective
   can be tied to it. A dirty worktree, prior outcome, or reference to an
   earlier flow, component, screen, or implementation is reuse evidence, not a
   continuation signal by itself. Follow `references/continuation-mode.md`
   only after establishing same-task identity.
2. Run the cheap source/capability precheck in
   `references/source-precheck.md`. Detect the repository, task text, explicit
   source links/IDs (including Swagger/OpenAPI), and callable capabilities
   before asking anything.
   A detected or inferred external reference starts as `pending`, never as
   permission to access a connector.
3. Classify risk before investigation:
   - low: localized visual or copy change with an established pattern;
   - medium: new states, responsive behavior, component API change, or several
     consumers;
   - high: authentication, biometrics, privacy or personal data, permissions,
     destructive or financial flows, accessibility-critical interaction,
     cross-feature/shared API, conflicting sources, or unclear target.
4. Classify repository, Figma, Jira, Confluence, Swagger/OpenAPI, Atlas, and
   GitHub for this task as `required`, `recommended`, `optional`,
   `unavailable`, or `not-applicable`, with one short reason. Atlas is always
   optional. Swagger/OpenAPI is recommended for API integration,
   authentication, or biometrics and required when it is the contract of the
   API the frontend must consume.
5. Show a compact task intake proportional to risk:
   - For every **new high-risk task**, make the first checkpoint during
     preparation/planning, immediately after this cheap classification and
     before repository investigation or external retrieval. Ask one grouped
     confirmation covering Jira, Confluence, Figma, and Swagger/OpenAPI even
     when no links or connectors were detected. For each source, allow the user
     to confirm a detected reference, provide or replace it, or explicitly
     continue without it. Do not claim that an absent or undetected source is
     unnecessary.
   - Otherwise, resolve each detected external reference with the same choices
     when it can materially affect the task.
   In the Project Atlas GUI, use the source ledger already presented by the
   Codex handoff sidecar only for decisions it actually records. For a new high-risk task,
   an empty or detected-links-only ledger does not satisfy the checkpoint: it
   must record an explicit decision for Jira, Confluence, Figma, and
   Swagger/OpenAPI. Ask one grouped question for any unresolved rows. Outside
   the GUI, use one grouped native selector or one brief grouped chat question.
   Never access or probe a connector while its source is pending, omitted, or
   unavailable.
6. Read repository instructions and determine the target package, framework,
   validation commands, and likely ownership boundary.
7. Inventory only sources actually present:
   - conversation, pasted text, local files, screenshots, and repository;
   - Jira or Confluence when a link or connected source is available;
   - Figma when a node, selection, page, file, screenshot, or cached Design
     Index exists;
   - Swagger/OpenAPI when a confirmed URL, local contract, or pasted contract
     is available.
8. Never require a fixed Jira-to-Confluence-to-Figma-to-OpenAPI chain. Do not
   block because a connector, credential, Dev Mode, Ready for dev, or global
   Variables access is absent.
   Optional sources that the user omits or marks unavailable are resolved
   choices, not blockers. If the API contract is required, choosing to continue
   without it is a valid intake decision but leaves preparation blocked rather
   than authorizing invented request or response behavior.
9. Build the brief defined in `references/brief-contract.md`. Keep unknowns
   explicit; do not fill them with invented product behavior.

## Apply the decision and uncertainty gate

Resolve small reversible details using repository conventions and record the
assumption. Surface a warning with evidence and a recommendation for suspected
duplication, inconsistent variants, suspicious props, missing states, or weak
Figma/code alignment.

Apply this checkpoint policy during preparation/planning:

- A new high-risk task always requires the grouped four-source intake checkpoint
  before investigation, as defined above. After resolving source choices,
  present the provisional brief, source conflicts, and material product
  decisions during planning. If no material decision remains unresolved, still
  request explicit confirmation of the prepared scope before implementation.
  A later pre-edit/write confirmation may enforce permissions, but it must not
  be the first high-risk checkpoint. Links, a long earlier conversation, prior
  task context, or a referenced earlier implementation do not count as
  current-turn confirmation.
- Medium risk requires a checkpoint when sources conflict, persistence versus
  cancel/save semantics are unclear, states are missing, the target is
  uncertain, or a shared API changes.
- Low risk may continue without a checkpoint when no material ambiguity exists.

Project Atlas always separates preparation from editing: the first agent turn
is read-only, and a write-capable turn must resume the reviewed task/thread
after the user approves implementation. This gate applies even when the
conversational risk checkpoint was skipped for a small task.

When a checkpoint is required and `request_user_input` is callable, use its
native selector. Otherwise ask one brief grouped question in chat and wait.
Ask one question by default and never more than three material questions. A
decision explicitly confirmed by the user in the current turn satisfies that
specific checkpoint; record the evidence in the brief and do not ask it again.
Once the user explicitly omits an optional source, do not ask for it again
unless the scope changes or the user reopens that source.

Each question must contain:

- the decision needed;
- evidence from the available sources;
- the recommended default and why;
- the consequence of the main alternative.

Do not run a generic requirements interview.
Do not ask for a source that is irrelevant or safely discoverable. A missing
optional plugin never blocks the task; a missing required capability is
reported with the option to connect/provide evidence or stop.

## Find the code path before creating UI

When Project Atlas is available:

1. Call `scan_repository` with the absolute repository root. It reuses the
   checkout snapshot and performs an incremental scan when safe.
2. Report the current session's connector/enrichment observations through
   `report_source_capabilities`; never probe credentials merely to populate
   status. Read `get_source_capabilities` when health affects the task.
3. Reduce the brief to one precise implementation intent.
4. Create or reuse one stable `task_id` and call `get_task_context` once with
   that ID, the approved objective flag, and the complete source-decision
   ledger under a small shared budget. Keep the returned `taskId`; the runtime
   gate must
   clear before indexing, source resolution, or connector access. The result
   contains only relevant summaries, handles, SourceReceipt IDs, and compact
   retrieval telemetry; it never injects persistent indexes or receipt bodies.
5. Follow the retrieval ladder only when needed: `orient_project`, then
   `search_project_memory`, then `get_memory_item` for a confirmed ID. Do not
   expand every result.
6. If Project Memory is not available, call `get_reuse_context` once and use
   its compact candidates, scopes, APIs, consumers, tests, and impact.
   Expand a handle or receipt ID only when the decision needs it. Never expand
   all results or receipts by default.
7. Before editing, call `check_before_change` with the intended files or area.
   Stop only for `decision-required`; report warnings with their evidence and
   recommendation.
8. Use focused Atlas tools only for a concrete ambiguity. Never request `raw`
   unless diagnosing an incorrect index.
9. Before editing a shared API, call `analyze_prop_change_impact`.
10. Choose `reuse`, `extend`, `compose`, `extract-and-reuse`, or `create`.
11. Record the choice with `record_component_decision`; a `create` rationale
   must name the nearest rejected candidates.

If Atlas is unavailable, perform the equivalent repository search manually and
still make the five-way decision. Load `references/capability-routing.md` when
exact MCP/CLI routes or fallbacks are needed.

## Use Figma proportionally

When the task needs Figma and its source is confirmed, use **Figma Desktop
MCP** at `http://127.0.0.1:3845/mcp` as the first route for every context read
and other operation it actually exposes. Resolve this local connection before
any globally configured Figma MCP server or remote connector; never choose
those first while the local server is connected, responsive, authorized, and
supports the operation. Load and follow the applicable Codex/Figma skill when
it provides instructions or is a mandatory prerequisite for the intended
operation; the skill guides that operation and never replaces or gets ahead of
the local MCP. Do not assume a tool or health endpoint exists: use the
capabilities exposed by the active MCP connection.

Use another connector, manual selection, cached Atlas evidence, screenshots,
supplied exports, or other alternatives only when the local Desktop MCP is not
connected, rejects or times out on the request, does not respond, is not
authorized, or does not expose the required operation. When falling back,
include one brief explanation naming the local failure condition and the
alternative used.

At the start of preparation, before investigating code, ingest every confirmed
Figma source through that route: retrieve sparse metadata from Figma Desktop
MCP and immediately call Project Atlas `map_figma_file` with the exact project
root and confirmed reference. Include a `source_receipt` bound to the exact
source-decision ID, adapter/route/operation, observed time, scope, freshness,
coverage, and any identity-preserving fallback. Do this for file, page, and direct-node links so
Design Atlas persists the available nodes and relationships while preparation
is still running. Refresh the task/design snapshot after mapping. Never probe
Figma Desktop MCP before the source is confirmed. If ingestion cannot run,
surface `confirmed-unsynced` or the concrete access/sync error instead of
presenting an unexplained empty Design Atlas.
In the Project Atlas Workbench, use **Synchronize exact target** for one
confirmed direct-node pin before requesting task context. That read-only
bootstrap may call only Figma Desktop MCP local and `map_figma_file` for the
immutable `fileKey+nodeId`; it must not compose task context, inspect the
repository, query other connectors, or replace the target with an Atlas
candidate. Show progress, failure guidance, and retry, then enable preparation
only after an exact current receipt is visible.

Before any full `get_design_context` retrieval, preinspect the confirmed scope
with the available lightweight hierarchy mechanism: normally `get_metadata`
for a confirmed node, or page discovery followed by `get_metadata` for the
relevant page. Use the returned node types, dimensions, children, sections,
frames, and repeated state or viewport groups to estimate complexity; do not
invent an exact size API or threshold.

- For a small bounded component or frame with a shallow sparse tree, call
  `get_design_context` directly with the client's standard timeout.
- For a broad page, large screen, or complex/deep tree, segment from the start
  by task-relevant section, frame, or child. Retrieve one bounded subtree at a
  time and retain successful chunks before continuing.
- After a timeout, never repeat the same request unchanged with a larger
  timeout. Reduce the node scope using the preinspected hierarchy, split it
  into smaller children, and continue incrementally. If no meaningful subtree
  can be isolated, ask for a manual selection.
- If a full-page read still exceeds limits, fails, or times out, preserve the
  original page link and identity. Obtain a lightweight overview first:
  `get_screenshot` for the page/frame when available, or an available supplied
  screenshot/cached Atlas summary, plus an economical `get_metadata` hierarchy
  of IDs. Identify relevant components and related sibling groups, then fetch
  small adaptive batches of bounded subtrees; batches may contain several
  related nodes and should shrink after an oversized response. Assemble the
  result incrementally with covered and remaining scope IDs, without
  re-requesting successful chunks or loading unrelated siblings.
- If neither sparse metadata nor an overview is available, state that
  limitation and ask for a narrower link, manual selection, screenshot, or
  export. Do not abandon the confirmed page link or invent its hierarchy.

Use either route; neither depends on Ready for dev:

- Direct: a user-confirmed node URL or active selection is authoritative enough
  to skip candidate ranking, but it must still be sparsely mapped for Design
  Atlas persistence before deep inspection. Preserve its `fileKey+nodeId` as an
  immutable pin. If that exact node is missing, resolves to another identity,
  or has a stale receipt, block with a minimal explanation. Never replace it
  with a ranked node; ranked results must remain labelled Atlas candidates.
  If it is a large screen, treat it
  as orientation: inspect sparse children, select the smallest task-relevant
  subtree, then retrieve deep context, screenshot, and exact variables only for
  that subtree. Omit shell, navigation, repeated assets, and peripheral
  siblings before target evidence. If the subtree cannot be isolated, ask for
  a manual selection instead of silently accepting truncated context.
- General: map sparse file/page metadata, call `find_design_candidates`, show a
  few candidates with reasons and confidence, and confirm one before deep
  retrieval.

Treat Ready for dev as a useful ranking boost and confidence signal, never as a
filter. Distinguish an observed absence from `source-unavailable`: a connector
that does not expose the field is not evidence that the Figma node lacks the
status. Without observable status, rank semantic names, hierarchy, annotations, linked
resources, components, variants, device context, and Atlas matches. A personal
Figma file without Dev Mode remains a valid source.

Treat related wide frames as viewport variants, not proof of mobile/tablet
coverage. Treat storyboard states as a flow family, not automatic duplicates.
Surface missing breakpoint/state evidence and suspicious design naming without
inventing behavior or silently rewriting copy. Never persist session-local
asset URLs; retain file/node identity and resolve relevant assets on demand.

Use global Variables collection/mode summaries only when read access exists.
Otherwise retrieve `get_variable_defs` for the confirmed node. Code Connect,
global Variables, and library data improve evidence but are optional.

## Preserve source identity and resumability

- A user-confirmed exact Jira issue, Confluence page, Figma node, or
  OpenAPI/Swagger contract is authoritative. Search results are candidates, not
  substitutes. A linked secondary source returns to `pending` until explicitly
  promoted to a primary source and confirmed.
- Every external evidence item must reference a SourceReceipt ID bound to its
  confirmed source decision. Requested/resolved identity, adapter route,
  operation, exact scope, observation/version/hash, fallback condition,
  coverage, and freshness live in the receipt. Expand it with
  `expand_source_receipt` only when evidence is inspected.
- OpenAPI may come from a confirmed local file, pasted content, public URL, or
  authenticated/internal connector. Keep per-contract and per-operation
  receipt IDs. Do not auto-confirm task wording, silently merge incompatible
  operations, or let one unreadable corporate contract discard other valid
  confirmed contracts.
- Long tasks call `checkpoint_task` with the same `task_id` only at semantic
  milestones and before a risk boundary: approved objective, confirmed
  decision, source resolution, completed batch, validated change/test, block,
  and completion. Mark the final milestone `completed`. Do not checkpoint every
  action or poll a context-percentage threshold.
- After Codex context compaction or task resume, call `resume_task_capsule`.
  Rehydrate only its strict bounded transport (TOON when a validated round trip
  is smaller, otherwise JSON), then expand its handles/receipt IDs on demand.
  Do not replay a transcript, repository/design index, or source document.
- The task capsule contains only the approved objective, source decisions,
  receipt/Atlas IDs, covered and remaining scope, worktree/HEAD, budget, and
  next safe action. Closed capsules have a short TTL. If the capsule has
  expired or a material decision is absent, ask the user again instead of
  inferring it from chat fragments.

## Resolve visual direction before UI code

For every material visual page, section, or component, explicitly invoke and
follow `$visual-direction` after the exact Figma target and repository reuse
evidence are known, but before production editing. If nested skill invocation
is not exposed, load the installed sibling
`../visual-direction/SKILL.md`; do not recreate or weaken its rules.

- With an exact confirmed Figma node, use `fidelity`: preserve its file/node
  identity, create no alternatives, and keep Atlas as context/provenance only.
- Without exact Figma, use `inherit` for an existing project. The implemented
  system is the highest visual reference; external references may contribute
  compatible facets but never replace its components, tokens, density, tone,
  navigation, motion, or constraints.
- Use `explore` only when there is genuinely no exact design and no incumbent
  system. Use `redesign` only after an explicit redesign request.
- When a material direction remains open, compare at most two small options for
  an existing section/component or three for greenfield/redesign. Select or
  coherently combine them into one compact DesignContract and state matrix.
  Never implement production variants.
- Keep all direction cards' rendered previews, mockups, contact sheets,
  sandboxes, selected consolidations, and later review captures in the
  visual-direction owned operating-system temp session. They never enter the
  repository. Purge unselected artifacts on selection and the whole session on
  close/cancel; surface and retry `cleanup-pending` failures.
- Create no preview worktrees. After the DesignContract is locked, use one
  implementation branch/worktree for one solution.
- Never write to Figma unless the user explicitly approves that separate
  output action.

Keep `$visual-direction` inactive for non-visual work, copy/data/type-only
changes, an unambiguous established local pattern, or a direction already
selected. Exact-Figma work still uses its fidelity and post-implementation
review guard without option generation.

## Implement and verify

1. State the selected target, reuse decision, and any non-blocking assumptions.
2. Implement the smallest cohesive change consistent with the repository.
3. Verify relevant tests, type checking, linting, build, responsive states, and
   accessibility in proportion to risk. For material visual work, capture only
   the relevant viewports/states after this single implementation, compare them
   with the locked DesignContract (and exact Figma target in `fidelity`), then
   fix and recapture the same implementation rather than reviving variants.
4. Rescan Atlas after component changes and confirm the graph reflects them.
5. Finish every completed task with the compact **Memory candidates** closeout
   in `references/memory-closeout.md`, even when there is no candidate. This is
   the shared structured `memoryCloseout` result: produce it once, present it in
   chat, and let the GUI render the same object without reclassification. It is
   a status, not a generic follow-up interview:
   - present a novel reusable decision, convention, constraint, integration,
     known issue, or lesson with evidence, canonical scope, and confidence, then
     ask one explicit confirmation before writing it;
   - label an episodic or checkout-only result `local-only` without asking for
     canonical promotion;
   - say explicitly when no durable knowledge was detected;
   - record a rejection or omission as `declined` in the response and do not
     ask again unless the evidence or scope changes.
   Search relevant existing memory before presenting a canonical candidate so
   the closeout does not duplicate an active item. Do not call
   `record_outcome`, `propose_memory_update`, or `apply_memory_update` until the
   user explicitly authorizes that exact write. Never infer confirmation from
   task completion, implementation approval, or silence.
   Task intake, exact source references, confirmations, hypotheses, permissions,
   and run state remain task-scoped. Checkout graphs, scan state, unmerged
   changes, and episodic validation remain checkout-scoped. Only confirmed
   durable semantics, product/architecture decisions, design metadata, and
   approved memory may be promoted to the logical project; preserve provenance.
6. Report outcome, evidence, validation, warnings, remaining external checks,
   and visual artifact cleanup. Do not claim that missing corporate data was
   validated or that cleanup succeeded while it is `cleanup-pending`.
7. Only when the user or local project policy explicitly opts in to evaluation,
   call `record_task_evaluation`. Store counts, timings, budget, and correctness
   flags; Atlas hashes the task and never persists its text.

Use `references/capability-routing.md` for source-specific routing and
`references/brief-contract.md` for the compact input/output contract. Read
`references/memory-closeout.md` for every completed task.
