# Capability routing

Use only capabilities present in the current environment. Missing optional
sources reduce evidence; they do not invalidate the workflow.

| Need | Preferred route | Fallback |
| --- | --- | --- |
| Repository instructions | Local files and source search | Ask for repository path only if it cannot be discovered |
| Jira task | Connected Jira read/search from supplied issue | Supplied text or conversation |
| Confluence context | Connected Confluence read/search from supplied page | Supplied text or omit |
| Swagger/OpenAPI contract | Confirmed supplied URL, local file, or pasted contract; extract a bounded task-relevant subset | Ask for the contract when required, or omit when optional |
| Refresh component graph | `scan_repository` | `component-atlas scan <root>` then manual search |
| Observe connector/enrichment state | `report_source_capabilities`, then `get_source_capabilities` | `component-atlas capabilities report/show` |
| Compact project orientation | `orient_project` | `component-atlas memory orient <root>` |
| Shared task context | `get_task_context` | `component-atlas memory task <root> <intent>` |
| Search project knowledge | `search_project_memory` | `component-atlas memory search <root> <query>` |
| Expand confirmed memory | `get_memory_item` | `component-atlas memory show <root> <id>` |
| Prevent repeated/contradictory change | `check_before_change` | `component-atlas memory check <root> <intent>` |
| Propose durable learning | `propose_memory_update` | `component-atlas memory propose <root> <json>` |
| Confirm proposed learning | `apply_memory_update` with explicit confirmation | `component-atlas memory apply <root> <id> --confirm` |
| Record task episode | `record_outcome` | `component-atlas memory outcome <root> <json>` |
| Opt-in private task metrics | `record_task_evaluation` | `component-atlas evaluation record <root> --input <json>` |
| Compact reuse candidates | `get_reuse_context` | `component-atlas context <root> <intent>` |
| Inspect code candidate | `get_component` | `component-atlas show <root> <selector>` |
| Similarity or usages | `find_similar_components`, `list_component_usages` | `component-atlas similar` or `impact` |
| Shared API impact | `analyze_prop_change_impact` | `component-atlas impact` plus source/test inspection |
| Record reuse decision | `record_component_decision` | `component-atlas decision` |
| Direct Figma node | Use Figma Desktop MCP at `http://127.0.0.1:3845/mcp`; read `get_metadata`, persist it with `map_figma_file`, then inspect/retrieve the confirmed node; load any required Codex/Figma skill only as instructions or an operation prerequisite | Use another connector, manual selection, or supplied screenshot/spec only when the local MCP is not connected, rejects/times out, does not respond, is unauthorized, or lacks the operation; briefly state the fallback reason and do not infer missing values |
| Map Figma file/page | Use Figma Desktop MCP at `http://127.0.0.1:3845/mcp`; discover pages and read relevant sparse `get_metadata`, then call `map_figma_file` | Use another connector or `component-atlas figma map` with saved XML/JSON metadata only for a stated local connection, response, authorization, or operation failure |
| Rank design candidates | `find_design_candidates` | `component-atlas figma find` |
| Inspect cached node | `inspect_design_node` | `component-atlas figma inspect` |
| Exact node variables | Figma Desktop MCP `get_variable_defs` after confirmation, with the applicable Codex/Figma skill used only as instructions/prerequisite | Repository tokens and screenshot evidence only when Figma Desktop MCP is not connected, not authorized, or lacks the operation |
| Global variable modes | Figma Desktop MCP read-only Variables catalog when permitted, with Codex/Figma skill prerequisites followed | Collection/mode hints or selection-only variables only when Figma Desktop MCP is not connected, not authorized, or lacks the operation |

## Figma routing rules

- Prefer Figma Desktop MCP at `http://127.0.0.1:3845/mcp` for every context
  read and operation it advertises after source confirmation. Resolve and use
  this exact local connection before any global MCP registration or remote
  Figma connector. Never select the global/remote route first while the local
  server is connected, responsive, authorized, and exposes the needed tool.
  A Codex/Figma skill supplies instructions or a mandatory operation
  prerequisite; it is not an alternative transport.
