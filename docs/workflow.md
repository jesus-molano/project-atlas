# Project Atlas task workflow

The recommended interface is `$frontend-task`, not the CLI. Open the product
repository in Codex and invoke:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

The skill orchestrates available capabilities. Project Atlas supplies compact
local code, design, impact, and memory evidence when connected and useful.

## First task in a repository

The skill performs this sequence:

1. **Precheck.** Detect the repository, task, explicit links (including
   Swagger/OpenAPI), and callable capabilities without probing connectors.
   Classify risk and each source as required, recommended, optional,
   unavailable, or not applicable.
2. **Source checkpoint.** For every new high-risk task, use one grouped
   confirmation for Jira, Confluence, Figma, and Swagger/OpenAPI before code
   investigation, even when none was detected. Each source can be confirmed,
   supplied/replaced, or explicitly omitted. Other tasks ask only for a source
   or decision that can materially change implementation.
3. **Code index.** Call `scan_repository` for the current checkout. Code Atlas
   derives components, routes, layouts, imports, composition, consumers,
   similarity, tests, and impact.
4. **Memory index.** `get_task_context` indexes allowed Markdown when no memory
   index exists. An explicit refresh is used when approved memory files changed.
5. **Design index.** When a Figma source is confirmed, preparation first reads
   sparse metadata through Figma Desktop MCP and persists it with
   `map_figma_file` plus an exact SourceReceipt. A confirmed node preserves
   `fileKey+nodeId`, skips ranking, and blocks instead of accepting a missing,
   mismatched, or stale target; a
   file/page is mapped and ranked before deep retrieval. The workspace refreshes
   during the run so Design Atlas is visible before code work or task completion.
6. **Bounded context.** Retrieve a few task-relevant memory, code, and optional
   design candidates under one shared hard cap.
7. **Decision gate.** Check contradictions, current decisions, fragile areas,
   failed attempts, and the likely change impact. Ask only for a material
   unresolved choice.
8. **Implementation.** Reuse, extend, compose, extract-and-reuse, or create with
   rejected alternatives recorded.
9. **Verification.** Run repository-appropriate tests, typecheck, build,
   accessibility, and responsive checks.
10. **Closeout.** Rescan after structural code changes and always report
    `Memory candidates`: no durable candidate, a canonical candidate awaiting
    explicit confirmation, a local-only outcome, a confirmed stored item, or a
    declined candidate. A canonical candidate includes evidence, scope, and
    confidence. Nothing is recorded, proposed, or applied automatically.
    Conversation and GUI present the same `AgentCompactResult.memoryCloseout`;
    the GUI does not derive a second result.

## Later tasks

Code Atlas resolves a stable logical repository identity and a separate
checkout/worktree identity. Existing Project Memory and Design Atlas caches are
reused by logical project ID; code snapshots stay checkout-specific. Scans
reuse the prior file manifest and reparse only changed component files when
safe. Test, configuration, imported-type, or ambiguous changes fall back to a
full scan. Memory is reindexed when its source files change or an explicit
refresh is requested. A Figma file is not remapped blindly; its sparse
source/version hash and cached scopes are reused until new metadata is supplied.

Retrieval remains focused on the current intent. Atlas returns top candidates,
handles, SourceReceipt IDs, and compact hit/miss/retry telemetry instead of
every indexed record.

## Continue or correct an existing task

`$frontend-task` enters continuation mode only when the user unequivocally
resumes, corrects, or finishes the same task and its prior objective can be
recovered. A dirty worktree, prior outcome, or request to match an earlier flow,
component, or implementation is reuse evidence, not continuation by itself. A
confirmed continuation first inspects Git status, the focused diff, current
validation failures, and the nearest prior brief/outcome, then builds a delta
brief containing only preserved work, remaining behavior, affected evidence,
and pending validation.

Continuation never resets or broadly rewrites existing changes. It consults
only affected Atlas handles or external evidence and does not repeat source
onboarding. A human gate is repeated only when the delta changes behavior,
introduces a contradiction, changes a shared API, or reopens a material
decision.

## What enters agent context

Normal task context contains only:

- a compact project/source summary;
- a few current decisions, constraints, or relevant prior outcomes;
- a few code candidates with evidence and impact;
- a few design candidates when Figma is relevant;
- receipt IDs, findings, one decision gate, next actions, and size/retrieval
  metrics.

It does not contain the complete repository graph, full Figma tree, all memory,
screenshots, or raw exports. The default GUI/task budget is 3,600 characters;
all project query tools enforce hard limits, small top-k defaults, and explicit
expansion.

Human browsing in the GUI does not add anything to agent context. Only an
explicit Codex handoff package is meant to be copied or sent.

## Optional Codex handoff sidecar

Native Codex remains the primary conversation/execution surface. The GUI is a
control and inspection sidecar for the same workflow:

