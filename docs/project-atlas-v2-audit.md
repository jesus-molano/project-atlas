# Project Atlas v2 audit and rollout plan

This document is the current product and architecture decision record. It
supersedes the earlier GUI-runner proposals and dated redesign notes.

## Decision

Project Atlas is a local evidence system for native Codex, not an agent host.
Codex owns conversation, planning, permissions, model execution, implementation,
and task continuation. Orca owns workspaces and multi-agent orchestration.
Atlas owns indexes, bounded source receipts, reusable memory, validation,
private measurements, visual review surfaces, and durable task evidence.

The v2 implementation therefore:

- removes the embedded model runner and every GUI execution route;
- keeps Code Atlas, Design Atlas, Project Memory, Action Center, Health,
  Settings, project selection, and read-only existing-checkout inspection;
- makes `$frontend-task` selectively automatic for complex implementation,
  keeps `$reuse-first` and `$visual-direction` explicit-only, and progressively
  discloses their references;
- makes the six-tool MCP core profile the default while retaining the 34-tool
  legacy profile temporarily for measured parity;
- records exact Codex totals locally when OTel/JSONL provides them and labels
  Atlas attribution and historical records honestly as estimates;
- records contract/continuation/snapshot evidence for eligible work and applies
  independent review by risk, through native Codex only.

## Confirmed cost baseline

The legacy MCP contract contains 34 tools and 34,738 serialized characters.
The former frontend skill plus mandatory references contained 44,270
characters. A median pre-task overhead near 20.6k tokens, and observed turns of
roughly 28k tokens before a complete plan, are therefore plausible.

The old ZIP is not a complete billing ledger. Its audits omit real input/cache/
output counters and compacted context, several records are truncated, and
failed records can contain no prompt length. Historical values remain visible
as incomplete estimates and are never added to exact v2 totals.

Current hard limits:

| Surface | Limit |
| --- | ---: |
| MCP core tool count | 6 |
| MCP core serialized contract | 15,925 characters (under the 16,000-character cap) |
| Selected `frontend-task` skill | 10,000 characters maximum |
| Always-loaded skill references | 0 |
| Initial Atlas task context | 3,600 characters |
| Atlas-attributable overhead target | 8k tokens p95 |

The contract order and wording remain deterministic so stable prefixes can be
cached. The benchmark must report exact contract/skill characters separately
from task context and tool responses.

## Product boundary

### Removed

- `packages/agent` and `@openai/codex-sdk`;
- the Workbench and its browser-local execution state;
- prepare, implement, continue, retry, cancel, and ask-Codex GUI actions;
- `/api/agent/runs*`, resume/cancel/status/synchronization execution routes;
- Codex adapter health and in-memory run state;
- permission/risk transitions invented by the GUI;
- global instructions that indiscriminately load `frontend-task` for all
  frontend work.

### Retained

- code/design indexes and explainable reuse candidates;
- exact checkout identity, branch/worktree support, and local diffs;
- source capabilities and bounded OpenAPI/Figma evidence;
- SQLite-backed decisions, outcomes, memory proposals, and task capsules;
- validation of change surface, visual tokens, reuse and confirmed contracts;
- local visual exploration, diagnostics, and private measurements.

The GUI is read/review oriented. Local rescans, index updates, memory decisions,
and inspection/opening of existing checkouts remain permitted product
operations; it does not create branches or worktrees, and none of them starts a
model.

## Native daily flow

1. Open native Codex in the exact checkout.
2. Describe one objective and its material links. Codex may select
   `frontend-task` automatically when the request has strong complexity
   signals, or the user may invoke `$frontend-task` explicitly.
3. Codex records checkout/branch/HEAD/dirty baseline, classifies only supplied
   or materially required sources, and resolves pending references before deep
   repository or Atlas work.
4. `atlas_prepare_task` accepts only resolved source decisions; every required
   confirmed source must carry its exact current receipt before repository scan.
   It refreshes stale indexes and returns bounded candidates, active receipt/
   relationship IDs, findings, and expandable handles for that evidence version.
5. For medium/large work, Codex records the immutable evidence contract after
   preparation: criteria, decisions, constraints, exclusions and bounded
   handles. It expands only unresolved evidence. Authoritative Figma work first
   records a receipt-bound semantic snapshot of the exact identity and coverage.
6. Codex makes the reuse decision, proposes a size-proportional plan, calls
   `atlas_lock_change_scope`, and checkpoints the initial continuation against
   that lock before editing. The same native task remains the sole writer,
   checkpoints later semantic milestones, and implements the smallest
   locked surface, runs size/risk-proportional checks and review, calls
   `atlas_validate_change`, and inspects the complete staged, unstaged,
   untracked, renamed, and deleted task delta. Visual tasks attach a structured
   review bound to the locked visual contract after temporary cleanup.
7. Changed authoritative Figma identity or required coverage requires a named
   relock window and a linked successor; raw Figma bodies never enter task evidence.
8. Before a successful technical close, the contract acceptance criteria,
   required decisions, current validation evidence and applicable independent
   review are complete. `atlas_task_state` action `complete` records the
   technical result and verification without writing Project Memory.
