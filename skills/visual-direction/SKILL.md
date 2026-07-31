---
name: visual-direction
description: Resolve visual authority and explore a bounded design direction before frontend implementation. Invoke explicitly from frontend-task or by name when a visual page, section, or component has no exact Figma source or settled local pattern; when comparing two or three low-cost directions; when locking a compact DesignContract and state matrix; or when visually reviewing one implementation. Keep exploration inactive for non-visual work, exact established patterns, or an authoritative Figma node that only needs fidelity.
---

# Visual Direction

Prevent generic improvised UI by resolving authority before generating visual
options, then implement exactly one selected direction. Keep Project Atlas as
context and provenance support, never as a substitute design source.

## Resolve authority first

1. Read the parent task's confirmed source ledger and repository evidence.
2. Run `scripts/resolve-authority.mjs` with the smallest factual input that
   describes exact Figma identity, existing-system evidence, scope, and whether
   redesign was explicit. Do not raise the invention budget manually.
3. Read `references/authority-and-contracts.md` before creating direction cards
   or a DesignContract.
4. Apply authority by dimension:
   - visual: exact Figma node, then existing project system, then a selected
     task direction, then compatible reference facets, then defaults;
   - behavior: current user clarification, acceptance/API contract, Figma
     states/annotations, then repository behavior;
   - implementation: repository components/tokens/Code Connect, then Figma
     context, then framework defaults.
5. Preserve an exact Figma `fileKey`, `nodeId`, and URL. Never replace an
   explicit link or node with an Atlas candidate, a similar frame, or a
   generated alternative. If the exact node is inaccessible, report it as
   confirmed but unavailable/unsynchronized and request narrower or supplied
   evidence. Do not switch to exploration.
6. Treat a file/page reference without an exact target as target resolution,
   not permission to invent a competing aesthetic.

Use the resolver result:

- `fidelity`: exact Figma is authoritative; invention budget `0`; create no
  alternatives. Interpret, implement, and verify the exact target only.
- `inherit`: extend an existing project; invention budget `1`; inherit its
  components, tokens, density, navigation, tone, motion, and constraints.
  Create two small directions only when a material visual choice remains.
- `explore`: no exact design and no incumbent system exists; invention budget
  `2`; create three bounded directions.
- `redesign`: enter only when the user explicitly asks to redesign; invention
  budget `3`; create three bounded directions. Exact Figma still wins when it
  is declared authoritative.

Reject external reference facets that conflict with the incumbent project.
References may explain a composition, hierarchy, interaction, density, or
motion property; never import another product's complete style, assets, copy,
or distinctive trade dress.

## Decide whether exploration is active

Keep option generation inactive when the task is non-visual, changes only
copy/data/types, has an exact Figma node, has an already selected direction, or
extends an unambiguous established pattern. Fidelity review can remain active
without visual exploration.

For an existing project, inspect the nearest implemented surface before
options. Record an incumbent fingerprint with relevant components, tokens,
spacing/density, typography, color roles, navigation, motion, responsive
behavior, and accessibility constraints. Missing evidence stays unknown.

## Explore cheaply

Read `references/preview-routing.md` before producing a visual artifact.

1. Write direction cards before rendering. Produce at most two for an existing
   section/component and exactly three for greenfield or explicit redesign.
2. Keep each option scoped to the requested page subset, section, component,
   and relevant states. Do not build complete applications or production
   variants.
3. Hold content, data, shell, and state fixtures constant so the comparison
   tests visual direction rather than unrelated behavior.
4. Prefer a single comparison board/contact sheet containing all options.
   Generate an isolated sandbox only when interaction or state transition
   cannot be judged statically.
5. Explain what each option inherits, what one or two properties it varies,
   its compatibility evidence, relevant states, and what it deliberately
   avoids.
6. Ask the user to select one option or one base plus at most two compatible
   traits from other options. Reject combinations that create conflicting
   hierarchy, token, density, navigation, or motion systems.
7. Consolidate the choice into one compact DesignContract and state matrix.
   A selected consolidation is not a fourth option.

Keep direction cards task-local. After selection, carry forward only the
selected contract and receipt/hash; do not persist or re-emit discarded cards
through Atlas, Project Memory, repository files, or closeout.