- Do not invent a Figma health API. Determine usability from the active MCP
  connection's exposed tools and the lightweight operation required by the
  workflow.
- Use another connector, manual selection, or alternative evidence only when
  the local MCP is not connected, rejects or times out on the request, does not
  respond, is unauthorized, or does not expose the operation. Add one concise
  explanation naming that condition and the fallback route used.
- As preparation starts, ingest every confirmed Figma reference with sparse
  Figma Desktop MCP metadata and `map_figma_file`, then refresh the Atlas
  task/design snapshot. This persists Design Atlas before code work or task
  completion. Never probe the desktop MCP before confirmation.
- A direct node URL or active user selection skips candidate ranking, not the
  sparse persistence step.
- Expose loading, available, confirmed-but-unsynchronized, and concrete
  access/sync-error states instead of leaving an unexplained empty design view.
- Before every deep-context request, preinspect with `get_metadata` or the
  available sparse hierarchy mechanism. For a file/page, first discover pages,
  then inspect only relevant page metadata. Estimate complexity from node
  types, dimensions, child structure, sections/frames, and repeated state or
  viewport families; do not assume an exact size estimator exists.
- Treat a shallow bounded component/frame as small and request
  `get_design_context` directly with the standard client timeout. Treat broad
  pages, large screens, deep trees, and many sibling sections/frames as large:
  segment from the outset by task-relevant section, frame, or child and keep
  each successful result before proceeding.
- On timeout, do not retry an unchanged request with a higher timeout. Reduce
  scope from the sparse hierarchy, split into smaller children, and continue
  incrementally. If no meaningful subtree can be isolated, request a manual
  selection; never hide target truncation.
- If a full-page read exceeds limits, fails, or times out, keep the confirmed
  page URL/file/node identity as the parent scope. Obtain a lightweight global
  view with `get_screenshot` when the active local MCP exposes it, or use a
  supplied screenshot/cached Atlas summary. Pair it with economical
  `get_metadata` hierarchy/IDs; use cached `inspect_design_node` only when
  Design Atlas already contains the scope.
- Group relevant components, frames, related siblings, or flow/viewport
  families into small batches. Adapt batch size to returned complexity:
  preserve successful batches, shrink after an oversized result, and never
  resend already covered context. Batching need not degrade immediately to one
  node per request.
- Assemble an incremental result that names the original page, covered scope
  IDs, omitted unrelated scopes, and any remaining gaps. If metadata or a
  screenshot is unavailable, document which evidence is missing and request a
  narrower link, manual selection, screenshot, or export instead of fabricating
  hierarchy or dropping the page reference.
- A file/page without a confirmed target uses sparse metadata first; never
  request deep context for every node.
- Ready for dev adds evidence but is not an eligibility condition.
- `source-unavailable` means the connector did not expose dev status; it never
  means the node has no Ready for dev state.
- With no Ready for dev nodes, rank names, path, annotations, links,
  components/variants, device context, and Atlas signals normally.
- When several candidates remain close, ask the user to choose using node names,
  links, evidence, and a recommendation.
- When no node matches, offer proceeding without Figma or accepting a direct
  link. Do not fabricate a match.
- Do not retain `localhost` asset URLs from a Figma session as durable evidence.
- Group related viewport/storyboard nodes before reporting duplication, and do
  not infer small breakpoints that are absent from metadata.

## Source conflict precedence

Do not silently choose between contradictory product sources. Present the
smallest conflict with a recommendation based on recency and specificity:

1. explicit user clarification in the current task;
2. acceptance criteria or ticket decision;
3. confirmed Swagger/OpenAPI contract for request, response, authentication,
   and endpoint semantics;
4. confirmed design node and annotations;
5. supporting Confluence context;
6. repository behavior and conventions.

This is a decision aid, not a universal authority order. Security,
accessibility, and data-integrity constraints can override a visual source and
must be called out.
