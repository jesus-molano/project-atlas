export type CoreReuseDecision =
  | "reuse"
  | "extend"
  | "compose"
  | "extract-and-reuse"
  | "create"
  | "not-applicable";

export interface ReuseDecisionInvariantInput {
  decision: CoreReuseDecision;
  existingComponentIds: Iterable<string>;
  primaryComponentId?: string;
  hasPrimarySurface: boolean;
  selectedComponentIds?: string[];
  rejectedComponentIds?: string[];
  rationale: string;
}

export interface CanonicalReuseDecision {
  selectedComponentIds: string[];
  rejectedComponentIds: string[];
}

function unique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

/**
 * Enforce the semantic contract that the MCP schema alone cannot express.
 * Component IDs are deliberately exact graph identities, not fuzzy selectors.
 */
export function assertReuseDecisionInvariants(
  input: ReuseDecisionInvariantInput,
): CanonicalReuseDecision {
  const existing = new Set(input.existingComponentIds);
  const selected = unique(
    input.selectedComponentIds ??
      (input.primaryComponentId ? [input.primaryComponentId] : []),
  );
  const rejected = unique(input.rejectedComponentIds);

  for (const id of [...selected, ...rejected]) {
    if (!existing.has(id)) {
      throw new Error(
        `Reuse decision component ID "${id}" does not exist in the current Atlas graph.`,
      );
    }
  }
  const overlap = selected.find((id) => rejected.includes(id));
  if (overlap) {
    throw new Error(
      `Component "${overlap}" cannot be both selected and rejected.`,
    );
  }

  const componentDecision = [
    "reuse",
    "extend",
    "compose",
    "extract-and-reuse",
  ].includes(input.decision);
  if (componentDecision) {
    if (!input.primaryComponentId || input.hasPrimarySurface) {
      throw new Error(
        `${input.decision} requires an existing primary_component, not primary_surface.`,
      );
    }
    if (!selected.includes(input.primaryComponentId)) {
      throw new Error(
        `The primary component must be selected for a ${input.decision} decision.`,
      );
    }
  }

  if (input.decision === "create") {
    if (!input.hasPrimarySurface || input.primaryComponentId) {
      throw new Error(
        "create requires primary_surface for the planned new UI surface.",
      );
    }
    if (selected.length > 0) {
      throw new Error(
        "create cannot select an existing component as the implementation target.",
      );
    }
    if (
      rejected.length === 0 &&
      !/\b(?:no (?:matching|viable|relevant) candidate|no hay (?:ning[uú]n )?candidato (?:viable|relevante|compatible)|ning[uú]n candidato (?:viable|relevante|compatible))\b/iu.test(
        input.rationale,
      )
    ) {
      throw new Error(
        "A create decision must name real rejected candidates or state that no matching candidate exists.",
      );
    }
  }

  if (input.decision === "not-applicable") {
    if (!input.hasPrimarySurface || input.primaryComponentId) {
      throw new Error(
        "not-applicable is valid only for an explicit non-component primary_surface.",
      );
    }
    if (selected.length > 0 || rejected.length > 0) {
      throw new Error(
        "not-applicable cannot select or reject component candidates.",
      );
    }
  }

  return {
    selectedComponentIds: selected,
    rejectedComponentIds: rejected,
  };
}
