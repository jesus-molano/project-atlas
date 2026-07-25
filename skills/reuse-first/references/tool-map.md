# Component Atlas tool map

| Purpose | MCP tool | CLI |
| --- | --- | --- |
| Refresh repository | `scan_repository` | `component-atlas scan <root>` |
| Find candidates | `search_components` | `component-atlas search <root> <query>` |
| Inspect component | `get_component` | `component-atlas show <root> <selector>` |
| Explain similarity | `find_similar_components` | `component-atlas similar <root> <selector>` |
| Find consumers | `list_component_usages` | `component-atlas impact <root> <selector>` |
| Estimate API impact | `analyze_prop_change_impact` | `component-atlas impact <root> <selector>` |
| Inspect live contract | `get_component_playground` | `component-atlas playground <root> <selector>` |
| Save shared state | `save_component_scenario` | `component-atlas scenario <root> <selector> --name <name> --props <json>` |
| Record gate | `record_component_decision` | `component-atlas decision <root> --intent <text> --decision <kind> --rationale <text>` |

Component selectors accept an Atlas ID, source path, source name, or effective
runtime name. Nuxt runtime names include directory prefixes such as `UiModal`.

Use absolute repository paths for MCP calls. Quote CLI paths that contain spaces.
