# Quality audit

This document records the reproducible local quality baseline for Project
Atlas. It is evidence from bounded tests, not a claim that long-running
processes can never leak or that every external dependency is defect-free.

## Run the checks

```powershell
pnpm audit:architecture
pnpm test:quality
pnpm audit --prod --audit-level=low
pnpm test
pnpm typecheck
pnpm build
```

`test:quality` builds the packages and GUI before running with explicit garbage
collection. It uses temporary generic Vue/Figma fixtures and deletes them when
finished. It does not read work repositories or external services.

## Baseline — 2026-07-26

Environment: Windows, Node 26.1.0, Nuxt 4.5.0, Vite 8.1.5 and Vue 3.5.40.
Supported production Node remains `>=24`.

| Check | Result |
| --- | --- |
| Repeated runtime cycles | 12 complete scan/orient/search/task-context/gate/Figma/proposal/outcome cycles |
| Heap after explicit GC | 32.47–33.28 MiB; 0.81 MiB bounded-sample growth |
| Non-stdio active handles | 0 before; 0 after |
| Viewer lifecycle | 3 start/stop cycles and 3 occupied-port checks; no process kept the test alive |
| Package graph | 10 packages, 23 internal edges, 0 cycles |
| Dependency audit | 0 known production vulnerabilities after scoped overrides |
| Compact Task Context | asserted at or below its 2,000-character hard cap in every stress cycle |

The active-handle count uses Node's diagnostic `_getActiveHandles` API and the
heap sample covers seconds, not days. These checks catch regressions and
monotonic growth in repeated local work; they do not prove the absence of every
possible leak.

### Performance fixture

The generated components deliberately share an API and style shape. This is a
worst case for similarity density.

| Size | Components | Relations | Initial scan | Rescan |
| --- | ---: | ---: | ---: | ---: |
| Small | 10 | 44 | 30.1 ms | 13.0 ms |
| Medium | 100 | 764 | 86.6 ms | 46.7 ms |
| Large | 300 | 2,364 | 209.4 ms | 137.3 ms |

Focused operations on the generic fixture measured 7.3 ms for memory search,
8.7 ms for Task Context and 7.4 ms for an idempotent Figma remap. Viewer
start/stop plus occupied-port verification averaged 273.3 ms per cycle.
Timings are directional and will vary by machine.

Before the similarity fix, the same large fixture produced 44,850 relations
and a 1,789.1 ms rescan. Similarity now uses shared-signal neighborhoods and a
top-eight candidate cap per component. Exact evidence scoring is unchanged.

## Findings and corrections

### P0

No P0 defect was reproduced locally. This means none was found by the listed
checks; it is not a formal proof of absence.

### P1

| Finding | Evidence and cause | Correction and regression check |
| --- | --- | --- |
| Similarity graph could grow quadratically | 300 same-shape components formed 44,850 similarity edges | Bounded signal neighborhoods and top-k edges; large fixture now has 2,364 relations and a contract test enforces the cap |
| GUI refresh could leave an unbounded child | Refresh spawned scan without timeout, abort propagation or output cap | Shared bounded process runner with 60 s timeout, 1,000,000-character cap and request abort; success/timeout/output/cancel tests |
| Production dependency advisories | Audit found one high `brace-expansion` DoS and one moderate Windows Hono traversal advisory | Scoped pnpm overrides to patched versions; production audit reports no known vulnerabilities |

### P2

| Finding | Evidence and cause | Correction and regression check |
| --- | --- | --- |
| Corrupt design parents could loop | Breadcrumb traversal had no visited set | Cycle detection and 128-level cap with corrupt-index test |
| Deep or cyclic Figma metadata was unbounded | REST and helper traversals were recursive; XML accepted unlimited nesting | 10,000-node and 128-level hard limits, iterative helper traversal and cycle fixtures |
| Memory inspection could recurse forever | Secret scan followed object graphs recursively | Iterative traversal, `WeakSet`, 10,000-node and 64-level limits; cyclic/deep tests |
| Malformed cursor restarted at page zero | A decoded non-integer offset returned `0` | Invalid cursors now fail clearly; contract test |
| Render cycles counted a component as its own impact | Reverse BFS seeded without excluding the target | Target is previsited and excluded; self/cycle test |
| Memory JSON boundaries trusted TypeScript casts | CLI/GUI data could reach runtime with invalid types or confidence | Runtime validates 1–20 typed drafts and outcomes before persistence; malformed-boundary tests |
| Memory writes could follow a project-local symlink outward | Lexical path containment did not resolve filesystem links | Canonical/local directories and rewritten sources are checked with `realpath`; memory glob does not follow symlinks |
| Local GUI trusted arbitrary Host/Origin headers | Loopback binding alone did not prevent DNS-rebinding/cross-origin mutation attempts | Middleware accepts loopback Host only and rejects non-local mutation origins; policy tests |
| Viewer readiness could accept an unrelated service | Startup checked only an HTTP 2xx at the port | Readiness now validates `/api/workspace` and the expected project ID, with bounded fetch time |

### P3 and residual risk

- SQLite row casts remain encapsulated in the store boundary because
  `node:sqlite` result typing is intentionally generic. Corrupt persisted JSON
  fails loudly; a future schema migration can add per-row validation if Atlas
  begins accepting databases from untrusted sources.
- Nuxt/Nitro currently emits upstream optional template-engine and Node
  deprecation warnings while building. The earlier browser bundle warning for
  `node:crypto`/`node:path` was fixed by a browser-safe core export. The
  remaining warnings did not fail build or runtime smoke tests.
- A second Nitro process on an occupied port exits cleanly with code `0` in the
  current upstream version. Project Atlas verifies the expected project
  fingerprint before accepting an existing listener, and lifecycle tests show
  no orphan. The upstream exit code itself is not controlled here.
- Final precision still requires the documented external validation with a real
  work repository, permitted Figma source and representative tasks. No
  corporate data is part of this baseline.

## Covered termination and isolation cases

- cyclic and self-referential component render graphs;
- cyclic parent relationships and deep/cyclic Figma metadata;
- cyclic and deeply nested memory payloads;
- invalid pagination cursors;
- two concurrent scans of the same project;
- two isolated project databases;
- repeated SQLite open/read/write/close cycles;
- repeated viewer start/stop and occupied-port behavior;
- child timeout, cancellation and output overflow;
- compact response hard budgets as indexes grow.

The package dependency audit also enforces the intended direction:
core/memory → adapters/design → store → runtime → MCP/CLI/GUI.
