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

`atlas_lock_change_scope` persists ChangeSurface v2 as a task-bound, immutable,
SHA-256-addressed artifact. The lock records the original Git baseline, the
normalized intent and evidence handles, allowed and reference files, explicit
exclusions, the reuse decision, current source-ledger authority, and scoped
graph/theme fingerprints. Callers cannot supply or override those fingerprints.

`atlas_validate_change` captures the fresh task delta relative to that baseline,
including staged, unstaged, untracked, renamed, and deleted files. It verifies
the lock artifact and its integrity before reporting bounded findings for:

- files or API operations outside the locked boundary;
- ambient component, entity, token, or theme drift outside files intentionally
  allowed by the lock;
- new visual literals outside indexed tokens;
- foreign breakpoints and missing interaction-state evidence;
- recreation of known project primitives;
- paths incompatible with explicitly confirmed OpenAPI operations.

OpenAPI validation reports `coverage: partial` with the
`direct-literal-calls` detector. It checks direct `fetch`/`$fetch`/`useFetch`
and `axios.<method>` calls whose route is a string literal. Wrappers, generated
SDK methods, variables, and template-derived paths remain outside this static
detector; a zero-call result is therefore not proof that no API call changed.
Repository tests, generated-client checks, typecheck, and review remain required
for those patterns.

Contract escapes, missing authority, tampered/stale artifacts, and fresh delta
changes after validation are blocking. Heuristic findings remain warnings unless
a governing contract or safety rule elevates them. Codex still runs repository
tests, typecheck, lint and build and reviews the complete diff.

Legacy ChangeSurface v1 data is never trusted as an implementation lock. Loading
it preserves intake/source context but returns the task to `prepared`, discards
derived validation/review/completion state, and requires an explicit v2 relock.

## Telemetry privacy

The optional receiver binds to `127.0.0.1`. Managed Codex configuration fixes
`log_user_prompt=false`. Tests inject secret-like prompt/code/tool content and
verify it never reaches SQLite or exports. PostCompact stores only anonymous
session identity, project, date and manual/automatic kind.

## Required quality gates

```text
pnpm test:kit
pnpm test:kit:shell # Linux native installer/doctor
pnpm check:ci
pnpm test:unit:built --maxWorkers=2
pnpm test:coverage:built --maxWorkers=2
pnpm benchmark:context-cost:built
pnpm test:launcher:built
pnpm test:e2e:built
pnpm audit --prod --audit-level high
```

`check:ci` owns lint, CSS lint, architecture/product/docs/maintainability/summary
audits, the production build, typecheck, and build-artifact verification. CI
runs the shared kit and static gates on Windows and Ubuntu, the native Bash kit
on Ubuntu and in an Arch Linux container, launcher behavior on Windows and
Ubuntu, and unit/coverage/benchmark/E2E checks on their designated matrix
platforms. A failed Linux end-to-end run retains its Playwright report and test
artifacts for seven days when those files exist.

Independent agent review is an additional risk-based evaluator, never a
replacement for deterministic checks or human merge review.
