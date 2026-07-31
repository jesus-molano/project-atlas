export type AtlasKnowledgeScope = "project" | "checkout" | "task";

export interface AtlasProvenance {
  scope: AtlasKnowledgeScope;
  origin:
    | "repository-scan"
    | "user-confirmation"
    | "connected-source"
    | "agent-observation"
    | "task-outcome";
  observedAt: string;
  projectId?: string;
  checkoutId?: string;
  taskId?: string;
  reference?: string;
  promotion?:
    | "not-eligible"
    | "requires-confirmation"
    | "confirmed"
    | "derived";
  invalidatesOn?: "rescan" | "checkout-change" | "task-end" | "explicit-replacement";
}

export type TaskRiskLevel = "low" | "medium" | "high";
export type TaskSourceKind =
  | "jira"
  | "confluence"
  | "figma"
  | "github"
  | "openapi"
  | "other";
export type TaskSourceOrigin = "explicit" | "inferred" | "manual";
export type TaskSourceState =
  | "pending"
  | "confirmed"
  | "omitted"
  | "unavailable"
  | "external"
  | "replaced";
export type TaskSourceAuthorityRole =
  | "requirement"
  | "visual"
  | "contract"
  | "implementation-reference";
export type TaskSourceFallbackPolicy = "deny" | "ask" | "allow-list";

export interface TaskSourceRoutePolicy {
  primaryAdapter: string;
  fallback: TaskSourceFallbackPolicy;
  allowedFallbackAdapters?: string[];
}

export interface TaskSourceDecision {
  id: string;
  kind: TaskSourceKind;
  reference: string;
  origin: TaskSourceOrigin;
  state: TaskSourceState;
  required: boolean;
  replacementFor?: string;
  parentSourceId?: string;
  relationship?: "primary" | "search-candidate" | "linked-secondary";
  authorityRole?: TaskSourceAuthorityRole;
  routePolicy?: TaskSourceRoutePolicy;
  decidedAt?: string;
}

export type TaskSourceRelationKind =
  | "references-design"
  | "constrains-contract"
  | "secondary-implementation-reference";

export interface TaskSourceRelation {
  id: string;
  fromSourceId: string;
  toSourceId: string;
  kind: TaskSourceRelationKind;
  targetScope?: {
    provider: TaskSourceKind;
    kind: "file" | "page" | "node" | "selection" | "operation" | "unknown";
    id: string;
  };
  confirmedAt?: string;
}

export interface TaskRiskAssessment {
  level: TaskRiskLevel;
  reasons: string[];
  requiresObjectiveConfirmation: boolean;
}

export interface TaskIntakeState {
  schemaVersion: 1;
  scope: "task";
  objective: string;
  objectiveConfirmed: boolean;
  risk: TaskRiskAssessment;
  sources: TaskSourceDecision[];
  relations?: TaskSourceRelation[];
}

export interface TaskIntakeAssessment {
  status: "ready" | "needs-confirmation" | "blocked";
  reasons: string[];
}

export interface TaskContextSourcePolicy {
  scope: "task";
  confirmedKinds: TaskSourceKind[];
  omittedKinds: TaskSourceKind[];
  unavailableKinds: TaskSourceKind[];
  externalKinds: TaskSourceKind[];
  routes?: Array<{
    sourceDecisionId: string;
    authorityRole: TaskSourceAuthorityRole;
    primaryAdapter: string;
    fallback: TaskSourceFallbackPolicy;
    allowedFallbackAdapters: string[];
  }>;
  relations?: TaskSourceRelation[];
}

const TASK_SOURCE_KINDS: TaskSourceKind[] = [
  "jira",
  "confluence",
  "figma",
  "github",
  "openapi",
  "other",
];
const TASK_SOURCE_ORIGINS: TaskSourceOrigin[] = [
  "explicit",
  "inferred",
  "manual",
];
const TASK_SOURCE_STATES: TaskSourceState[] = [
  "pending",
  "confirmed",
  "omitted",
  "unavailable",
  "external",
  "replaced",
];
const MAX_TASK_SOURCES = 12;
const MAX_TASK_SOURCE_RELATIONS = 12;
const MAX_SOURCE_REFERENCE_CHARS = 1_000;
const ADAPTER_ID = /^[a-z0-9][a-z0-9-]{1,79}$/u;
export const HIGH_RISK_INTAKE_SOURCE_KINDS = [
  "jira",
  "confluence",
  "figma",
  "openapi",
] as const satisfies readonly TaskSourceKind[];