Do not create a branch or worktree per option. Create no production code until
one direction is locked. Use one implementation branch/worktree for the single
selected solution.

## Keep every exploration artifact temporary

Read `references/temporary-artifacts.md` before generating any image, mockup,
contact sheet, sandbox, or review capture. Use
`scripts/temporary-artifacts.mjs` to create a session under the operating
system temp directory, register artifacts, select a direction, close/cancel,
and sweep expired sessions.

- Never write exploration artifacts, sandbox source, or preview fixtures into
  the repository or production tree.
- On selection, purge every unselected artifact and the comparison sheet.
  Retain at most the chosen artifact plus a handle/hash receipt until task
  review closes.
- On close or cancellation, purge the entire session. Use TTL as crash
  recovery, not as the normal cleanup path.
- If cleanup fails, report `cleanup-pending`, preserve the retry receipt only
  in the owned temp root, retry safely, and do not claim the task is clean
  until cleanup succeeds.
- Preserve an artifact beyond close only when the user explicitly promotes it
  to a named destination. Promotion is a separate write decision.

Never write to Figma during this workflow unless the user explicitly chooses
Figma as the output destination and approves that write. Reading an exact
Figma source does not authorize modification.

## Implement one direction and review it

1. Hand the locked DesignContract to the parent `frontend-task` workflow.
2. Implement one cohesive solution using repository components and tokens.
3. Capture only the contract's relevant viewports and states after
   implementation. Keep the captures in the same temporary artifact session.
4. Compare hierarchy, density, typography, token use, responsive behavior,
   interaction states, accessibility, and exact Figma fidelity when applicable.
5. Fix the single implementation; do not revive discarded variants.
6. Register every review capture and carry its exact
   `artifact-<sha256-prefix>-<uuid>` handle, full SHA256, emitted capture
   receipt, viewport, and state.
   Attach a first immutable `visual-review:` receipt to the parent task while
   the artifacts still exist, using `selected-retained`; this is an auditable
   review boundary and deliberately blocks completion.
7. Close the artifact session. It returns a content-free, task-bound cleanup
   receipt after deletion. Attach a second/final review with the same capture
   identities plus cleanup `clean` and that receipt. Because passing captures
   are registered temporary artifacts, `not-applicable` cannot authorize a
   passing close. `cleanup-pending` or a retained selection blocks completion.
8. Expand the final `visual-review:` handle once and verify task, selected
   contract, complete state-matrix coverage, result, and cleanup binding.
9. Verify Git contains no preview, sandbox, generated image, or temporary
   direction residue before the parent validates and closes the task.

## Return a core-compatible handoff

Read `references/atlas-handoff.md` before returning visual-direction state.
Use `scripts/build-atlas-handoff.mjs` to create one bounded core projection.

- Reuse the native Codex task and stable Atlas task ID. Atlas never launches,
  resumes, or changes permissions for Codex.
- Initialize the artifact session with that exact Atlas task ID. A standalone
  invocation without parent `root_path` and `task_id` must not invent them or
  emit a core projection.
- Carry IDs and opaque handles, never preview payloads, temporary paths,
  expanded receipts, or the full DesignContract.
- Use `temporary-artifacts.mjs expand` for the full DesignContract while its
  session lives; `atlas_expand_context visual:` exposes only the compact
  durable authority/summary/hash projection.
- Attach the selected `visual:` contract through `atlas_task_state` action
  `attach-evidence` using the generated core projection. Locked and review
  states always require that contract, including fidelity work. Re-run
  `atlas_prepare_task` only when the objective or source ledger itself changed.
  Use a separate checkpoint only when no core operation already recorded that
  semantic boundary.
- Never technically complete the parent task or call `atlas_memory` from this
  child workflow.
- Treat `cleanup-pending` as blocking implementation/completion claims.
- A passing review is valid only when every declared viewport and required
  state is represented, viewport/state pairs are unique, and each capture
  handle prefix matches its full SHA256. Free-form capture strings are invalid.
- The GUI may review receipts and memory proposals; it cannot reclassify
  authority, replace exact Figma identity, or select a direction.

During selection, return the AuthorityDecision and bounded direction cards.
After selection, return only the selected DesignContract, state matrix,
receipt/hash, and VisualReview. A GUI may render these objects later but must
not reclassify them.
