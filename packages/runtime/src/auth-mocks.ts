export interface DevelopmentAuthMockGuard {
  schemaVersion: 1;
  mode: "dev-mock-no-session";
  adapterId: string;
  environment: "development" | "test";
  challengeOnly: true;
  profileFlowUntouched: true;
  acceptsRealCredentials: false;
  readsExistingSession: false;
  createsSession: false;
  issuesTokens: false;
  writesAuthCookies: false;
  productionEnabled: false;
}

export interface DevelopmentAuthMockRuntimeEvidence {
  nodeEnv: string | undefined;
  productionBuild: boolean;
  realCredentialsPresent: boolean;
  existingSessionPresent: boolean;
}

const ADAPTER_ID = /^[A-Za-z0-9._-]{1,120}$/u;
export function assertDevelopmentAuthMockGuard(
  value: DevelopmentAuthMockGuard,
): DevelopmentAuthMockGuard {
  if (
    value?.schemaVersion !== 1 ||
    value.mode !== "dev-mock-no-session" ||
    !ADAPTER_ID.test(value.adapterId) ||
    !["development", "test"].includes(value.environment) ||
    value.challengeOnly !== true ||
    value.profileFlowUntouched !== true ||
    value.acceptsRealCredentials !== false ||
    value.readsExistingSession !== false ||
    value.createsSession !== false ||
    value.issuesTokens !== false ||
    value.writesAuthCookies !== false ||
    value.productionEnabled !== false
  ) {
    throw new Error(
      "Development auth mock must be challenge-only, sessionless, credential-free, profile-isolated, and production-disabled.",
    );
  }
  return value;
}

export function assertDevelopmentAuthMockRuntime(
  guard: DevelopmentAuthMockGuard,
  evidence: DevelopmentAuthMockRuntimeEvidence,
): void {
  assertDevelopmentAuthMockGuard(guard);
  if (
    evidence.productionBuild ||
    evidence.nodeEnv === "production" ||
    !["development", "test"].includes(evidence.nodeEnv ?? "") ||
    evidence.realCredentialsPresent ||
    evidence.existingSessionPresent ||
    evidence.nodeEnv !== guard.environment
  ) {
    throw new Error(
      "Development auth mock cannot run in production, with real credentials, or with an existing session.",
    );
  }
}

export function assertSessionlessAuthMockResult(result: unknown): void {
  const inspect = (value: unknown, depth: number): void => {
    if (depth > 7) throw new Error("Auth mock result is too deeply nested.");
    if (typeof value === "string") {
      if (
        value.length > 1_000 ||
        /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./u.test(value) ||
        /(?:^|;\s*)set-cookie\s*:/iu.test(value)
      ) {
        throw new Error("Auth mock result contains session or token material.");
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 20) throw new Error("Auth mock result is oversized.");
      for (const item of value) inspect(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;
    const entries = Object.entries(value);
    if (entries.length > 30) throw new Error("Auth mock result is oversized.");
    for (const [key, item] of entries) {
      const normalizedKey = key.replace(/[^a-z0-9]+/giu, "").toLowerCase();
      if (
        /token|authorization|cookie|session|credential/u.test(normalizedKey)
      ) {
        throw new Error("Auth mock result contains session or token fields.");
      }
      inspect(item, depth + 1);
    }
  };
  inspect(result, 0);
  if (JSON.stringify(result).length > 12_000) {
    throw new Error("Auth mock result is oversized.");
  }
}
