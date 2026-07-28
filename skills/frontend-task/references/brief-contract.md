# Frontend task brief contract

Create this brief before implementation. Omit empty source sections, but keep
material unknowns visible.

```yaml
objective: One-sentence user or product outcome
intake:
  scope: task
  objective_confirmed: true | false
  readiness: ready | needs-confirmation | blocked
  source_ledger:
    - kind: jira | confluence | figma | github | openapi | other
      reference: Exact task-scoped URL or ID
      state: pending | confirmed | omitted | unavailable | replaced
      origin: explicit | inferred | manual
mode: new | continue | correct | finish
planning_checkpoint:
  phase: pre-investigation | post-evidence | not-required
  high_risk_source_intake: pending | confirmed | not-required
  grouped_sources: [jira, confluence, figma, openapi]
delta:
  preserved:
    - Existing user changes or completed behavior
  pending:
    - Only remaining or corrected behavior
  affected_evidence:
    - Files, decisions, outcomes, or source handles that changed
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
capabilities:
  repository: required | not-applicable
  atlas: recommended | optional | unavailable | not-applicable
  jira: required | recommended | optional | unavailable | not-applicable
  confluence: required | recommended | optional | unavailable | not-applicable
  figma: required | recommended | optional | unavailable | not-applicable
  openapi: required | recommended | optional | unavailable | not-applicable
  github: required | recommended | optional | unavailable | not-applicable
sources:
  conversation: Present or absent
  jira: Issue key/link or absent/unavailable
  confluence: Page/link or absent/unavailable
  figma: Confirmed node, indexed file/page, screenshot, or absent/unavailable
  openapi: Confirmed Swagger/OpenAPI URL, local path, pasted contract, or absent/unavailable
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
  closeout_status: none | canonical-candidate | canonical-stored | local-only | declined
  candidates:
    - type: decision | convention | constraint | integration | known-issue | lesson
      title: Compact candidate title
      summary: Reusable knowledge only
      evidence: [Exact evidence handles or validation facts]
      scope: canonical
      confidence: 0.0-1.0
  local_outcome: Episodic or checkout-only result, or none
  confirmation_required: true | false
  confirmation_prompt: Exact canonical-write confirmation question, or empty
scope_delta:
  project:
    - Explicitly promoted durable knowledge, or none
  checkout:
    - Derived graph, local changes, and episodic validation
  task:
    - Intake, source ledger, brief, risk, permissions, and run state
```

## Compact preparation response

Before code, report no more than:

1. objective and acceptance summary;
2. sources used and unavailable optional sources;
3. design target or up to three candidates;
4. reuse decision or strongest candidates;
5. one evidence-backed blocking question, if one truly exists;
6. warnings, risk, and intended validation;
7. the compact **Memory candidates** closeout from `memory-closeout.md`.

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