9. `atlas_memory` may review one exact proposal. Every mutating action first
   returns a no-write, payload-bound consent scope/token and only an unchanged
   second call after matching literal user approval may write. Technical
   completion is never memory consent.
10. A continuation reuses the same task ID and compact capsule. Without an ID,
    recovery is automatic only for one active task with the same exact checkout;
    multiple candidates require host selection. A different repository or
    incoherent objective starts a different native task.

## Six-tool MCP core

| Tool | Contract |
| --- | --- |
| `atlas_prepare_task` | Prepare one source-gated, bounded task and return size/risk, source state, candidates, receipt/relationship IDs and handles. |
| `atlas_expand_context` | Expand one named code/design/memory/receipt handle in concise or detailed form. |
| `atlas_lock_change_scope` | Persist a versioned Git-baseline lock with reuse/create/not-applicable decision, rationale, primary component/surface, references, exact allowed files, derived APIs/impact and exclusions before editing. |
| `atlas_validate_change` | Validate the complete staged/unstaged/untracked/deleted/renamed delta against the active lock, project fingerprint, reuse and confirmed API operations; block on contract drift. |
| `atlas_task_state` | Resume, record bounded evidence contracts/continuations/Figma snapshots, attach source/visual evidence or a structured review, save a semantic checkpoint/blocker, or record an immutable technical outcome with no memory write. It does not prove external delivery. |
| `atlas_memory` | Review one exact proposal, or use a two-call, payload-bound consent receipt to `record-episodic`, `propose-canonical`, `apply-canonical`, or `reject-proposal`. |

The core tools compose existing runtime logic. Administrative scanning, Figma
variables/assets, diagnostics, and bulk operations stay in CLI/GUI or the
temporary `legacy` profile. Core responses are concise and expand by opaque
handle; normal schemas expose no `raw` option.

## Sources, risk, and OpenAPI failure

Risk is based on the original objective, declared authority and affected
surface. A correction can increase risk but cannot lower it within the same
task. Removing a link never makes the task safer.

Only supplied or materially necessary sources are considered. Optional source
failure creates a structured warning with status and alternatives. Required
source failure blocks only dependent work.

For Swagger/OpenAPI 502/503/504:

1. retry once with a bounded timeout;
2. prefer a previously validated receipt when it is still acceptable;
3. inspect generated clients, repository types and contract tests as explicitly
   labelled equivalent evidence;
4. request confirmation before relying on stale authoritative evidence, or ask
   for a local specification;
5. block only contract-dependent edits when safe evidence is absent.

Receipts preserve identity, status, hash and provenance; they do not persist
remote specification bodies.

## Telemetry and privacy

`atlas telemetry serve` listens only on `127.0.0.1:4318` for OTLP/HTTP JSON.
`configure`, `status`, and `disable` own one marked `config.toml` block and make
a backup before changing it. `log_user_prompt=false` is mandatory.

`UsageTraceV2` contains exact input, cached-input, output, reasoning and total
tokens when available, plus turns, tool calls, errors, duration, compactions,
final state, model and provenance. Atlas-specific contract, skill, initial
context and response attribution remains labelled as estimated unless a direct
counter exists. A silent PostCompact hook records only anonymous session ID,
project, date, and manual/automatic kind.

Never store prompt text, code, diff contents, tool arguments, tool output,
remote response bodies, credentials, or source document bodies.

## Memory and maintainability

Task context ranks active decisions by task ID, selected components and lexical
relevance. Decision identity combines task ID, decision type and surface.
Superseded decisions remain auditable but only the active decision is injected.
Logical projects/checkouts stay isolated: frontend and backoffice may share a
verified contract receipt, never a component decision.

Production modules must stay at or below 1,200 lines. The main page is split
into shell/template and workspace state, translations are domain files with a
generated aggregate, store evaluation persistence is separate, and CLI/design
modules are split by responsibility. The maintainability audit has no
monolith exceptions.

## Independent agent review and remediation loop

### Recommendation and timing

Independent review provides enough signal for medium, large, and high-risk
changes when it is evidence-bound. It is not worth the duplicated context,
latency and false positives on every small change. Make it size-and-risk based,
not a universal standard and not a GUI option.

The v2 MCP and private telemetry foundations now provide the required boundary.
The size/risk policy enables reviewer use for medium, large, and high-risk work;
continue measuring real-task success, cost, and unsupported-finding rates and
revise the thresholds if evidence warrants it. Atlas must never create, route,
resume, cancel, or grant permissions to a reviewer.

### Native roles

- The main native Codex task is coordinator and sole writer. It confirms source
  authority, acceptance criteria, reuse, `ChangeSurface`, fallbacks and
  exclusions, then implements after human approval.
- When the host uses recovery/review agents, they are read-only and used only
  for measured context pressure or genuinely independent domains. They return
  evidence handles; Atlas does not create or schedule them, and they do not own
  scope or implementation.
- An independent reviewer starts after targeted tests, lint, typecheck and/or
  build. It receives a clean, bounded review contract, can inspect the local
  diff and run tests, but cannot edit.
