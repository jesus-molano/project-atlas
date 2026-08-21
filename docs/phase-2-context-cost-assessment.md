# Context-cost assessment

The historical v1 baseline measured 34 MCP tools, a 34,687-character contract,
and 44,270 characters of skill plus mandatory references. The deterministic
fallback benchmark produced roughly 20.6k estimated input tokens before normal
conversation and reasoning. Those values explain the observed pre-plan cost but
are not billing totals.

Atlas v2 uses a six-tool core contract, a selectively loaded skill with zero
always-loaded references, and a 3,600-character initial context cap. The legacy
profile remains available only for parity evaluation.

## UsageTraceV2

Exact current totals come from opt-in local Codex OTel/JSONL events:

- input, cached-input, output, reasoning and total tokens;
- turns, tool calls, errors, duration and compact events;
- final state, model and provenance.

Atlas attribution separately reports contract, loaded skill, initial context
and responses. It remains labelled estimated where no direct counter exists.
Historical ContextCostAudit imports are shown as incomplete estimates and never
mixed into exact totals.

The local receiver stores no prompts, paths, URLs, source bodies, code, diffs,
tool arguments or tool output. Export is explicit and content-free.

## Benchmark

`pnpm benchmark:context-cost` runs the fixed isolated task matrix and reports
the current core contract, selected skill size, context groups and privacy
statement. Release targets are:

- Atlas-attributable overhead at or below 8k tokens p95;
- no automatic compaction before the plan on standard cases;
- v2 success not below legacy across three repeated agent runs;
- fewer median MCP calls with equivalent evidence, OpenAPI operations,
  `ChangeSurface` and findings.

See [the v2 audit and rollout plan](project-atlas-v2-audit.md) for the complete
parity and retirement gates.
