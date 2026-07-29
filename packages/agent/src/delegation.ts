export type AgentDelegationDomain =
  | "figma"
  | "atlassian"
  | "openapi"
  | "code";

export interface AgentDelegationWorkItem {
  domain: AgentDelegationDomain;
  sourceDecisionIds: string[];
  confirmed: boolean;
  authorityConfirmed: boolean;
  primaryAdapter: string;
  fallbackPolicy: "deny" | "ask" | "allow-list";
  estimatedRawChars: number;
  compactBudgetChars: number;
}

export interface AgentDelegationJob {
  id: string;
  domain: AgentDelegationDomain;
  sourceDecisionIds: string[];
  primaryAdapter: string;
  outputBudgetChars: number;
  permissions: {
    confirmSources: false;
    changeAuthority: false;
    changeScope: false;
    useProviderFallback: false;
    implement: false;
  };
  onBlocked: "return-compact-blocker";
}

export interface AgentDelegationPlan {
  schemaVersion: 1;
  taskId: string;
  enabled: boolean;
  reason: string;
  maxConcurrent: 0 | 1 | 2;
  jobs: AgentDelegationJob[];
  cost: {
    coordinatorWithoutDelegationChars: number;
    coordinatorWithDelegationChars: number;
    delegateOverheadChars: number;
    totalWorkChars: number;
    netCoordinatorSavingsChars: number;
  };
  coordinatorRetains: [
    "source-confirmation",
    "authority-resolution",
    "scope-decision",
    "single-implementation",
  ];
  fallback:
    "coordinator-runs-same-confirmed-route-within-budget";
}

export type AgentDelegationPayload =
  | {
      kind: "figma";
      map: {
        fileKey: string;
        confirmedScopeId: string;
        selectedScopeIds: string[];
      };
      states: Array<{ id: string; name: string; category: string }>;
      overlays: Array<{ id: string; name: string }>;
      responsive: Array<{ id: string; viewport: string }>;
      assets: Array<{
        handle: string;
        contentHash: string;
        format: string;
        bytes: number;
      }>;
      codeConnect: "available" | "missing-advisory" | "not-checked";
    }
  | {
      kind: "atlassian";
      requirements: Array<{
        id: string;
        statement: string;
        sourceDecisionId: string;
      }>;
      contradictions: Array<{
        ids: string[];
        summary: string;
      }>;
      versions: Array<{
        sourceDecisionId: string;
        version: string;
      }>;
    }
  | {
      kind: "openapi";
      contractIdentity: string;
      operations: Array<{
        operationId: string;
        method: string;
        path: string;
        typeNames: string[];
        errorStatuses: string[];
      }>;
      authentication: string[];
      derivationReceiptId?: string;
    }
  | {
      kind: "code";
      changeSurface: {
        primaryId?: string;
        files: Array<{ path: string; role: string }>;
        referenceIds: string[];
        outOfScope: string[];
      };
      reuseDecision?: {
        kind: "reuse" | "extend" | "compose" | "extract-and-reuse" | "create";
        componentId?: string;
        reason: string;
      };
    };

export interface AgentDelegationResult {
  schemaVersion: 1;
  jobId: string;
  taskId: string;
  domain: AgentDelegationDomain;
  status: "completed" | "blocked";
  sourceDecisionIds: string[];
  receiptIds: string[];
  payload?: AgentDelegationPayload;
  warnings: string[];
  blocker?: string;
  metrics: {
    outputChars: number;
    rawBodiesIncluded: false;
  };
}

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const SOURCE_ID = /^source-[a-z]+-[a-f0-9]{8}$/u;
const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const FORBIDDEN_KEYS = new Set([
  "raw",
  "body",
  "content",
  "document",
  "sourcedocument",
  "responsetext",
  "responsebody",
  "html",
  "xml",
  "svg",
  "blob",
  "base64",
  "codedump",
  "metadataxml",
  "openapidocument",
]);

function boundedInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function planAgentDelegation(input: {
  taskId: string;
  explicitlyAllowed: boolean;
  coordinatorContextRemainingChars: number;
  workItems: AgentDelegationWorkItem[];
}): AgentDelegationPlan {
  if (!TASK_ID.test(input.taskId)) throw new Error("Delegation task ID is invalid.");
  const eligible = input.workItems
    .filter(
      (item) =>
        item.confirmed &&
        item.authorityConfirmed &&
        (item.domain === "code" || item.sourceDecisionIds.length > 0) &&
        item.estimatedRawChars >= 6_000 &&
        item.compactBudgetChars >= 800 &&
        item.compactBudgetChars <= 4_000,
    )
    .sort(
      (left, right) =>
        right.estimatedRawChars -
        right.compactBudgetChars -
        (left.estimatedRawChars - left.compactBudgetChars),
    )
    .slice(0, 2);
  const rawChars = eligible.reduce(
    (total, item) => total + boundedInteger(item.estimatedRawChars, 0, 100_000),
    0,
  );
  const compactChars = eligible.reduce(
    (total, item) => total + item.compactBudgetChars,
    0,
  );
  const overhead = eligible.length * 900;
  const savings = Math.max(0, rawChars - compactChars);
  const pressure =
    (eligible.length >= 2 &&
      input.coordinatorContextRemainingChars < 20_000 &&
      savings >= 8_000) ||
    (eligible.length === 1 &&
      eligible[0]!.estimatedRawChars >= 24_000 &&
      input.coordinatorContextRemainingChars < 12_000);
  const enabled = input.explicitlyAllowed && pressure;
  const jobs: AgentDelegationJob[] = enabled
    ? eligible.map((item, index) => ({
        id: `delegate-${item.domain}-${index + 1}`,
        domain: item.domain,
        sourceDecisionIds: [...new Set(item.sourceDecisionIds)].slice(0, 8),
        primaryAdapter: item.primaryAdapter.slice(0, 120),
        outputBudgetChars: item.compactBudgetChars,
        permissions: {
          confirmSources: false,
          changeAuthority: false,
          changeScope: false,
          useProviderFallback: false,
          implement: false,
        },
        onBlocked: "return-compact-blocker",
      }))
    : [];
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    enabled,
    reason: !input.explicitlyAllowed
      ? "Delegation was not explicitly allowed."
      : !pressure
        ? "Delegation would add total work without enough coordinator-context savings."
        : "Independent confirmed retrievals exceed the coordinator-context threshold.",
    maxConcurrent: enabled ? (jobs.length === 1 ? 1 : 2) : 0,
    jobs,
    cost: {
      coordinatorWithoutDelegationChars: rawChars,
      coordinatorWithDelegationChars: enabled ? compactChars : rawChars,
      delegateOverheadChars: enabled ? overhead : 0,
      totalWorkChars: enabled ? rawChars + compactChars + overhead : rawChars,
      netCoordinatorSavingsChars: enabled ? savings : 0,
    },
    coordinatorRetains: [
      "source-confirmation",
      "authority-resolution",
      "scope-decision",
      "single-implementation",
    ],
    fallback: "coordinator-runs-same-confirmed-route-within-budget",
  };
}

function inspectCompactValue(
  value: unknown,
  depth = 0,
): void {
  if (depth > 7) throw new Error("Delegation result is too deeply nested.");
  if (typeof value === "string") {
    if (value.length > 500) {
      throw new Error("Delegation result contains an oversized string.");
    }
    if (
      /<[A-Za-z/!?][^>]*>|data:|(?:localhost|127\.0\.0\.1|\[?::1\]?):3845/iu.test(
        value,
      ) ||
      /^[A-Za-z0-9+/]{256,}={0,2}$/u.test(value)
    ) {
      throw new Error("Delegation result contains a raw body or local endpoint.");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 20) {
      throw new Error("Delegation result contains an oversized collection.");
    }
    for (const item of value) inspectCompactValue(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value);
  if (entries.length > 30) {
    throw new Error("Delegation result contains an oversized object.");
  }
  for (const [key, item] of entries) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`Delegation result contains forbidden field "${key}".`);
    }
    inspectCompactValue(item, depth + 1);
  }
}

