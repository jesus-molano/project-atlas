# Source and capability precheck

Run this lightweight precheck before reading external detail or asking the
user for links.

## Detect

1. Resolve the current repository/cwd and the supplied task text.
2. Detect only explicit Jira keys/links, Confluence links, Figma file/node
   links, GitHub references, and immediate references already attached to the
   task. Do not crawl broadly.
3. Inspect the tools actually available in this session:
   - Atlassian Rovo for Jira/Confluence;
   - Figma for design;
   - GitHub for relevant remote repository/issue context;
   - Project Atlas MCP for local code/design/memory context.
4. Classify each source for this task:

| Source | Required | Recommended/optional | Not applicable |
| --- | --- | --- | --- |
| Repository | Any code implementation | — | Non-code advice only |
| Figma | Reproduce a declared source-of-truth design | Other visual work | Non-visual work |
| Jira | Missing acceptance criteria live in the ticket | Brief is already sufficient | No ticket relationship |
| Confluence | Declared authorized spec/policy is necessary | Supporting domain context | No spec/policy relationship |
| Atlas | Never | When component/design/impact/memory context helps | No useful indexed context |
| GitHub | Remote issue/PR/repository evidence is needed | Useful remote history | Local evidence is sufficient |

Use `unavailable` instead when a relevant source is identified but its
capability is absent or unauthorized. Never install, initialize, or authorize a
plugin, connector, or Atlas automatically.

## Report

Before deep retrieval, report one compact line or small list:

- detected sources and callable capabilities;
- material missing sources;
- what will be used and what will be skipped.

## Ask

Ask only when a missing source or source choice can materially change the
implementation.

When `request_user_input` is available, use one native selector question by
default and at most three:

- `Usar fuentes detectadas`
- `Añadir enlaces`
- `Continuar solo con el repositorio`

The native free-form/Other answer can carry a URL or ID. If a required source
is missing, replace the last option with `Detener preparación` when continuing
would fabricate requirements.

When the selector is unavailable, ask one brief question in chat with the same
evidence and recommended default. Do not simulate buttons, build a form, or
block on optional sources.

## Retrieve

Use the provider that owns each source instead of reproducing it:

- Jira/Confluence through available Atlassian Rovo capabilities;
- Figma through available Figma capabilities;
- GitHub through the GitHub capability when remote evidence matters;
- Project Atlas through its MCP when its compact context adds value.

Follow only explicit relevant links between sources. Keep provenance, use
orient/search/expand, and retrieve detail only after a source or node is
confirmed.