- The coordinator verifies findings, performs the remediation, and requests at
  most one focused second review. The human retains scope, merge and memory
  authority.

### Activation tiers

| Tier | Trigger | Review |
| --- | --- | --- |
| Small/low | Localized change, no shared contract/security/a11y-critical path, deterministic checks pass | No agent reviewer; deterministic validation plus human diff review. |
| Medium | Shared component, stateful UI, API integration, migration of mocks, or meaningful multi-file surface | One independent correctness/architecture reviewer. |
| High | Auth/security, destructive behavior, authoritative API change, broad design-system change, or large `ChangeSurface` | Up to three narrow reviewers: correctness/architecture, UX-a11y-fidelity, security/API. |

Do not create a mega-reviewer. A specialist is activated only when its domain
appears in risk/scope. A correction cannot lower the tier for the task.

### Review input contract

The coordinator supplies only:

- task ID, original objective and approved acceptance criteria;
- locked `ChangeSurface`, explicit exclusions and risk/tier;
- source-receipt IDs and relevant expandable handles;
- local diff location/access, changed-file list and concise diff summary;
- validation commands already run, exit status and bounded failure summaries;
- reviewer specialty and questions it must answer.

Do not replay the entire skill, original conversation, indexes, policies, or
source bodies. The reviewer reads the actual checkout/diff as needed.

### Review output contract

Return `pass`, `blocked`, or `findings`. Every finding must include:

- stable finding ID and severity (`critical`, `high`, `medium`, `low`);
- file and tight line/evidence location;
- violated acceptance criterion, source contract or repository invariant;
- reproducible evidence or check;
- bounded remediation recommendation;
- explicit confidence and whether it expands approved scope.

Unsupported style preferences and unverified speculation are not findings.
Scope-expanding recommendations are reported separately and require human
approval. An empty review must explicitly return `pass` and checks performed.

### Remediation limits

1. The coordinator reproduces or verifies every finding before editing.
2. Rejected findings are recorded by category, not argued through repeated
   model turns.
3. The coordinator fixes accepted findings as the sole writer and reruns
   affected deterministic checks.
4. One second read-only pass inspects only accepted findings and newly touched
   surface.
5. Stop after two passes. Escalate conflicting reviewers, absent evidence,
   required scope expansion, or an authoritative-source conflict to the human.

### Atlas review receipt

Atlas may store a content-free `ReviewOutcome` receipt and aggregate metrics:

- anonymous task/session identity, project/checkout, risk tier, specialty and
  trigger;
- reviewer count, pass count, duration and exact/estimated token provenance;
- finding counts by severity;
- accepted, rejected, remediated and unresolved counts;
- deterministic check names/statuses and referenced receipt/handle hashes;
- final outcome (`pass`, `remediated`, `blocked`, `cancelled`).

It must not store prompts, diff/code content, comments, tool payloads or model
responses. The receipt is observational and cannot trigger another reviewer.

### Acceptance tests and rollout gates

- low-risk fixtures start no reviewer;
- every reviewer is verifiably read-only and Atlas starts no native task;
- at least 90% of reported findings contain file/evidence/criterion;
- unsupported-finding rate is at most 10% after coordinator verification;
- the remediation loop never exceeds two review passes;
- medium reviewer cost is at most 12k added tokens p95; high-risk specialist
  aggregate is measured separately and must beat a single broad reviewer on
  verified findings per token;
- privacy tests prove no prompt, code, diff or review body persists;
- mock-to-backend, 502/cached/absent contract, Figma/no-Figma, risk monotonicity
  and post-compaction fixtures all cover reviewed and unreviewed paths;
- three repeated runs per agent fixture preserve legacy task success while
  reducing median calls and Atlas overhead;
- enable by default for its qualifying tier only after 20 real tasks in at
  least two repositories reach at least 90% completion with no capability
  regression.

Recurring verified failures should become a deterministic test, validator,
small skill rule or project documentation. They should not justify a larger
review prompt.

## Parity and retirement gates

Freeze anonymized legacy fixture results before changing defaults. Core and
legacy must select equivalent evidence, OpenAPI operations, change surface and
findings. Run agent tasks three times where practical. Core cannot regress
success and must meet the 8k Atlas-overhead p95 target with fewer median calls.

Keep `--profile legacy` only through the 20-task field trial. Remove the 34-tool
profile after the success, privacy and capability gates pass; do not preserve it
indefinitely as an undocumented second product.

## External engineering basis

This direction follows the principle of using the simplest composable agent
workflow that measurably works, adding evaluator/optimizer loops only where
their value can be observed:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [OpenAI: Running Codex safely at OpenAI](https://openai.com/index/running-codex-safely/)
- [OpenAI: Introducing upgrades to Codex](https://openai.com/index/introducing-upgrades-to-codex/)
- [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [OpenAI prompt caching](https://openai.com/index/api-prompt-caching/)

Independent model review remains an evaluator, not proof. Track false
positives and require reproducible evidence; empirical software-engineering
research continues to find reliability limitations in LLM-as-judge setups.