export function missingTaskSourceReference(kind: TaskSourceKind): string {
  return `atlas:none:${kind}`;
}

export function isMissingTaskSourceReference(reference: string): boolean {
  return /^atlas:none:(?:jira|confluence|figma|github|openapi|other)$/u.test(
    reference,
  );
}

const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:auth|authentication|authorization|permission|role|access control|autenticaci[oó]n|autorizaci[oó]n|permiso|rol)\b/i, "Identity or access control"],
  [/\b(?:biometric(?:s)?|biom[eé]tric[oa]s?|biometr[ií]a|2fa|mfa|multi-?factor|two-?factor|doble factor|segundo factor)\b/i, "Biometric or multi-factor authentication"],
  [/\b(?:security|secret|credential|token|privacy|personal data|pii|seguridad|secreto|credencial|privacidad|datos personales)\b/i, "Security or sensitive data"],
  [/\b(?:payment|billing|checkout|invoice|money|pago|facturaci[oó]n|dinero)\b/i, "Financial workflow"],
  [/\b(?:delete|drop|erase|destructive|migration|schema|eliminar|borrar|destructivo|migraci[oó]n|esquema)\b/i, "Destructive or data-model change"],
  [/\b(?:production|deploy|release|external write|producci[oó]n|despliegue|publicaci[oó]n|escritura externa)\b/i, "Production or external side effect"],
];

const MEDIUM_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:api|openapi|swagger|endpoint|server|runtime|database|state|workflow|contrato de api|servidor|base de datos|estado|flujo)\b/i, "Runtime or stateful behavior"],
  [/\b(?:responsive|responsivo|accessibility|accesibilidad|a11y|keyboard|teclado|screen reader|lector de pantalla)\b/i, "Cross-mode user experience"],
  [/\b(?:integration|integraci[oó]n|connector|conector|jira|confluence|figma|github|openapi|swagger|mcp)\b/i, "Connected-source integration"],
  [/\b(?:refactor|refactorizaci[oó]n|shared component|componente compartido|design system|sistema de dise[nñ]o|navigation|navegaci[oó]n|routing|rutas)\b/i, "Shared or cross-cutting surface"],
];

const LOW_RISK_PATTERNS = [
  /\b(?:copy|label|typo|spelling|icon|spacing|color|colour|tooltip|texto|etiqueta|errata|ortograf[ií]a|icono|espaciado)\b/i,
];

function normalizedReference(value: string): string {
  return value.trim().replace(/[\]),.;!?}]+$/u, "");
}

