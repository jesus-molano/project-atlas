---
name: reuse-first
description: Enforce component discovery and an explicit reuse decision before creating or substantially changing frontend UI. Use for Vue, Nuxt, React, or Next component implementation; design-to-code work; component extraction; shared API changes; and reviews that may introduce duplicate UI.
---

# Reuse First

Treat the existing component graph as required implementation context. Do not
create a component until the discovery and decision gate is complete.

## Run the gate

1. State the UI intent in one sentence: user goal, visual pattern, data, states,
   and expected interactions.
2. Interrogate missing requirements before choosing an implementation:
   accessibility, empty/loading/error states, responsive behavior, variants,
   ownership, reuse horizon, and API constraints. Ask only questions whose
   answers can change the component decision; group them into one compact batch.
3. Refresh the index with `scan_repository`.
4. Run two to four focused `search_components` queries. Include the visual
   pattern, domain intent, likely props, and known design-system primitive.
5. Inspect plausible results with `get_component`. For the strongest candidate,
   call `find_similar_components` and `list_component_usages`.
6. If extending a public API, call `analyze_prop_change_impact` before editing.
7. Choose exactly one decision:
   - `reuse`: use the existing API unchanged.
   - `extend`: add a cohesive backward-compatible variant or prop.
   - `compose`: combine existing primitives without changing their APIs.
   - `extract-and-reuse`: move a useful private pattern behind a shared API.
   - `create`: no candidate has the same responsibility or can evolve cleanly.
8. Call `record_component_decision` with selected and rejected component IDs
   plus concrete evidence. A `create` rationale must name the nearest rejected
   candidates and explain why extension or composition would be harmful.
9. Implement the recorded decision, refresh the index, and inspect the changed
   component and its impact.

## Apply scope rules

- Prefer public design-system components, then same-feature components.
- Never import a private component directly across feature boundaries. Use
  `extract-and-reuse` if its responsibility is genuinely shared.
- Do not add a boolean prop merely to hide a responsibility mismatch. A variant
  belongs on a component only when semantics, accessibility, and layout remain
  the same abstraction.
- Treat similarity as evidence, not proof. Verify behavior and ownership before
  consolidating components.
- Preserve repository-specific instructions and validation commands.

## Handle unavailable tools

Use the equivalent `component-atlas` CLI commands when MCP tools are not
available. Read [tool-map.md](references/tool-map.md) for exact mappings. If
neither MCP nor CLI is available, perform repository search manually and still
write the five-way decision before implementation.

## Report the gate

In the implementation summary, include the decision, selected component, nearest
rejected alternative, and validation performed. Keep the graph evidence concise.
