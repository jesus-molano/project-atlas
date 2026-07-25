# Frontend task brief contract

Create this brief before implementation. Omit empty source sections, but keep
material unknowns visible.

```yaml
objective: One-sentence user or product outcome
repository:
  root: Absolute path
  target: Package, route, feature, or component area
  framework: Detected framework and version when relevant
project_context:
  budget_chars: Shared Project Atlas hard cap
  memory:
    - Relevant decision, convention, failed attempt, or none
  findings:
    - decision-required, warning, or resolved with evidence
sources:
  conversation: Present or absent
  jira: Issue key/link or absent/unavailable
  confluence: Page/link or absent/unavailable
  figma: Confirmed node, indexed file/page, screenshot, or absent/unavailable
acceptance:
  - Observable behavior
states:
  - Loading, empty, error, success, disabled, pending, destructive, or none
constraints:
  - Responsive, accessibility, API, ownership, design-system, or delivery rules
reuse:
  intent: Precise component responsibility
  decision: reuse | extend | compose | extract-and-reuse | create | pending
  evidence:
    - Atlas or repository evidence
design:
  target: Confirmed node or pending
  candidates:
    - Node, confidence, and reason when discovery was needed
risk: low | medium | high
unknowns:
  blocking:
    - Only decisions that change the implementation materially
  warnings:
    - Non-blocking inconsistencies with recommendation
  resolved:
    - Low-impact assumptions and repository convention used
validation:
  - Commands and manual checks required
memory_delta:
  outcome: Observed or verified task result
  durable_proposal: Decision, convention, constraint, or none
```

## Compact preparation response

Before code, report no more than:

1. objective and acceptance summary;
2. sources used and unavailable optional sources;
3. design target or up to three candidates;
4. reuse decision or strongest candidates;
5. one evidence-backed blocking question, if one truly exists;
6. warnings, risk, and intended validation.

Do not paste full Jira pages, Confluence documents, Figma trees, or Atlas raw
nodes into the response. Link or cite the exact evidence and retain only the
fields that affect implementation.

## Gate examples

Decision required:

> The ticket says the modal can be dismissed, while the confirmed Figma frame
> omits every dismiss action. I recommend allowing Escape and a close button to
> preserve the repository's dialog accessibility contract. Should this flow be
> intentionally non-dismissible?

Warning:

> `ConfirmDialog` and `DeleteDialog` have the same composition and consumers in
> Atlas. Extend or compose the shared dialog before creating another component;
> verify whether their destructive copy is the only difference.

Resolved:

> No global Figma Variables permission is available. Use the confirmed node's
> selection variables and the repository token names; this does not block the
> task.
