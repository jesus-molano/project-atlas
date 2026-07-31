export const ACTION_CENTER_SCHEMA_VERSION = 1 as const;

export type ActionItemType =
  | "warning"
  | "risk"
  | "decision-required"
  | "contradiction"
  | "missing-evidence";

export type ActionItemState =
  | "new"
  | "in-review"
  | "awaiting-decision"
  | "mitigated"
  | "resolved"
  | "accepted"
  | "deferred"
  | "dismissed"
  | "reviewed"
  | "superseded"
  | "stale";

export type ActionSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ActionResolutionScope = "evidence" | "until-date" | "project";

export type ActionCenterCommand =
  | "resolve-decision"
  | "resolve-contradiction"
  | "request-clarification"
  | "accept-risk"
  | "mark-reviewed"
  | "defer"
  | "connect-source"
  | "use-alternative"
  | "continue-without-evidence"
  | "dismiss";

export interface ActionEvidenceHandle {
  id: string;
  source:
    | "repository"
    | "design"
    | "memory"
    | "task"
    | "integration";
  label: string;
  handle: string;
  summary: string;
  uri?: string;
  observedAt?: string;
}

export interface ActionItemProvenance {
  source: ActionEvidenceHandle["source"];
  canonicalId: string;
  rule: string;
  observedAt: string;
}

export interface ActionResolution {
  schemaVersion: typeof ACTION_CENTER_SCHEMA_VERSION;
  id: string;
  itemId: string;
  projectId: string;
  checkoutId: string;
  taskId?: string;
  command: ActionCenterCommand;
  state: ActionItemState;
  scope: ActionResolutionScope;
  reason: string;
  selectedOption?: string;
  authorityHandle?: string;
  alternativeHandle?: string;
  deferUntil?: string;
  evidenceFingerprint: string;
  idempotencyKey: string;
  resolvedAt: string;
}

export interface ActionCenterItem {
  schemaVersion: typeof ACTION_CENTER_SCHEMA_VERSION;
  id: string;
  projectId: string;
  checkoutId: string;
  type: ActionItemType;
  state: ActionItemState;
  severity: ActionSeverity;
  blocking: boolean;
  title: string;
  detected: string;
  whyItMatters: string;
  affectedTask: string;
  consequence: string;
  recommendation: string;
  provenance: ActionItemProvenance[];
  evidence: ActionEvidenceHandle[];
  evidenceFingerprint: string;
  source: ActionEvidenceHandle["source"];
  taskId?: string;
  componentIds?: string[];
  options?: Array<{ id: string; label: string; detail?: string }>;
  connector?: "figma" | "atlassian-rovo" | "github" | "codex";
  detectedAt: string;
  updatedAt: string;
  resolution?: ActionResolution;
  resolutionInvalidated?: boolean;
}

export interface ActionCenterSnapshot {
  schemaVersion: typeof ACTION_CENTER_SCHEMA_VERSION;
  projectId: string;
  checkoutId: string;
  workspaceFingerprint: string;
  generatedAt: string;
  items: ActionCenterItem[];
  counts: {
    materialBlockers: number;
    open: number;
    stale: number;
  };
}

export interface ActionCenterMutation {
  schemaVersion: typeof ACTION_CENTER_SCHEMA_VERSION;
  itemId: string;
  projectId: string;
  checkoutId: string;
  taskId?: string;
  command: ActionCenterCommand;
  scope: ActionResolutionScope;
  reason: string;
  selectedOption?: string;
  authorityHandle?: string;
  alternativeHandle?: string;
  deferUntil?: string;
  expectedWorkspaceFingerprint: string;
  expectedEvidenceFingerprint: string;
  idempotencyKey: string;
}

export interface ActionContextDelta {
  schemaVersion: typeof ACTION_CENTER_SCHEMA_VERSION;
  actionItemId: string;
  command: ActionCenterCommand;
  reason: string;
  selectedOption?: string;
  authorityHandle?: string;
  alternativeHandle?: string;
  evidenceHandles: string[];
}

const allowedCommands: Record<ActionItemType, readonly ActionCenterCommand[]> = {
  "decision-required": [
    "resolve-decision",
    "request-clarification",
    "defer",
  ],
  contradiction: ["resolve-contradiction", "request-clarification", "defer"],
  risk: ["accept-risk", "defer"],
  warning: ["mark-reviewed", "defer", "dismiss"],
  "missing-evidence": [
    "connect-source",
    "use-alternative",
    "continue-without-evidence",
    "defer",
  ],
};

const bulkSafe = new Set<ActionCenterCommand>([
  "mark-reviewed",
  "defer",
  "dismiss",
]);

export function commandsForActionItem(type: ActionItemType): readonly ActionCenterCommand[] {
  return allowedCommands[type];
}

export function isBulkSafeAction(command: ActionCenterCommand): boolean {
  return bulkSafe.has(command);
}

export function isOpenActionState(state: ActionItemState): boolean {
  return ![
    "mitigated",
    "resolved",
    "accepted",
    "dismissed",
    "reviewed",
    "superseded",
  ].includes(state);
}

