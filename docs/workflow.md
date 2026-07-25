# Reuse-first workflow

Component Atlas sits between requirement discovery and implementation.

```mermaid
flowchart TD
  T[Jira, Confluence, Figma, screenshots, or pasted requirements]
  Q[Clarify behavior and missing states]
  I[State implementation intent]
  S[Refresh Component Atlas]
  C[Get compact reuse context]
  E[Inspect candidate source and impact]
  D{Decision gate}
  R[Reuse]
  P[Extend or compose]
  X[Extract and reuse]
  N[Create with rejected alternatives]
  B[Implement and validate]
  U[Refresh graph and record result]

  T --> Q --> I --> S --> C --> E --> D
  D --> R --> B
  D --> P --> B
  D --> X --> B
  D --> N --> B
  B --> U
```

## Agent gate

Use `skills/reuse-first` whenever frontend work may create or substantially
change a component:

1. Clarify only requirements that can change the component decision.
2. Refresh the repository index.
3. Call `get_reuse_context` with one precise implementation intent.
4. Inspect the strongest candidate's source when the compact bundle is not
   sufficient.
5. Run dedicated impact analysis before changing a shared API.
6. Record exactly one `reuse`, `extend`, `compose`, `extract-and-reuse`, or
   `create` decision.
7. Implement, validate in the target repository, and refresh the graph.

## Useful commands

```powershell
component-atlas scan "C:\path\to\repo"
component-atlas context "C:\path\to\repo" "empty state with retry"
component-atlas show "C:\path\to\repo" UiEmptyState
component-atlas similar "C:\path\to\repo" MonthlySalaryDialog
component-atlas impact "C:\path\to\repo" UiModal
component-atlas open "C:\path\to\repo"
```

These queries return compact agent context. Add `--raw` only when debugging an
incorrect index result, not while deciding whether to reuse a component.

Optional Figma context:

```powershell
component-atlas figma map "C:\path\to\repo" "<figma-url>" `
  --metadata ".\figma-metadata.xml" `
  --format figma-mcp-xml `
  --scope-node "12:34"
component-atlas figma find "C:\path\to\repo" "add coupon validation to checkout"
component-atlas figma inspect "C:\path\to\repo" "<figma-file>" "12:34"
```

Record a decision:

```powershell
component-atlas decision "C:\path\to\repo" `
  --intent "confirmation dialog for deleting an account" `
  --decision extend `
  --select "react:src/components/ui/ConfirmActionDialog.tsx#ConfirmActionDialog" `
  --rationale "Existing semantics and focus handling match; add a danger variant."
```

## Current boundary

Jira, Confluence, screenshots, and pasted text remain task context owned by the
calling agent or future `frontend-task` skill. Atlas indexes local source code
and can cache sparse Figma metadata supplied by that agent; it never assumes a
connector, credential, Code Connect mapping, or Variables permission exists.
