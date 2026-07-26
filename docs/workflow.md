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

1. **Precheck.** Detect the repository, task, explicit links, and callable
   capabilities. Classify each source as required, recommended, optional,
   unavailable, or not applicable.
2. **Material question.** Use the native question selector for a missing source
   or decision that can change the implementation. Do not ask about every
   possible integration.
3. **Code index.** Call `scan_repository` for the current checkout. Code Atlas
   derives components, routes, layouts, imports, composition, consumers,
   similarity, tests, and impact.
4. **Memory index.** `get_task_context` indexes allowed Markdown when no memory
   index exists. An explicit refresh is used when approved memory files changed.
5. **Design index.** Use cached sparse Figma metadata only when design is
   relevant. A confirmed node takes the direct route. A file/page is mapped
   sparsely and ranked before any deep retrieval.
6. **Bounded context.** Retrieve a few task-relevant memory, code, and optional
   design candidates under one shared hard cap.
7. **Decision gate.** Check contradictions, current decisions, fragile areas,
   failed attempts, and the likely change impact. Ask only for a material
   unresolved choice.
8. **Implementation.** Reuse, extend, compose, extract-and-reuse, or create with
   rejected alternatives recorded.
9. **Verification.** Run repository-appropriate tests, typecheck, build,
   accessibility, and responsive checks.
10. **Closeout.** Rescan after structural code changes, record the observed
    outcome, and propose any durable lesson. A durable proposal is not applied
    without confirmation.

## Later tasks

Code Atlas resolves a stable logical repository identity and a separate
checkout/worktree identity. Existing Project Memory and Design Atlas caches are
reused by logical project ID; code snapshots stay checkout-specific. Scans
reuse the prior file manifest and reparse only changed component files when
safe. Test, configuration, imported-type, or ambiguous changes fall back to a
full scan. Memory is reindexed when its source files change or an explicit
refresh is requested. A Figma file is not remapped blindly; its sparse
source/version hash and cached scopes are reused until new metadata is supplied.

Retrieval remains focused on the current intent. Atlas returns top candidates
and expandable IDs instead of every indexed record.

## Continue or correct an existing task

`$frontend-task` enters continuation mode for requests such as “continue”,
“correct this”, or “finish what is pending”, and whenever a relevant dirty
worktree or prior outcome exists. It first inspects Git status, the focused
diff, current validation failures, and the nearest prior brief/outcome. It then
builds a delta brief containing only preserved work, remaining behavior,
affected evidence, and pending validation.

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
- findings, one decision gate, next actions, and size metrics.

It does not contain the complete repository graph, full Figma tree, all memory,
screenshots, or raw exports. The default GUI/task budget is 3,600 characters;
all project query tools enforce hard limits, small top-k defaults, and explicit
expansion.

Human browsing in the GUI does not add anything to agent context. Only an
explicit Task Workbench package is meant to be copied or sent.

## Daily flow from the GUI

The GUI is an alternative entry point to the same workflow:

1. Open the exact product checkout with `project-atlas open`.
2. Use global search or Code, Design, and Memory goal views to select evidence.
3. Choose **Use in task**. The selected handles are pinned and guaranteed to
   enter the bounded package even when task wording alone ranks them lower.
4. Review sources, findings, estimated tokens, snapshot, branch, and checkout.
5. Choose read-only preparation or workspace-write implementation.
6. Review the launch boundary, then start Codex. Atlas shows compact progress,
   supports cancellation, and renders material questions in place.
7. Correct or continue the same Codex task without rebuilding onboarding.

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
