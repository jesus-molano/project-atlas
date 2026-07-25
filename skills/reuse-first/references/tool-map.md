# Project Atlas code-tool map

| Purpose | MCP tool | CLI |
| --- | --- | --- |
| Refresh repository | `scan_repository` | `component-atlas scan <root>` |
| Get compact task context | `get_reuse_context` | `component-atlas context <root> <intent>` |
| Find extra candidates | `search_components` | `component-atlas search <root> <query>` |
| Inspect component | `get_component` | `component-atlas show <root> <selector>` |
| Explain similarity | `find_similar_components` | `component-atlas similar <root> <selector>` |
| Find consumers | `list_component_usages` | `component-atlas impact <root> <selector>` |
| Estimate API impact | `analyze_prop_change_impact` | `component-atlas impact <root> <selector>` |
| Record gate | `record_component_decision` | `component-atlas decision <root> --intent <text> --decision <kind> --rationale <text>` |
| Cache sparse Figma map | `map_figma_file` | `component-atlas figma map <root> <url> --metadata <file>` |
| Match task to design | `find_design_candidates` | `component-atlas figma find <root> <task>` |
| Inspect confirmed design node | `inspect_design_node` | `component-atlas figma inspect <root> <file> <node>` |

Component selectors accept an Atlas ID, source path, source name, or effective
runtime name. Use absolute repository paths and quote CLI paths with spaces.
Focused queries are compact by default. CLI `--raw` and MCP `raw: true` expose
full index data and are intended only for diagnostics.