function validText(value: unknown, maximum = 500): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function validatePayload(payload: AgentDelegationPayload): void {
  if (payload.kind === "figma") {
    if (
      !validText(payload.map?.fileKey, 300) ||
      !validText(payload.map?.confirmedScopeId, 300) ||
      !Array.isArray(payload.map?.selectedScopeIds) ||
      payload.map.selectedScopeIds.length > 12 ||
      !Array.isArray(payload.states) ||
      payload.states.length > 12 ||
      !Array.isArray(payload.overlays) ||
      payload.overlays.length > 6 ||
      !Array.isArray(payload.responsive) ||
      payload.responsive.length > 6 ||
      !Array.isArray(payload.assets) ||
      payload.assets.length > 8 ||
      payload.assets.some(
        (asset) =>
          !/^figma-asset:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{24}$/u.test(
            asset.handle,
          ) ||
          !/^sha256:[a-f0-9]{64}$/u.test(asset.contentHash) ||
          !["svg", "png", "jpg", "webp"].includes(asset.format) ||
          !Number.isInteger(asset.bytes) ||
          asset.bytes < 1 ||
          asset.bytes > 5_000_000,
      ) ||
      !["available", "missing-advisory", "not-checked"].includes(
        payload.codeConnect,
      )
    ) {
      throw new Error("Figma delegation payload is invalid.");
    }
    return;
  }
  if (payload.kind === "atlassian") {
    if (
      !Array.isArray(payload.requirements) ||
      payload.requirements.length > 12 ||
      payload.requirements.some(
        (item) =>
          !validText(item.id, 160) ||
          !validText(item.statement) ||
          !SOURCE_ID.test(item.sourceDecisionId),
      ) ||
      !Array.isArray(payload.contradictions) ||
      payload.contradictions.length > 6 ||
      !Array.isArray(payload.versions) ||
      payload.versions.length > 8
    ) {
      throw new Error("Atlassian delegation payload is invalid.");
    }
    return;
  }
  if (payload.kind === "openapi") {
    if (
      !validText(payload.contractIdentity) ||
      !Array.isArray(payload.operations) ||
      payload.operations.length > 8 ||
      payload.operations.some(
        (operation) =>
          !validText(operation.operationId, 300) ||
          !/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u.test(
            operation.method,
          ) ||
          !validText(operation.path, 500) ||
          operation.typeNames.length > 12 ||
          operation.errorStatuses.length > 12,
      ) ||
      !Array.isArray(payload.authentication) ||
      payload.authentication.length > 8 ||
      (payload.derivationReceiptId !== undefined &&
        !RECEIPT_ID.test(payload.derivationReceiptId))
    ) {
      throw new Error("OpenAPI delegation payload is invalid.");
    }
    return;
  }
  if (
    !Array.isArray(payload.changeSurface?.files) ||
    payload.changeSurface.files.length > 12 ||
    !Array.isArray(payload.changeSurface.referenceIds) ||
    payload.changeSurface.referenceIds.length > 2 ||
    !Array.isArray(payload.changeSurface.outOfScope) ||
    payload.changeSurface.outOfScope.length > 8 ||
    (payload.reuseDecision &&
      ![
        "reuse",
        "extend",
        "compose",
        "extract-and-reuse",
        "create",
      ].includes(payload.reuseDecision.kind))
  ) {
    throw new Error("Code delegation payload is invalid.");
  }
}

