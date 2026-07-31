# Phases 3–5 implementation record

## Frontend Code Graph v5

`ComponentGraph` schema v5 preserves components, routes, layouts, tokens, and
existing edges while adding semantic entities for composables/hooks, stores and
contexts, endpoints, stories, and tests. New relationships record resolution
(`exact`, `framework-convention`, or `inferred`) and source provenance.

Vue/Nuxt is the reference implementation. Vue SFCs are parsed with the official
Vue compiler; TypeScript/JavaScript modules use a TypeScript Program and symbol
resolution. Nuxt autoimports are represented as framework conventions rather
than exact imports. Static `$fetch`, `useFetch`, `fetch`, Axios, and generated
client calls become endpoints; dynamic paths remain ambiguous/inferred.

React/Next and Astro expose the same entity/edge contract. React hooks, contexts,
stores, routes, stories, tests, and endpoints use TypeScript analysis. Astro
frontmatter is first validated with the official Astro compiler, then analyzed
under the same contract. Relationships without compiler-resolved identity are
explicitly degraded and never labelled exact.

Semantic analysis runs from the current source set on every incremental scan, so
changes to imports, stores, composables, stories, tests, endpoints, framework
configuration, and OpenAPI-related files cannot leave stale semantic edges.
Schema v4 graphs are reconstructible and force a full v5 rescan.

`create` reuse decisions now retain every ranked candidate considered, rejected
IDs, reasons, and compact evidence. Task context contains only task-relevant
semantic entities and relations, never the complete graph.

## Project Theme Fingerprint and diff validation

Every scan creates a deterministic content hash from CSS/Tailwind text, indexed
tokens, typography, spacing, radii, shadows, breakpoints, frequently used
primitives/variants, form and state patterns, responsive evidence, and up to
three representative routes. Tailwind configuration is read as text and never
executed.

Confirmed, current Figma variable receipts can enrich the fingerprint. Only
compact variable identities, hashes, counts, and receipt IDs are retained.

`validate_diff` is the sole additive MCP operation. The equivalent CLI command
is:

```text
atlas validate-diff <project>
```

It computes the local Git diff without a shell and emits advisory warnings for
new visual literals, unfamiliar breakpoints, likely duplicate primitives,
missing comparable interactive states, and paths incompatible with explicitly
confirmed OpenAPI operations. Theme findings never block; existing security,
source-provenance, and required-contract gates remain authoritative. Code Atlas
and native MCP validation expose the same compact fingerprint/findings without
adding a GUI execution surface.

## Figma Page Planner v2

`DesignFileIndex` schema v5 remains able to normalize older indexes. Inspecting a
confirmed node now returns a typed metadata-first `DesignRetrievalPlan`:

1. map lightweight metadata;
2. query Code Connect before deep context;
3. rank every considered region using hierarchy, position, instances,
   annotations, development status, and mappings;
4. select three to six bounded subtrees, or all when fewer than three exist;
5. issue bounded `get_design_context` and screenshot calls.

Atlas does not call Figma deep context itself. Codex must use the local Figma
Desktop MCP first. Another route is valid only when the confirmed source ledger
allows it and records why.

Truncated or excessive responses are split into smaller child calls. The
adaptive plan preserves the confirmed target and refuses to repeat the same
deep call with a longer timeout.

When `inspect_design_node` receives a task ID, Atlas stores a compact
task-scoped `DesignCoverageLedger`. Every considered node is selected, omitted,
failed, unavailable, or analyzed with reason, confidence, hash, and receipt
references. Deep responses, screenshots, binaries, localhost URLs, and assets
are never persisted in the ledger.

The design-link registry gives exact Code Connect mappings priority, keeps
confirmed mappings project/commit-scoped, and confines inferred mappings to the
task. A conflicting component mapping raises an explicit decision instead of
silently overwriting the existing link.

Resume capsule schema v3 stores only the Theme Fingerprint hash and the coverage
ledger ID/hash plus selected node IDs. Capsules v1/v2 are accepted and upgraded
at the next checkpoint while preserving the 4 KB limit.
