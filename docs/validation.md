# Validation and external boundary

Validated locally on 2026-07-29 without corporate data:

- relative documentation links and the five-minute installation command;
- production build: Nuxt 4.5.0, Vite 8.1.5, Vue 3.5.40;
- TypeScript build/typecheck for every package and the viewer;
- 219 tests across 54 files covering Code Atlas, Design Atlas, Project Memory,
  runtime, MCP, the viewer, and the `frontend-task` source precheck;
- cold start and idempotent Markdown rebuild;
- active versus superseded knowledge;
- contradictory active decisions and stale-memory warnings;
- previous failed attempt raised by `check_before_change`;
- strict isolation between two fixture project roots;
- stable logical identity across Git worktrees with separate checkout graph
  snapshots, same-name remote isolation, no-remote fallback, explicit override,
  and safe new scope after a remote change;
- incremental scan no-op, one-component delta, deletion-safe merge,
  configuration/imported-type fallback, cancellation, and a reproducible
  full-scan comparison;
- one shared 2,800-character task budget containing memory, code, and design;
- a runtime gate that blocks context retrieval before unresolved objectives or
  high-risk source decisions can trigger connector work;
- exact Figma `fileKey + nodeId` pinning, with missing, mismatched, candidate,
  and stale observations rejected instead of silently substituted;
- deterministic source receipts for Figma, OpenAPI, Jira, and Confluence
  identities, referenced by ID in compact context and expanded only on demand;
- OpenAPI source isolation, per-contract/operation provenance, and explicit
  conflict handling without allowing one unavailable source to erase another
  valid contract;
- safe Swagger UI canonicalization that preserves requested identity, statically
  derives only one same-origin contract, pins public DNS, bounds redirects and
  response sizes, and rejects private-network, credentialed, nonstandard-port,
  cross-origin, and ambiguous targets without executing JavaScript;
- bounded semantic task journals and strict 4 KB resume capsules, including
  TOON round-trip validation, readable JSON fallback, worktree/HEAD state,
  risk-boundary checkpoints, and completed-state TTL cleanup;
- compact retrieval telemetry for injected index bytes, hits, misses, retries,
  queried connectors, and expanded receipts;
- no-Figma fallback and Figma ranking with zero Ready for dev nodes;
- status-capable and status-unavailable Figma sources without treating
  unavailable metadata as `none`;
- page/frame status preservation, scoped-page provenance, idempotent forced
  reindexing, transient-asset filtering, and staged subtree inspection;
- one-call ChangeSurface locking for a primary login challenge, a
  reference-only Backoffice flow, and explicit profile exclusions;
- Figma asset capture with current Desktop receipt/scope provenance, hard
  format/size/SVG checks, body-free transport, external temp TTL/purge,
  checkout-contained explicit materialization, overwrite refusal, and no
  localhost endpoint leakage;
- delegation disabled by default, cost/context activation thresholds,
  two-worker concurrency, coordinator-only authority/scope/fallback/
  implementation, four compact domain contracts, and recursive raw-body/local
  endpoint rejection before coordinator injection;
- development auth-mock guards that require a challenge-only, Profile-isolated,
  credential-free, sessionless, tokenless, cookie-free, production-disabled
  adapter and reject unsafe runtime evidence/results;
- responsive/storyboard family grouping, naming findings, and small-breakpoint
  coverage warnings without false duplicate claims;
- route/layout consumers and task-aware code retrieval for dialogs, security,
  authentication, and biometric concepts;
- cursor/truncation metrics and output-size assertions;
- secret-like proposal rejection without echoing the value;
- proposal-first write, explicit confirmation, and episodic outcome;
- MCP in-memory client/server smoke with compact `structuredContent`;
- CLI end-to-end smoke for index, orient, search, task, gate, propose, apply,
  and outcome;
- dynamic connector/enrichment observations with provenance and last-check
  time, without credential probing;
- opt-in task evaluation that persists only bounded metrics and a one-way task
  fingerprint, with clear and retention behavior;
- `frontend-task` metadata/reference validation and 21 capability-routing cases:
  repository-only, Jira, Figma, Swagger/OpenAPI, all sources, absent plugins,
  absent Atlas, design-required, non-visual, native selector, chat fallback,
  continuation, correction, new high-risk biometrics using an earlier flow as
  reuse evidence, and a required API contract without a supplied link;
- portable installer PowerShell parse, dry run, isolated link/copy, and
  idempotency checks;
- optional managed `AGENTS.md` routing block: preservation, replacement,
  idempotency, dry-run, absent file, and malformed-marker refusal;
- direct Codex MCP config registration: absent/existing configs, comments and
  unrelated sections, backups, matching/conflicting blocks, explicit force,
  Windows paths, alternate `CODEX_HOME`, dry-run, and idempotency;
- complete nine-section GUI over Vuenime (78 nodes, 237 relations) and a
  temporary full fixture (4 components, 8 Figma nodes, 6 memory items);
- prior baseline browser interaction checks for transversal search, design and memory detail,
  evidence-backed risks, proposal revision/application, responsive navigation,
  accessible names, empty states, and zero horizontal overflow;
- static responsive and accessibility regressions for the new exact-Figma sync
  band, bounded three-cell source summary, progress/error/retry states, and
  context gate;
- live browser review of the Codex-first Workbench at 1440x1000, 1024x900, and
  390x844, covering source preflight, exact-Figma loading/failure/retry/cancel,
  the OpenAPI receipt ID disclosure, active and blocked resume capsules, and the
  experimental-runner hierarchy;
- zero page, composer, inspector, Figma-band, receipt, capsule, or source-summary
  horizontal overflow in those three browser sizes; long branch/source
  identities wrap within the sidecar and source actions remain independently
  operable;
- production-server API smokes for Overview, Workspace, bounded Task Context,
  repository refresh through the CLI boundary, and memory refresh.

Representative measured CLI output:

| Query | Budget | Actual compact output | Result |
| --- | ---: | ---: | --- |
| Orient | 1,600 chars | 1,498 chars | project/code/design/memory map |
| Task context | 2,800 chars | 2,583 chars | 1 memory + 1 code + 1 design |
| Figma candidate | included above | status `none` | no Ready for dev required |
| CLI Task Context on Vuenime | 2,400 chars | 1,242 chars / 311 tokens | 2 code candidates |
| GUI Task Context on Vuenime | 3,600 chars | 2,026 chars / 507 tokens | 5 code candidates |
| GUI OpenAPI visual-audit fixture | 3,600 chars | 2,295 chars / 574 tokens | 1 receipt ID · 3 hits · 0 misses/retries |

The reproducible incremental benchmark uses 300 generic Vue components with
non-trivial templates and changes one component. Three local runs measured
432–477 ms for the safe delta path versus 508–528 ms for a forced full parse
(1.06–1.19×). This is a workload measurement, not a promised threshold: small
repositories can be dominated by reliable file discovery and hashing.

The fixture deliberately contains contradictory search-filter decisions, so the
task and pre-change gates correctly return `blocked` with a specific question,
evidence, and recommendation. This is expected evaluation behavior, not a
runtime failure.

Still external and not claimed as validated:

- scope classification and component relevance on the real work repository;
- one approved Figma file/page map and one direct node selection;
- real Figma version/`lastModified` refresh behavior through the work connector;
- availability of global Variables and Code Connect;
- Jira/Confluence connector availability and source-conflict quality;
- five representative work tasks and candidate usefulness;
- company policy for committing `project-memory/` and for Obsidian/sync;
- final ranking and UX calibration with real company-scale data.

No credentials, corporate tickets, documents, designs, or repository content
were accessed or copied during local validation.