export function assertCompactDelegationResult(
  result: AgentDelegationResult,
  job: AgentDelegationJob,
): AgentDelegationResult {
  if (
    result.schemaVersion !== 1 ||
    result.jobId !== job.id ||
    result.domain !== job.domain ||
    !TASK_ID.test(result.taskId) ||
    result.metrics?.rawBodiesIncluded !== false ||
    !["completed", "blocked"].includes(result.status) ||
    !Array.isArray(result.sourceDecisionIds) ||
    result.sourceDecisionIds.some(
      (id) => !SOURCE_ID.test(id) || !job.sourceDecisionIds.includes(id),
    ) ||
    !Array.isArray(result.receiptIds) ||
    result.receiptIds.some((id) => !RECEIPT_ID.test(id)) ||
    !Number.isInteger(result.metrics.outputChars)
  ) {
    throw new Error("Delegation result contract is invalid.");
  }
  if (result.payload && result.payload.kind !== result.domain) {
    throw new Error("Delegation payload domain does not match its job.");
  }
  if (result.payload) validatePayload(result.payload);
  if (result.status === "blocked" && !result.blocker) {
    throw new Error("Blocked delegation result requires a compact blocker.");
  }
  if (
    result.status === "completed" &&
    (job.sourceDecisionIds.some(
      (id) => !result.sourceDecisionIds.includes(id),
    ) ||
      (job.domain !== "code" && result.receiptIds.length === 0))
  ) {
    throw new Error(
      "Completed delegation result must cover its confirmed source decisions and receipts.",
    );
  }
  inspectCompactValue(result);
  const outputChars = JSON.stringify({
    ...result,
    metrics: { ...result.metrics, outputChars: 0 },
  }).length;
  if (
    outputChars > job.outputBudgetChars ||
    result.metrics.outputChars !== outputChars
  ) {
    throw new Error("Delegation result exceeds or misreports its output budget.");
  }
  return result;
}

export function assertAgentDelegationBundle(input: {
  plan: AgentDelegationPlan;
  results: AgentDelegationResult[];
}): void {
  if (
    input.plan.schemaVersion !== 1 ||
    !TASK_ID.test(input.plan.taskId) ||
    input.plan.jobs.length > 2 ||
    ![0, 1, 2].includes(input.plan.maxConcurrent) ||
    input.plan.enabled !== (input.plan.jobs.length > 0) ||
    input.plan.maxConcurrent !==
      (input.plan.enabled ? Math.min(2, input.plan.jobs.length) : 0) ||
    JSON.stringify(input.plan.coordinatorRetains) !==
      JSON.stringify([
        "source-confirmation",
        "authority-resolution",
        "scope-decision",
        "single-implementation",
      ]) ||
    input.plan.fallback !==
      "coordinator-runs-same-confirmed-route-within-budget" ||
    input.plan.jobs.some(
      (job) =>
        !/^delegate-(?:figma|atlassian|openapi|code)-[1-2]$/u.test(job.id) ||
        job.outputBudgetChars < 800 ||
        job.outputBudgetChars > 4_000 ||
        !validText(job.primaryAdapter, 120) ||
        job.sourceDecisionIds.some((id) => !SOURCE_ID.test(id)) ||
        job.onBlocked !== "return-compact-blocker" ||
        job.permissions.confirmSources !== false ||
        job.permissions.changeAuthority !== false ||
        job.permissions.changeScope !== false ||
        job.permissions.useProviderFallback !== false ||
        job.permissions.implement !== false,
    )
  ) {
    throw new Error("Delegation plan contract is invalid.");
  }
  if (!input.plan.enabled && input.results.length > 0) {
    throw new Error("Disabled delegation cannot inject delegated evidence.");
  }
  if (
    input.results.length > input.plan.jobs.length ||
    input.results.length > input.plan.maxConcurrent
  ) {
    throw new Error("Delegation result count exceeds the approved plan.");
  }
  const seen = new Set<string>();
  for (const result of input.results) {
    const job = input.plan.jobs.find((candidate) => candidate.id === result.jobId);
    if (!job || seen.has(result.jobId) || result.taskId !== input.plan.taskId) {
      throw new Error("Delegation result is not bound to one approved job.");
    }
    assertCompactDelegationResult(result, job);
    seen.add(result.jobId);
  }
  if (JSON.stringify(input.results).length > 8_000) {
    throw new Error("Delegated evidence exceeds the coordinator injection budget.");
  }
}

export function compactDelegatedEvidence(input: {
  plan: AgentDelegationPlan;
  results: AgentDelegationResult[];
}): string {
  assertAgentDelegationBundle(input);
  return JSON.stringify({
    schemaVersion: 1,
    taskId: input.plan.taskId,
    results: input.results,
  });
}
