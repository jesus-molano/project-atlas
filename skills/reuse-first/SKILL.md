---
name: reuse-first
description: Enforce component discovery and an explicit reuse decision before creating or substantially changing frontend UI. Use for Vue, Nuxt, React, or Next implementation, design-to-code work, component extraction, shared API changes, and reviews that may introduce duplicate UI.
---

# Reuse First

Treat the existing component graph as required implementation context. Do not
create a component until the discovery and decision gate is complete.

## Run the gate

1. State the UI intent in one sentence: goal, pattern, data, states, and
   interactions.
2. Ask only missing questions whose answers can change the component decision:
   accessibility, empty/loading/error behavior, responsive rules, variants,
   ownership, reuse horizon, and API constraints.
3. Refresh the index with `scan_repository`.
4. Call `get_reuse_context` once using the full implementation intent.
5. Inspect the ranked candidates, scopes, API summaries, composition,
   consumers, similarity evidence, tests, and impact in that bundle.
6. Use `get_component`, `find_similar_components`, or
   `list_component_usages` only when the compact bundle leaves a concrete
   ambiguity. Keep their compact default; request `raw` only to diagnose an
   incorrect index.
7. Call `analyze_prop_change_impact` before extending a shared API.
8. Choose exactly one decision:
   - `reuse`: use the existing API unchanged.
   - `extend`: add a cohesive backward-compatible variant or prop.
   - `compose`: combine existing primitives without changing their APIs.
   - `extract-and-reuse`: move a useful internal pattern behind a shared API.
   - `create`: no candidate has the same responsibility or can evolve cleanly.
9. Call `record_component_decision`. A `create` rationale must name the nearest
   rejected candidates and explain why extension or composition is harmful.
10. Implement, validate with the target repository's own checks, refresh the
    index, and verify that the graph reflects the result.

## Apply scope rules

- Prefer shared components, then same-feature components.
- Never import an internal component directly across feature boundaries.
- Do not add a boolean prop merely to hide a responsibility mismatch.
- Treat similarity as evidence, not proof.
- Preserve repository-specific instructions and validation commands.

## Handle unavailable tools

Use the equivalent CLI commands from `references/tool-map.md` when MCP is not
available. If neither is available, search the repository manually and still
write the five-way decision before implementation.

## Use optional design evidence

When the parent workflow supplies Figma context, prefer a confirmed node. If it
supplies only a file/page, use `find_design_candidates` and respect its gate:
stop for `decision-required`, report `warning` with its recommendation, and keep
`resolved` findings as non-blocking evidence. Do not request deep design
context, variables, or a screenshot until the node is confirmed. Missing Figma
or global Variables access does not block the component gate.

## Integration boundary

This workflow is the component-decision module for a future global
`frontend-task` skill. The parent skill may supply Jira, Confluence, Figma,
screenshots, or pasted requirements. Do not assume any source is installed and
do not invent missing external context.

## Report the gate

Report the intent, decision, selected component, nearest rejected alternative,
graph evidence, and validation. Keep it concise.
