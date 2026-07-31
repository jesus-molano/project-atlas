# Security and validation boundary

## Native execution

Atlas never translates risk into Codex permissions. Native Codex owns read-only
planning, workspace-write and command approval. The GUI contains no model
execution endpoint.

## Source safety

External document retrieval enforces protocol/host validation, loopback and
private-network restrictions, redirect checks, content/size limits and bounded
timeouts. OpenAPI transient failures retry once. Receipts store provenance and
hashes rather than response bodies.

## Change validation

`atlas_validate_change` reads the local diff and reports bounded findings for:

- new visual literals outside indexed tokens;
- foreign breakpoints and missing interaction-state evidence;
- recreation of known project primitives;
- paths incompatible with explicitly confirmed OpenAPI operations.

Findings are advisory unless a governing contract/safety rule requires a block.
Codex still runs repository tests, typecheck, lint and build and reviews the
complete diff.

## Telemetry privacy

The optional receiver binds to `127.0.0.1`. Managed Codex configuration fixes
`log_user_prompt=false`. Tests inject secret-like prompt/code/tool content and
verify it never reaches SQLite or exports. PostCompact stores only anonymous
session identity, project, date and manual/automatic kind.

## Required quality gates

```text
pnpm lint
pnpm lint:css
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm audit:architecture
pnpm audit:artifacts
pnpm audit:maintainability
pnpm audit:docs
pnpm audit:summary
```

Independent agent review is an additional risk-based evaluator, never a
replacement for deterministic checks or human merge review.