export function actionStateForCommand(command: ActionCenterCommand): ActionItemState {
  switch (command) {
    case "accept-risk":
    case "continue-without-evidence":
      return "accepted";
    case "defer":
      return "deferred";
    case "mark-reviewed":
      return "reviewed";
    case "dismiss":
      return "dismissed";
    case "request-clarification":
      return "awaiting-decision";
    case "connect-source":
      return "in-review";
    default:
      return "resolved";
  }
}

export function resolutionApplies(
  resolution: ActionResolution,
  item: ActionCenterItem,
  now = new Date().toISOString(),
): boolean {
  if (resolution.evidenceFingerprint !== item.evidenceFingerprint) return false;
  if (resolution.scope === "until-date") {
    return Boolean(resolution.deferUntil && resolution.deferUntil > now);
  }
  return true;
}

export function applyActionResolutions(
  items: ActionCenterItem[],
  resolutions: ActionResolution[],
  now = new Date().toISOString(),
): ActionCenterItem[] {
  const latest = new Map<string, ActionResolution>();
  for (const resolution of resolutions) {
    const current = latest.get(resolution.itemId);
    if (!current || current.resolvedAt < resolution.resolvedAt) {
      latest.set(resolution.itemId, resolution);
    }
  }
  return items.map((item) => {
    const resolution = latest.get(item.id);
    if (!resolution) return item;
    if (!resolutionApplies(resolution, item, now)) {
      return {
        ...item,
        state: "stale",
        resolution,
        resolutionInvalidated: true,
      };
    }
    return { ...item, state: resolution.state, resolution };
  });
}

export function nextMaterialAction(items: ActionCenterItem[]): ActionCenterItem | undefined {
  const severityRank: Record<ActionSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return [...items]
    .filter((item) => isOpenActionState(item.state))
    .sort(
      (left, right) =>
        Number(right.blocking) - Number(left.blocking) ||
        severityRank[left.severity] - severityRank[right.severity] ||
        left.detectedAt.localeCompare(right.detectedAt) ||
        left.id.localeCompare(right.id),
    )[0];
}

export function validateActionMutation(
  item: ActionCenterItem,
  mutation: ActionCenterMutation,
  options: { bulk?: boolean; now?: string } = {},
): string[] {
  const errors: string[] = [];
  if (mutation.schemaVersion !== ACTION_CENTER_SCHEMA_VERSION) {
    errors.push("Unsupported Action Center schema version.");
  }
  if (mutation.itemId !== item.id) errors.push("Action item identity does not match.");
  if (mutation.projectId !== item.projectId) errors.push("Project identity does not match.");
  if (mutation.checkoutId !== item.checkoutId) errors.push("Checkout identity does not match.");
  if (mutation.expectedEvidenceFingerprint !== item.evidenceFingerprint) {
    errors.push("Evidence changed after review.");
  }
  if (!allowedCommands[item.type].includes(mutation.command)) {
    errors.push(`${mutation.command} is not allowed for ${item.type}.`);
  }
  if (options.bulk && !isBulkSafeAction(mutation.command)) {
    errors.push(`${mutation.command} cannot be applied in bulk.`);
  }
  if (!mutation.idempotencyKey || mutation.idempotencyKey.length > 120) {
    errors.push("A bounded idempotency key is required.");
  }
  if (!mutation.reason.trim() || mutation.reason.trim().length > 500) {
    errors.push("A reason between 1 and 500 characters is required.");
  }
  if (mutation.scope === "until-date") {
    const now = options.now ?? new Date().toISOString();
    if (!mutation.deferUntil || mutation.deferUntil <= now) {
      errors.push("A future defer date is required.");
    }
  }
  if (mutation.command === "resolve-contradiction") {
    const optionIds = new Set(item.options?.map((option) => option.id) ?? []);
    if (
      !mutation.authorityHandle ||
      !mutation.selectedOption ||
      mutation.authorityHandle !== mutation.selectedOption ||
      !optionIds.has(mutation.authorityHandle)
    ) {
      errors.push("Choose one of the compared evidence sources as authority.");
    }
  }
  if (
    mutation.command === "use-alternative" &&
    !/^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/.test(
      mutation.alternativeHandle ?? "",
    )
  ) {
    errors.push("A bounded Atlas evidence handle is required.");
  }
  return errors;
}

export function compactActionDelta(
  item: ActionCenterItem,
  mutation: ActionCenterMutation,
  maxChars = 1_600,
): ActionContextDelta {
  const delta: ActionContextDelta = {
    schemaVersion: ACTION_CENTER_SCHEMA_VERSION,
    actionItemId: item.id.slice(0, 240),
    command: mutation.command,
    reason: mutation.reason.trim().slice(0, 500),
    ...(mutation.selectedOption
      ? { selectedOption: mutation.selectedOption.slice(0, 160) }
      : {}),
    ...(mutation.authorityHandle
      ? { authorityHandle: mutation.authorityHandle.slice(0, 240) }
      : {}),
    ...(mutation.alternativeHandle
      ? { alternativeHandle: mutation.alternativeHandle.slice(0, 240) }
      : {}),
    evidenceHandles: item.evidence.map((entry) => entry.handle).slice(0, 8),
  };
  while (JSON.stringify(delta).length > maxChars && delta.evidenceHandles.length) {
    delta.evidenceHandles.pop();
  }
  if (JSON.stringify(delta).length > maxChars) {
    delta.reason = delta.reason.slice(0, Math.max(1, maxChars - 500));
  }
  return delta;
}
