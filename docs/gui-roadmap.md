# Project Atlas GUI — final phase

The complete local GUI is a required product phase, but it starts only after
the context engine is stable. It is a human observation/control plane over the
same runtime, SQLite indexes, and Markdown—not another backend or source of
truth.

## Required sections

1. Overview: active project, index freshness, source health, warnings, pending
   memory, and recent activity.
2. Code Atlas: search, modules/components, relations, uses, similarity, impact,
   scope, tests, and source links.
3. Design Atlas: files/pages/frames, optional Ready for dev signal,
   variables/modes, candidates, Code Connect links, and provenance.
4. Project Memory: typed search, decisions, conventions, attempts, outcomes,
   freshness, authority, relationships, and backlinks.
5. Decisions & Risks: conflicts, superseded/stale knowledge, fragile areas,
   failed attempts, evidence, and recommendations.
6. Task Context: task input, detected sources, candidates, compact package, and
   controlled expansion.
7. Memory Inbox: proposal diff/evidence plus approve, reject, edit, merge, and
   supersede actions.
8. Integrations & Health: repository, optional Figma/Jira/Confluence,
   permissions, Code Connect, caches, refresh, and errors.
9. Settings: project scopes, budgets, top-k, write policy, storage, privacy, and
   diagnostics.

No important capability may remain CLI/MCP-only when this phase is complete.
CLI and MCP stay first-class for agents and automation.

## Architecture contract prepared now

`packages/runtime/src/view-models.ts` defines section names, provenance,
freshness, source health, memory-list/proposal models, and the Context Inspector.
Future local HTTP handlers compose these types from the same runtime functions
used by MCP and CLI. GUI navigation reads local data and never invokes an LLM.

“Send to Codex/Claude” is an explicit sequence: select items, generate a
hard-capped package, inspect size/truncation, then copy/send. Seeing a full
human detail view never implies that detail enters agent context.

## UX direction

Project Atlas should feel like an evidence and decision instrument: modern,
sobriely dense, keyboard-friendly, and specific to code/design/memory
relationships. Use lists/tables for exact values and graphs only when they
clarify relations. Every material assertion exposes provenance and freshness.
Avoid SaaS heroes, decorative cards, unexplained counts, and generic dark-mode
styling. Include accessible focus, responsive layouts, and complete
empty/loading/error/offline states.

This is not the removed Lab: no component previews, style reproduction, or
server on port 4174.

## Gates

Do not implement screens until:

- Project Atlas migrations and memory policy are stable;
- MCP/CLI contracts and hard-budget tests pass;
- provenance, secret prevention, and cross-project isolation pass;
- the portable kit and another-computer setup are documented;
- the backend has a final review.

Local engineering gates can be completed without corporate data. Final ranking
and UX tuning should also use a real repository, an approved real Figma file,
and five representative tasks when available.

## Vertical implementation order

1. shell, project switcher, Overview, and transversal search;
2. Code Atlas, Design Atlas, and Project Memory;
3. Decisions/Risks, Task Context/Inspector, and Memory Inbox;
4. Integrations/Health and Settings;
5. accessibility, performance, section coverage, and visual QA.

Until those sections exist and pass their tests, report the GUI—and therefore
the full Project Atlas product—as pending final phase.