1. Run `pnpm atlas` from the Project Atlas clone and choose the exact product
   checkout, or pass it directly with `pnpm atlas -- "<path>"`.
2. Use global search or Code, Design, and Memory goal views to select evidence.
3. Choose **Use in task**. The selected handles are pinned and guaranteed to
   enter the bounded package even when task wording alone ranks them lower.
4. Review sources, findings, estimated tokens, snapshot, branch, and checkout.
5. If an exact confirmed Figma node is unsynchronized, choose **Synchronize
   exact target** first. The read-only source bootstrap maps only that
   `fileKey+nodeId` through Figma Desktop MCP local, emits a SourceReceipt, and
   does not generate task context or search candidates. Retry after a
   connection error; an identity or freshness discrepancy stays blocking.
6. Copy the bounded package to native Codex, or deliberately choose the
   experimental embedded runner.
7. When using the runner, review the launch boundary, then start Codex. Atlas shows compact progress,
   supports cancellation, renders material questions in place, and reports
   confirmed Figma ingestion as loading, available, unsynchronized, or failed.
8. Correct or continue the same Codex task without rebuilding onboarding.

For long tasks, `get_task_context` returns one stable `taskId`.
`checkpoint_task` journals only semantic milestones and before-risk boundaries,
then materializes a strict 4 KB resume capsule. Compaction/resume loads that capsule alone and
expands handles or receipt IDs on demand. The capsule is tied to worktree/HEAD;
it never imports another worktree's code snapshot. Closed state expires after
24 hours, leaving a minimal final receipt rather than a transcript.

Local navigation and index actions consume zero agent tokens. Agent execution
uses the official SDK and never authorizes external writes. Jira, Confluence,
Figma, GitHub mutations, commit/push, and canonical memory still require their
own explicit approval.

## Source behavior

- **Repository:** required for implementation and scanned locally.
- **Atlas:** optional; absence falls back to focused repository search.
- **Jira/Confluence:** read through Atlassian Rovo only when connected and
  relevant.
- **Figma:** read through the available Figma capability. Ready for dev,
  Variables, and Code Connect improve evidence but are not prerequisites.
- **GitHub:** used when a remote issue, PR, or history is relevant.

Following one explicit relevant link is allowed. Broad crawling is not.
Invoking the skill does not authorize plugin installation, connector
authorization, writes to external systems, or durable memory confirmation.

## Advanced CLI and diagnostics

These commands are for explicit bootstrap, diagnostics, automation, and index
inspection. They are not prerequisites for `$frontend-task`.

From the Project Atlas clone:

```powershell
$atlas = "C:\path\to\project-atlas"
$repo = "C:\path\to\product-repository"
$cli = Join-Path $atlas "packages\cli\dist\index.js"

node $cli scan $repo
node $cli scan $repo --full
node $cli capabilities show $repo
node $cli context $repo "empty state with retry"
node $cli memory orient $repo --budget 2400
node $cli memory task $repo "empty state with retry" --budget 3600
node $cli memory check $repo "change empty state API"
node $cli show $repo UiEmptyState
node $cli similar $repo UiModal
node $cli impact $repo UiModal
node $cli open $repo
```

Use `--project-key <stable-key>` on the first scan only when remote/common-Git
identity is unsuitable. The ignored project artifact pins the resulting ID.
For automation, `PROJECT_ATLAS_PROJECT_KEY` applies the same override.

Private evaluation is opt-in:

```powershell
node $cli evaluation record $repo --input "<metrics-only.json>"
node $cli evaluation list $repo
node $cli evaluation clear $repo --confirm
```

Atlas hashes the task text and persists only bounded counts, timing, context
size, top-three correctness, conflicts, and rework. It never stores the task
text, code, documents, or source URLs in this log.

The input is transient and uses this shape:

```json
{
  "task": "local task description",
  "topThreeCorrect": true,
  "falseDuplicateCount": 0,
  "necessaryQuestions": 1,
  "unnecessaryQuestions": 0,
  "contextChars": 2800,
  "preparationMs": 4200,
  "conflictCount": 0,
  "reworkRequired": false
}
```

Add `--raw` only when diagnosing an incorrect index. Normal queries use the
orient → search → expand ladder.

Advanced Figma cache diagnostics:

```powershell
node $cli figma map $repo "<figma-url>" `
  --metadata "<sparse-xml-or-json-file>" `
  --format figma-mcp-xml `
  --scope-page-id "<page-id>" `
  --scope-page-name "<page-name>"

node $cli figma find $repo "<task description>"
node $cli figma inspect $repo "<figma-file>" "<confirmed-node-id>"
```

For a large confirmed screen, narrow sparse child metadata to the smallest
task-relevant subtree before deep Figma context. If isolation is impossible,
request a manual selection rather than accepting a truncated target.
