export type AgentAdapterState =
  | "detected"
  | "unavailable"
  | "degraded"
  | "unknown";

export type AgentAuthenticationState =
  | "authenticated"
  | "unauthenticated"
  | "unknown";

export type AgentRunMode = "prepare" | "implement" | "continue" | "correct";
export type AgentSandbox = "read-only" | "workspace-write";

export interface AgentAdapterStatus {
  adapterId: string;
  label: string;
  state: AgentAdapterState;
  authentication: AgentAuthenticationState;
  checkedAt: string;
  detail: string;
  supportsResume: boolean;
  transport: "sdk" | "cli-json";
}

export interface AgentSourceReference {
  kind: AgentSourceKind;
  value: string;
}

export type AgentSourceKind =
  | "jira"
  | "confluence"
  | "figma"
  | "github"
  | "openapi"
  | "other";

export interface AgentSourceDecision {
  id: string;
  kind: AgentSourceKind;
  reference: string;
  origin: "explicit" | "inferred" | "manual";
  state: "pending" | "confirmed" | "omitted" | "unavailable" | "replaced";
  required: boolean;
  replacementFor?: string;
  decidedAt?: string;
}

export interface AgentTaskRiskAssessment {
  level: "low" | "medium" | "high";
  reasons: string[];
  requiresObjectiveConfirmation: boolean;
}

export interface AgentContextMetrics {
  budgetChars: number;
  usedChars: number;
  estimatedTokens: number;
  truncated: boolean;
}

export interface AgentRunRequest {
  mode: AgentRunMode;
  task: string;
  rootPath: string;
  compactContext: string;
  contextMetrics: AgentContextMetrics;
  sources: AgentSourceReference[];
  sourceDecisions: AgentSourceDecision[];
  risk: AgentTaskRiskAssessment;
  sandbox: AgentSandbox;
  threadId?: string;
  answer?: string;
  timeoutMs?: number;
}

export interface AgentCompactResult {
  status: "completed" | "needs-input";
  summary: string;
  brief: string[];
  evidence: Array<{
    source:
      | "repository"
      | "atlas"
      | "figma"
      | "jira"
      | "confluence"
      | "github"
      | "openapi"
      | "agent";
    label: string;
    handle?: string;
  }>;
  decisions: Array<{
    title: string;
    status: "confirmed" | "pending";
    recommendation?: string;
  }>;
  risks: Array<{
    level: "decision-required" | "warning" | "resolved";
    title: string;
    recommendation: string;
  }>;
  memoryProposals: Array<{
    type: string;
    title: string;
    summary: string;
  }>;
  outcome?: {
    status: "implemented" | "prepared" | "blocked" | "failed";
    summary: string;
    verification: string[];
  };
  question?: {
    prompt: string;
    evidence: string[];
    recommendation: string;
  };
}

export type AgentRunEvent =
  | {
      type: "run-started";
      at: string;
      threadId?: string;
      message: string;
    }
  | {
      type: "activity";
      at: string;
      phase:
        | "orienting"
        | "reading"
        | "planning"
        | "editing"
        | "validating"
        | "finalizing";
      message: string;
    }
  | {
      type: "question";
      at: string;
      prompt: string;
      evidence: string[];
      recommendation: string;
    }
  | {
      type: "approval";
      at: string;
      action: string;
      detail: string;
      external: boolean;
    }
  | {
      type: "completed";
      at: string;
      threadId: string;
      result: AgentCompactResult;
      usage?: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
      };
    }
  | {
      type: "failed";
      at: string;
      code: "unavailable" | "unauthenticated" | "timeout" | "invalid-output" | "runtime";
      message: string;
    }
  | {
      type: "cancelled";
      at: string;
      message: string;
    };

export interface AgentRunHandle {
  cancel(reason?: string): void;
  events: AsyncIterable<AgentRunEvent>;
}

export interface AgentAdapter {
  readonly id: string;
  status(): Promise<AgentAdapterStatus>;
  run(request: AgentRunRequest): AgentRunHandle;
}

export type ActionExecutionClass =
  | "local"
  | "agent-assisted"
  | "external-write";

export type ActionRiskLevel = "low" | "medium" | "high";

export interface ActionInputDefinition {
  id: string;
  label: string;
  type: "text" | "multiline" | "select" | "reference" | "boolean";
  required: boolean;
  advanced?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface ActionCapabilityRequirement {
  id: string;
  importance: "required" | "recommended" | "optional";
  reason: string;
}

export interface ActionCapabilityManifest {
  schemaVersion: 1;
  id: string;
  intent: string;
  description: string;
  runtime: "atlas" | "agent";
  skill?: string;
  adapter?: string;
  executionClass: ActionExecutionClass;
  risk: ActionRiskLevel;
  inputs: ActionInputDefinition[];
  capabilities: ActionCapabilityRequirement[];
  possibleWrites: Array<
    "derived-index" | "checkout" | "local-memory" | "canonical-memory" | "external"
  >;
  expectedQuestions: string[];
  resultKind:
    | "scan-summary"
    | "task-brief"
    | "task-outcome"
    | "memory-review"
    | "selection-answer";
  cancellable: boolean;
  resumable: boolean;
  timeoutMs: number;
  fallback?: {
    label: string;
    actionId?: string;
    detail: string;
  };
}
