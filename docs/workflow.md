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

Code Atlas refreshes reconstructible repository facts against the current
checkout. Existing Project Memory and Design Atlas caches are reused by project
ID. Memory is reindexed when its source files change or an explicit refresh is
requested. A Figma file is not remapped blindly; its sparse source/version hash
and cached scopes are reused until new metadata is supplied.

Retrieval remains focused on the current intent. Atlas returns top candidates
and expandable IDs instead of every indexed record.

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
explicit Task Context package is meant to be copied or sent.

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
node $cli context $repo "empty state with retry"
node $cli memory orient $repo --budget 2400
node $cli memory task $repo "empty state with retry" --budget 3600
node $cli memory check $repo "change empty state API"
node $cli show $repo UiEmptyState
node $cli similar $repo UiModal
node $cli impact $repo UiModal
node $cli open $repo
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
