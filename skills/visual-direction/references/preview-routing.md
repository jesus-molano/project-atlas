# Preview routing

Choose the least expensive artifact that can answer the visual question.

| Question | Artifact | Boundary |
| --- | --- | --- |
| Identity, atmosphere, material, or image treatment before layout is known | Small moodboard/reference board | Show transferable facets and provenance; never copy full source style or assets |
| Hierarchy, composition, density, type scale, or color roles | Static mockup | Render only the requested surface and relevant viewport/state |
| Compare all bounded options | One contact sheet/comparison board | Two cells for incumbent component/section; three for greenfield/redesign |
| Interaction, transition, focus order, overflow, or state change cannot be judged statically | One isolated sandbox with shared fixtures | Temporary directory outside the repository; no production API, routing, analytics, or branches |
| Exact Figma node exists | Figma screenshot/context | No generated alternatives; preserve exact file/node identity |
| Team explicitly needs an editable collaborative design source | Figma write after explicit approval | Separate write decision; never implied by reading or selecting a direction |

## Cost rules

1. Write direction cards before rendering.
2. Render one contact sheet when possible, not one full artifact pipeline per
   option.
3. Reuse the same content, data, state, dimensions, and surrounding shell.
4. Show only the target section/component and states that can change the
   decision.
5. Do not connect sandboxes to production services.
6. Do not add dependencies, routes, stories, feature flags, or preview files to
   the product repository.
7. After selection, delete the contact sheet and every unselected artifact.
   Optionally create one consolidated selected preview when needed to verify a
   combination; it replaces, rather than adds to, the retained selection.
8. Keep all artifact paths inside the session returned by
   `scripts/temporary-artifacts.mjs init`.

## Review routing

After implementation, capture:

- the smallest desktop and narrow viewport needed by the contract;
- only states named in the state matrix;
- the exact Figma target screenshot when in `fidelity`;
- focus, reduced motion, or overflow evidence when they are material.

Review captures are temporary task evidence. Register them in the same
artifact session and purge them when the task closes.
