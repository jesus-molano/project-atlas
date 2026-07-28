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
| Direct Figma node | Read sparse metadata through Figma Desktop MCP, persist it with `map_figma_file`, then inspect the confirmed node; load any required Codex/Figma skill only as instructions or an operation prerequisite | Use another connector, manual selection, or supplied screenshot/spec only when Figma Desktop MCP is not connected, not authorized, or lacks the operation; do not infer missing values |
| Map Figma file/page | Read sparse metadata through Figma Desktop MCP, loading any required Codex/Figma skill for that desktop MCP operation, then `map_figma_file` | Use another connector or `component-atlas figma map` with saved XML/JSON metadata only when Figma Desktop MCP is not connected, not authorized, or lacks the operation |
| Rank design candidates | `find_design_candidates` | `component-atlas figma find` |
| Inspect cached node | `inspect_design_node` | `component-atlas figma inspect` |
| Exact node variables | Figma Desktop MCP `get_variable_defs` after confirmation, with the applicable Codex/Figma skill used only as instructions/prerequisite | Repository tokens and screenshot evidence only when Figma Desktop MCP is not connected, not authorized, or lacks the operation |
| Global variable modes | Figma Desktop MCP read-only Variables catalog when permitted, with Codex/Figma skill prerequisites followed | Collection/mode hints or selection-only variables only when Figma Desktop MCP is not connected, not authorized, or lacks the operation |

## Figma routing rules

- Prefer Figma Desktop MCP—the local MCP server exposed by the Figma desktop
  application—for every supported read or write after source confirmation.
  Connect and use it when available and authorized. A Codex/Figma skill supplies
  instructions or a mandatory operation prerequisite; it is not an alternative
  transport and must not displace, bypass, or get ahead of the desktop MCP.
- Use another connector, manual selection, or alternative evidence only when
  Figma Desktop MCP is not connected, not authorized, or does not cover the
  operation, and state which condition applies.
- As preparation starts, ingest every confirmed Figma reference with sparse
  Figma Desktop MCP metadata and `map_figma_file`, then refresh the Atlas
  task/design snapshot. This persists Design Atlas before code work or task
  completion. Never probe the desktop MCP before confirmation.
- A direct node URL or active user selection skips candidate ranking, not the
  sparse persistence step.
- Expose loading, available, confirmed-but-unsynchronized, and concrete
  access/sync-error states instead of leaving an unexplained empty design view.
- For a large confirmed frame, use sparse child metadata to locate the smallest
  relevant subtree before requesting deep context. If that cannot be isolated,
  request a manual selection; never hide target truncation.
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
