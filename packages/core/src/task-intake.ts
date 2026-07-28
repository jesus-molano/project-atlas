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
  | "replaced";

export interface TaskSourceDecision {
  id: string;
  kind: TaskSourceKind;
  reference: string;
  origin: TaskSourceOrigin;
  state: TaskSourceState;
  required: boolean;
  replacementFor?: string;
  decidedAt?: string;
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
  "replaced",
];
const MAX_TASK_SOURCES = 12;
const MAX_SOURCE_REFERENCE_CHARS = 1_000;

const HIGH_RISK_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:auth|authentication|authorization|permission|role|access control|autenticaci[oó]n|autorizaci[oó]n|permiso|rol)\b/i, "Identity or access control"],
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

export function taskSourceId(kind: TaskSourceKind, reference: string): string {
  const normalized = normalizedReference(reference).toLowerCase();
  let hash = 2_166_136_261;
  for (const character of `${kind}\0${normalized}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `source-${kind}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
      source.replacementFor !== undefined &&
      (typeof source.replacementFor !== "string" ||
        source.replacementFor.length > 100)
    ) {
      throw new Error("A replacement source reference is invalid.");
    }
    const kind = source.kind as TaskSourceKind;
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
      ...(source.decidedAt ? { decidedAt: source.decidedAt } : {}),
    };
  });
  if (new Set(normalized.map((source) => source.id)).size !== normalized.length) {
    throw new Error("A task source appears more than once.");
  }
  return normalized;
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

function explicitlyConfirmsOpenApi(task: string, reference: string): boolean {
  const comparable = reference.replace(/^(?:openapi|swagger)[:#]\s*/iu, "");
  const index = task.toLowerCase().indexOf(comparable.toLowerCase());
  if (index < 0) return false;
  const prefix = task.slice(Math.max(0, index - 90), index);
  return /\b(?:use|using|usa|usar|utiliza|utilizar|segun|según|according to|implement from)\b[^.!?\n]{0,70}$/iu.test(
    prefix,
  );
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
      const confirmed =
        kind === "openapi" && explicitlyConfirmsOpenApi(task, reference);
      return {
        id: taskSourceId(kind, reference),
        kind,
        reference,
        origin,
        state: confirmed ? ("confirmed" as const) : ("pending" as const),
        required: false,
      };
    })
    .filter(
      (source, index, collection) =>
        collection.findIndex((candidate) => candidate.id === source.id) === index,
    )
    .slice(0, 12);
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
  return sources.filter((source) => source.state === "confirmed");
}

export function taskContextSourcePolicy(
  sources: TaskSourceDecision[],
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
  };
}