function canonicalTaskSourceReference(
  kind: TaskSourceKind,
  reference: string,
): string {
  const normalized = normalizedReference(reference);
  if (kind === "figma") {
    try {
      const url = new URL(normalized.replace(/^figma:/u, ""));
      const match = url.pathname.match(
        /^\/(?:design|file|proto|board)\/([^/?#]+)/iu,
      );
      const fileKey = match?.[1];
      const nodeId = url.searchParams
        .get("node-id")
        ?.trim()
        .replace(/-/gu, ":");
      if (fileKey) {
        return `figma:${decodeURIComponent(fileKey)}${nodeId ? `::${nodeId}` : ""}`;
      }
    } catch {
      // Non-URL Figma references retain the normalized legacy identity.
    }
  }
  if (kind === "openapi" && /^https?:\/\//iu.test(normalized)) {
    try {
      const url = new URL(normalized);
      url.hash = "";
      url.searchParams.sort();
      if (url.pathname.length > 1) {
        url.pathname = url.pathname.replace(/\/+$/u, "");
      }
      return url.toString();
    } catch {
      // Invalid URLs are rejected by source normalization later.
    }
  }
  return normalized;
}

export function taskSourceId(kind: TaskSourceKind, reference: string): string {
  const normalized = canonicalTaskSourceReference(kind, reference).toLowerCase();
  let hash = 2_166_136_261;
  for (const character of `${kind}\0${normalized}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `source-${kind}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function defaultTaskSourceAuthorityRole(
  kind: TaskSourceKind,
): TaskSourceAuthorityRole {
  if (kind === "jira" || kind === "confluence") return "requirement";
  if (kind === "figma") return "visual";
  if (kind === "openapi") return "contract";
  return "implementation-reference";
}

export function defaultTaskSourceRoutePolicy(
  kind: TaskSourceKind,
  reference = "",
): TaskSourceRoutePolicy {
  const primaryAdapter =
    kind === "figma"
      ? "figma-desktop-mcp-local"
      : kind === "jira" || kind === "confluence"
        ? "atlassian-rovo"
        : kind === "github"
          ? "github-connector"
          : kind === "openapi"
            ? /^https?:\/\//iu.test(reference)
              ? "openapi-public-http"
              : /\.(?:json|ya?ml)(?:$|[?#])/iu.test(reference)
                ? "openapi-local-file"
                : "openapi-pasted"
            : "manual-import";
  return { primaryAdapter, fallback: "ask" };
}

function normalizeRoutePolicy(
  kind: TaskSourceKind,
  reference: string,
  input: TaskSourceRoutePolicy | undefined,
): TaskSourceRoutePolicy {
  const fallback = input?.fallback ?? "ask";
  const primaryAdapter =
    input?.primaryAdapter ?? defaultTaskSourceRoutePolicy(kind, reference).primaryAdapter;
  const allowedFallbackAdapters = [
    ...new Set(input?.allowedFallbackAdapters ?? []),
  ];
  if (
    !ADAPTER_ID.test(primaryAdapter) ||
    !["deny", "ask", "allow-list"].includes(fallback) ||
    allowedFallbackAdapters.some(
      (adapter) => !ADAPTER_ID.test(adapter) || adapter === primaryAdapter,
    ) ||
    (fallback !== "allow-list" && allowedFallbackAdapters.length > 0) ||
    (fallback === "allow-list" && allowedFallbackAdapters.length === 0)
  ) {
    throw new Error("A task source route policy is invalid.");
  }
  return {
    primaryAdapter,
    fallback,
    ...(allowedFallbackAdapters.length > 0
      ? { allowedFallbackAdapters }
      : {}),
  };
}

export function normalizeTaskSourceDecisions(
  input: unknown,
): TaskSourceDecision[] {
  if (!Array.isArray(input) || input.length > MAX_TASK_SOURCES) {
    throw new Error(`A task may contain at most ${MAX_TASK_SOURCES} sources.`);
  }
  const normalized = input.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Every task source must be an object.");
    }
    const source = candidate as Partial<TaskSourceDecision>;
    const reference =
      typeof source.reference === "string" ? source.reference.trim() : "";
    if (
      !TASK_SOURCE_KINDS.includes(source.kind as TaskSourceKind) ||
      !TASK_SOURCE_ORIGINS.includes(source.origin as TaskSourceOrigin) ||
      !TASK_SOURCE_STATES.includes(source.state as TaskSourceState) ||
      typeof source.required !== "boolean" ||
      !reference ||
      reference.length > MAX_SOURCE_REFERENCE_CHARS ||
      /[\u0000-\u001f]/u.test(reference) ||
      /^(?:file|javascript|data):/iu.test(reference) ||
      /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/iu.test(reference)
    ) {
      throw new Error("A task source reference or decision is invalid.");
    }
    if (
      source.decidedAt !== undefined &&
      (typeof source.decidedAt !== "string" ||
        !Number.isFinite(Date.parse(source.decidedAt)))
    ) {
      throw new Error("A task source decision timestamp is invalid.");
    }
    if (
      isMissingTaskSourceReference(reference) &&
      source.state === "confirmed"
    ) {
      throw new Error("A missing source placeholder cannot be confirmed.");
    }
    if (
      source.replacementFor !== undefined &&
      (typeof source.replacementFor !== "string" ||
        source.replacementFor.length > 100)
    ) {
      throw new Error("A replacement source reference is invalid.");
    }
    if (
      source.parentSourceId !== undefined &&
      (typeof source.parentSourceId !== "string" ||
        source.parentSourceId.length > 160)
    ) {
      throw new Error("A parent source reference is invalid.");
    }
    if (
      source.relationship !== undefined &&
      !["primary", "search-candidate", "linked-secondary"].includes(
        source.relationship,
      )
    ) {
      throw new Error("A source relationship is invalid.");
    }
    if (
      source.state === "confirmed" &&
      (source.relationship === "search-candidate" ||
        source.relationship === "linked-secondary")
    ) {
      throw new Error(
        "A search candidate or linked secondary must be promoted to an explicit primary source before confirmation.",
      );
    }
    const kind = source.kind as TaskSourceKind;
    const authorityRole =
      source.authorityRole ?? defaultTaskSourceAuthorityRole(kind);
    if (
      ![
        "requirement",
        "visual",
        "contract",
        "implementation-reference",
      ].includes(authorityRole)
    ) {
      throw new Error("A task source authority role is invalid.");
    }
    return {
      id: taskSourceId(kind, reference),
      kind,
      reference,
      origin: source.origin as TaskSourceOrigin,
      state: source.state as TaskSourceState,
      required: source.required,
      ...(source.replacementFor
        ? { replacementFor: source.replacementFor }
        : {}),
      ...(source.parentSourceId
        ? { parentSourceId: source.parentSourceId }
        : {}),
      ...(source.relationship ? { relationship: source.relationship } : {}),
      authorityRole,
      routePolicy: normalizeRoutePolicy(kind, reference, source.routePolicy),
      ...(source.decidedAt ? { decidedAt: source.decidedAt } : {}),
    };
  });
  if (new Set(normalized.map((source) => source.id)).size !== normalized.length) {
    throw new Error("A task source appears more than once.");
  }
  return normalized;
}

export function taskSourceRelationId(
  fromSourceId: string,
  toSourceId: string,
  kind: TaskSourceRelationKind,
  targetScopeId = "",
): string {
  let hash = 2_166_136_261;
  for (const character of `${fromSourceId}\0${toSourceId}\0${kind}\0${targetScopeId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `relation-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeTaskSourceRelations(
  input: unknown,
  decisions: TaskSourceDecision[],
): TaskSourceRelation[] {
  if (!Array.isArray(input) || input.length > MAX_TASK_SOURCE_RELATIONS) {
    throw new Error(
      `A task may contain at most ${MAX_TASK_SOURCE_RELATIONS} source relations.`,
    );
  }
  const decisionById = new Map(decisions.map((decision) => [decision.id, decision]));
  const relations = input.map((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      throw new Error("Every source relation must be an object.");
    }
    const relation = candidate as Partial<TaskSourceRelation>;
    const from = decisionById.get(String(relation.fromSourceId ?? ""));
    const to = decisionById.get(String(relation.toSourceId ?? ""));
    if (
      !from ||
      !to ||
      from.state !== "confirmed" ||
      to.state !== "confirmed" ||
      from.id === to.id ||
      ![
        "references-design",
        "constrains-contract",
        "secondary-implementation-reference",
      ].includes(String(relation.kind))
    ) {
      throw new Error("A source relation must connect two confirmed sources.");
    }
    if (
      relation.kind === "references-design" &&
      ((
        from.authorityRole ?? defaultTaskSourceAuthorityRole(from.kind)
      ) !== "requirement" ||
        (to.authorityRole ?? defaultTaskSourceAuthorityRole(to.kind)) !==
          "visual")
    ) {
      throw new Error(
        "A design reference relation must point from requirement authority to visual authority.",
      );
    }
    const targetScope = relation.targetScope;
    if (
      targetScope &&
      (targetScope.provider !== to.kind ||
        !["file", "page", "node", "selection", "operation", "unknown"].includes(
          targetScope.kind,
        ) ||
        typeof targetScope.id !== "string" ||
        !targetScope.id.trim() ||
        targetScope.id.length > 500 ||
        /[\u0000-\u001f]/u.test(targetScope.id))
    ) {
      throw new Error("A source relation target scope is invalid.");
    }
    if (
      relation.confirmedAt !== undefined &&
      (typeof relation.confirmedAt !== "string" ||
        !Number.isFinite(Date.parse(relation.confirmedAt)))
    ) {
      throw new Error("A source relation timestamp is invalid.");
    }
    const kind = relation.kind as TaskSourceRelationKind;
    const id = taskSourceRelationId(
      from.id,
      to.id,
      kind,
      targetScope?.id,
    );
    if (relation.id && relation.id !== id) {
      throw new Error("A source relation ID does not match its immutable fields.");
    }
    return {
      id,
      fromSourceId: from.id,
      toSourceId: to.id,
      kind,
      ...(targetScope
        ? {
            targetScope: {
              ...targetScope,
              id: targetScope.id.trim(),
            },
          }
        : {}),
      ...(relation.confirmedAt ? { confirmedAt: relation.confirmedAt } : {}),
    };
  });
  if (new Set(relations.map((relation) => relation.id)).size !== relations.length) {
    throw new Error("A task source relation appears more than once.");
  }
  return relations;
}

export function classifyTaskSource(reference: string): TaskSourceKind {
  const value = reference.toLowerCase();
  if (
    /(?:^|[/:#._-])(?:openapi|swagger)(?:[/:#._-]|$)/i.test(reference) ||
    /\/(?:v[1-9]\d*\/)?api-docs(?:[/?#]|$)/i.test(reference)
  ) {
    return "openapi";
  }
  if (value.includes("figma.com") || /^figma[:#]/i.test(reference)) {
    return "figma";
  }
  if (
    value.includes("atlassian.net/browse/") ||
    value.includes("/jira/") ||
    /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(reference)
  ) {
    return "jira";
  }
  if (
    value.includes("atlassian.net/wiki/") ||
    value.includes("/confluence/") ||
    /^confluence[:#]/i.test(reference)
  ) {
    return "confluence";
  }
  if (value.includes("github.com/") || /^github[:#]/i.test(reference)) {
    return "github";
  }
  return "other";
}

export function detectTaskSources(task: string): TaskSourceDecision[] {
  const references: Array<{ reference: string; origin: TaskSourceOrigin }> = [];
  for (const match of task.matchAll(/https?:\/\/[^\s<>"']+/giu)) {
    references.push({
      reference: normalizedReference(match[0]),
      origin: "explicit",
    });
  }
  for (const match of task.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g)) {
    if (
      !references.some(
        ({ reference }) =>
          /^https?:/iu.test(reference) &&
          reference.toLowerCase().includes(match[0].toLowerCase()),
      )
    ) {
      references.push({ reference: match[0], origin: "inferred" });
    }
  }
  for (const match of task.matchAll(/\b(?:figma|confluence)[:#]\s*([A-Za-z0-9_-]{6,})\b/giu)) {
    references.push({
      reference: `${match[0].split(/[:#]/u)[0]!.toLowerCase()}:${match[1]}`,
      origin: "inferred",
    });
  }
  for (const match of task.matchAll(
    /(?:^|[\s("'`])((?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[^\s"'`()]*?(?:openapi|swagger)\.(?:json|ya?ml))(?=$|[\s)"'`,.;!?])/giu,
  )) {
    references.push({
      reference: normalizedReference(match[1]!),
      origin: "explicit",
    });
  }
  for (const match of task.matchAll(
    /\b(?:openapi|swagger)[:#]\s*([^\s<>"']+)/giu,
  )) {
    const value = normalizedReference(match[1]!);
    if (
      references.some(
        ({ reference }) => reference.toLowerCase() === value.toLowerCase(),
      )
    ) {
      continue;
    }
    references.push({
      reference: `${match[0].split(/[:#]/u)[0]!.toLowerCase()}:${value}`,
      origin: "explicit",
    });
  }

  return references
    .map(({ reference, origin }) => {
      const kind = classifyTaskSource(reference);
      return {
        id: taskSourceId(kind, reference),
        kind,
        reference,
        origin,
        state: "pending" as const,
        required: taskRequiredSourceKinds(task).includes(kind),
        relationship: "primary" as const,
        authorityRole: defaultTaskSourceAuthorityRole(kind),
        routePolicy: defaultTaskSourceRoutePolicy(kind, reference),
      };
    })
    .filter(
      (source, index, collection) =>
        collection.findIndex((candidate) => candidate.id === source.id) === index,
    )
    .slice(0, 12);
}

export function taskRequiredSourceKinds(task: string): TaskSourceKind[] {
  const required = new Set<TaskSourceKind>();
  if (
    /\b(?:openapi|swagger|api contract|contrato (?:de la )?api)\b/iu.test(task) &&
    /\b(?:source of truth|contract|according to|implement from|must use|use|using|usa|usar|utiliza|seg[uú]n|contrato|fuente de verdad)\b/iu.test(
      task,
    )
  ) {
    required.add("openapi");
  }
  if (
    /\bfigma\b/iu.test(task) &&
    /\b(?:source of truth|match exactly|pixel perfect|declared design|fuente de verdad|replicar exactamente|dise[nñ]o objetivo)\b/iu.test(
      task,
    )
  ) {
    required.add("figma");
  }
  return [...required];
}

export function ensureTaskSourceDecisions(
  task: string,
  current: TaskSourceDecision[],
): TaskSourceDecision[] {
  const requiredKinds = new Set(taskRequiredSourceKinds(task));
  const byId = new Map(
    current.map((source) => [
      source.id,
      {
        ...source,
        required: source.required || requiredKinds.has(source.kind),
      },
    ]),
  );
  for (const detected of detectTaskSources(task)) {
    if (!byId.has(detected.id)) byId.set(detected.id, detected);
  }
  let sources = [...byId.values()];
  const intakeKinds = new Set<TaskSourceKind>(requiredKinds);
  for (const kind of intakeKinds) {
    const concrete = sources.filter(
      (source) =>
        source.kind === kind &&
        !isMissingTaskSourceReference(source.reference) &&
        source.state !== "replaced",
    );
    if (concrete.length > 0) {
      sources = sources.filter(
        (source) =>
          source.kind !== kind ||
          !isMissingTaskSourceReference(source.reference),
      );
      continue;
    }
    const reference = missingTaskSourceReference(kind);
    const id = taskSourceId(kind, reference);
    if (!sources.some((source) => source.id === id)) {
      sources.push({
        id,
        kind,
        reference,
        origin: "manual",
        state: "pending",
        required: requiredKinds.has(kind),
        relationship: "primary",
        authorityRole: defaultTaskSourceAuthorityRole(kind),
        routePolicy: defaultTaskSourceRoutePolicy(kind, reference),
      });
    }
  }
  return sources.slice(0, MAX_TASK_SOURCES);
}

export function assessTaskRisk(task: string): TaskRiskAssessment {
  const objective = task.trim();
  const highReasons = HIGH_RISK_PATTERNS.filter(([pattern]) =>
    pattern.test(objective),
  ).map(([, reason]) => reason);
  if (highReasons.length > 0) {
    return {
      level: "high",
      reasons: highReasons,
      requiresObjectiveConfirmation: true,
    };
  }

  const mediumReasons = MEDIUM_RISK_PATTERNS.filter(([pattern]) =>
    pattern.test(objective),
  ).map(([, reason]) => reason);
  if (mediumReasons.length > 0 || objective.length > 280) {
    return {
      level: "medium",
      reasons:
        mediumReasons.length > 0
          ? mediumReasons
          : ["Broad task description"],
      requiresObjectiveConfirmation: true,
    };
  }

  const hasLowSignal = LOW_RISK_PATTERNS.some((pattern) =>
    pattern.test(objective),
  );
  return {
    level: "low",
    reasons: [
      hasLowSignal
        ? "Small, localized presentation change"
        : "No elevated-risk signal detected",
    ],
    requiresObjectiveConfirmation: false,
  };
}

export function assessTaskIntake(
  intake: TaskIntakeState,
): TaskIntakeAssessment {
  const reasons: string[] = [];
  if (!intake.objective.trim()) reasons.push("Add a task objective.");
  if (
    intake.risk.requiresObjectiveConfirmation &&
    !intake.objectiveConfirmed
  ) {
    reasons.push("Confirm the objective before Project Atlas starts an agent.");
  }
  if (intake.sources.some((source) => source.state === "pending")) {
    reasons.push("Confirm, replace, omit, or mark every detected source unavailable.");
  }
  const requiredUnavailable = intake.sources.filter(
    (source) =>
      source.required &&
      (source.state === "omitted" || source.state === "unavailable"),
  );
  if (requiredUnavailable.length > 0) {
    reasons.push("A required source is unavailable or omitted.");
    return { status: "blocked", reasons };
  }
  return {
    status: reasons.length > 0 ? "needs-confirmation" : "ready",
    reasons,
  };
}

export function confirmedTaskSources(
  sources: TaskSourceDecision[],
): TaskSourceDecision[] {
  return sources.filter(
    (source) =>
      source.state === "confirmed" &&
      !isMissingTaskSourceReference(source.reference),
  );
}

export function taskContextSourcePolicy(
  sources: TaskSourceDecision[],
  relations: TaskSourceRelation[] = [],
): TaskContextSourcePolicy {
  const kindsFor = (state: TaskSourceState) => [
    ...new Set(
      sources
        .filter((source) => source.state === state)
        .map((source) => source.kind),
    ),
  ];
  return {
    scope: "task",
    confirmedKinds: kindsFor("confirmed"),
    omittedKinds: kindsFor("omitted"),
    unavailableKinds: kindsFor("unavailable"),
    externalKinds: kindsFor("external"),
    routes: sources
      .filter((source) => source.state === "confirmed")
      .map((source) => {
        const authorityRole =
          source.authorityRole ?? defaultTaskSourceAuthorityRole(source.kind);
        const routePolicy =
          source.routePolicy ??
          defaultTaskSourceRoutePolicy(source.kind, source.reference);
        return {
          sourceDecisionId: source.id,
          authorityRole,
          primaryAdapter: routePolicy.primaryAdapter,
          fallback: routePolicy.fallback,
          allowedFallbackAdapters: routePolicy.allowedFallbackAdapters ?? [],
        };
      }),
    relations: normalizeTaskSourceRelations(relations, sources),
  };
}
