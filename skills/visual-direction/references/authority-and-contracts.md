# Authority and contract reference

## Contents

1. Authority resolver input
2. Authority decision
3. Direction cards
4. Selection and combination
5. DesignContract
6. State matrix
7. Visual review

## Authority resolver input

Pass factual, task-scoped evidence to `scripts/resolve-authority.mjs`:

```json
{
  "scope": "component | section | page | flow | greenfield",
  "hasExistingProject": true,
  "visualDecision": "open | established-pattern | selected-direction",
  "materialVisualChoice": true,
  "hasExactFigma": false,
  "exactFigma": {
    "fileKey": "required only when hasExactFigma is true",
    "nodeId": "required only when hasExactFigma is true",
    "url": "required only when hasExactFigma is true"
  },
  "explicitRedesign": false,
  "explicitFigmaWrite": false,
  "references": [
    {
      "id": "task-local handle",
      "compatibleWithProject": true,
      "facets": ["hierarchy", "density"]
    }
  ]
}
```

`materialVisualChoice` defaults to true only for an open component or section
inside an existing project. Set it from evidence; do not use it to force
options for trivial work.

## Authority decision

The resolver returns:

```yaml
mode: fidelity | inherit | explore | redesign
inventionBudget: 0 | 1 | 2 | 3
explorationRequired: true | false
previewCount: 0 | 2 | 3
authority:
  visual: exact-figma | existing-system | selected-direction | direction-selection-required
  behavior: [current-user-clarification, acceptance-or-api, figma-states, repository]
  implementation: [repository-components-and-tokens, figma-context, framework-defaults]
exactFigmaIdentity:
  fileKey: exact file key
  nodeId: exact node ID
  url: original URL
referencePolicy:
  accepted: [task-local handles]
  rejected: [task-local handles]
  use: facet-only
productionImplementationCount: 1
previewWorktrees: 0
implementationWorktrees: 1
figmaWrite: explicit-only | approved
artifacts: ephemeral-only
```

Interpret `inventionBudget` as a ceiling:

- `0`: reproduce and verify; no stylistic invention.
- `1`: vary one or two compositional properties inside the incumbent system.
- `2`: establish a new direction from compatible reference facets.
- `3`: explore a user-authorized redesign while preserving product and
  accessibility constraints.

Atlas supplies context, matches, and provenance. It never outranks an exact
Figma identity or the incumbent system, and an Atlas candidate never silently
becomes the selected visual source.

## Direction cards

Use the same stable content and states for all cards:

```yaml
id: direction-a
name: Short neutral label
premise: One sentence describing the visual hypothesis
inherits:
  - Existing component/token/navigation/density evidence
varies:
  - At most two properties worth comparing
reference_facets:
  - handle: task-local reference handle
    facet: hierarchy | composition | density | typography | color-role | motion
    rationale: Why this facet transfers without copying the source style
compatibility:
  evidence:
    - Existing token/component/constraint supporting the option
  conflicts: []
states_shown:
  - Relevant state and viewport only
avoids:
  - Generic defaults or incompatible external aesthetics
preview:
  kind: moodboard | static-mockup | contact-sheet | isolated-sandbox
  artifact_handle: temporary handle or none
```

Direction cards are proposals, not implementations. For `inherit`, the
`inherits` and `compatibility.evidence` fields are mandatory.

## Selection and combination

Prefer one option unchanged. A combination must name:

```yaml
base: direction-a
borrow:
  - from: direction-b
    trait: One bounded compatible trait
  - from: direction-c
    trait: Optional second compatible trait
compatibility_check:
  hierarchy: pass | conflict
  tokens: pass | conflict
  density: pass | conflict
  navigation: pass | conflict
  motion: pass | conflict
result: accepted | revise-selection
```

Accept only when every check passes. Do not average incompatible systems or
create a collage. Hash the accepted selection/contract and purge all discarded
artifacts before production work.

## DesignContract

Keep this contract compact enough to carry in task context:

```yaml
version: 1
mode: fidelity | inherit | explore | redesign
scope: component | section | page | flow | greenfield
authority:
  visual: Exact Figma identity, incumbent system handle, or selected direction ID
  implementation: Repository system handle or defaults
locked_direction:
  base: direction ID or exact Figma node
  borrowed_traits:
    - At most two compatible traits
composition:
  hierarchy: Short rule
  density: Short rule
  responsive: Short rule
tokens:
  required:
    - Existing token/component names or bounded new roles
  forbidden:
    - Conflicting or unauthorized tokens/styles
components:
  reuse:
    - Existing components
  create:
    - Only missing responsibilities
states:
  matrix_handle: Compact matrix below
content:
  stable_fixture: What remains constant
accessibility:
  - Required semantics, focus, contrast, motion, and input behavior
artifact_receipt:
  contract_handle: Opaque temporary visual handle
  contract_hash: Direction hash
  selection_receipt: Receipt emitted from the live selected session
  selected_artifact_handle: Temporary chosen-preview handle or none
  selected_artifact_hash: Content hash or none
  expires_at: ISO timestamp
  lifecycle: selected-until-review-close | receipt-only
```

In `inherit`, new visual tokens require explicit evidence that no compatible
existing role exists. In `fidelity`, every deviation must be called out rather
than silently normalized.

## State matrix

List only relevant states, but explicitly decide common omissions:

```yaml
surface: Target component/section
viewports:
  - desktop
  - narrow
states:
  default: required | not-applicable
  hover: required | not-applicable
  focus-visible: required | not-applicable
  active: required | not-applicable
  disabled: required | not-applicable
  loading: required | not-applicable
  empty: required | not-applicable
  error: required | not-applicable
  success: required | not-applicable
  overflow: required | not-applicable
  reduced-motion: required | not-applicable
evidence:
  - Figma node/state, repository pattern, acceptance criterion, or explicit assumption
```

Do not invent product states merely to fill the matrix. Mark unknown material
states as blocking or warnings in the parent brief.

## Visual review

After the single implementation, produce:

```yaml
contract_hash: Hash of the locked DesignContract
captures:
  - viewport: desktop | narrow | other
    state: Relevant state
    artifact_handle: artifact-<sha256-prefix>-<uuid>
    artifact_hash: Full SHA256 returned when the capture was registered
    receipt: capture-receipt:v1 emitted for these exact live bytes
checks:
  hierarchy: pass | deviation | blocked
  density: pass | deviation | blocked
  typography: pass | deviation | blocked
  tokens: pass | deviation | blocked
  responsive: pass | deviation | blocked
  states: pass | deviation | blocked
  accessibility: pass | deviation | blocked
  figma_fidelity: pass | deviation | not-applicable | blocked
deviations:
  - Evidence, impact, and disposition
result: pass | fix-and-recapture | blocked
cleanup:
  state: clean | cleanup-pending
  receipt: Content-free task-bound cleanup receipt
preliminary_review_handle: Required only by the final clean review
```

First attach an immutable preliminary review with cleanup
`selected-retained`, while Atlas can verify each capture receipt and its bytes.
Then clean the session and attach a final review with identical captures,
matrix, checks, result and deviations, the cleanup receipt, and the preliminary
handle. Do not close with `pass` unless that chain is valid and Git contains no
exploration residue. A visual task closed as `partial` or `failure` also needs a
clean final chain; cancellation cleanup is allowed for those non-passing exits.
