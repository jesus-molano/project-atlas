import { describe, expect, it } from "vitest";
import {
  assertDevelopmentAuthMockGuard,
  assertDevelopmentAuthMockRuntime,
  assertSessionlessAuthMockResult,
  type DevelopmentAuthMockGuard,
} from "./auth-mocks.js";

const guard: DevelopmentAuthMockGuard = {
  schemaVersion: 1,
  mode: "dev-mock-no-session",
  adapterId: "login-challenge-dev",
  environment: "development",
  challengeOnly: true,
  profileFlowUntouched: true,
  acceptsRealCredentials: false,
  readsExistingSession: false,
  createsSession: false,
  issuesTokens: false,
  writesAuthCookies: false,
  productionEnabled: false,
};

describe("development authentication mock guard", () => {
  it("allows only an isolated sessionless login challenge adapter", () => {
    expect(assertDevelopmentAuthMockGuard(guard)).toEqual(guard);
    expect(() =>
      assertDevelopmentAuthMockRuntime(guard, {
        nodeEnv: "development",
        productionBuild: false,
        realCredentialsPresent: false,
        existingSessionPresent: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertSessionlessAuthMockResult({
        challengeId: "dev-challenge-1",
        status: "otp-required",
        expiresInSeconds: 120,
        attemptsRemaining: 3,
      }),
    ).not.toThrow();
  });

  it("rejects production activation, credentials, sessions, tokens, and cookies", () => {
    expect(() =>
      assertDevelopmentAuthMockRuntime(guard, {
        nodeEnv: "production",
        productionBuild: true,
        realCredentialsPresent: false,
        existingSessionPresent: false,
      }),
    ).toThrow(/production/i);
    expect(() =>
      assertDevelopmentAuthMockRuntime(guard, {
        nodeEnv: "development",
        productionBuild: false,
        realCredentialsPresent: true,
        existingSessionPresent: false,
      }),
    ).toThrow(/credentials/i);
    expect(() =>
      assertDevelopmentAuthMockRuntime(guard, {
        nodeEnv: "development",
        productionBuild: false,
        realCredentialsPresent: false,
        existingSessionPresent: true,
      }),
    ).toThrow(/session/i);
    for (const result of [
      { accessToken: "not-even-a-real-token" },
      { sessionId: "dev-session" },
      { headers: { "set-cookie": "auth=value" } },
      { credential: "password" },
    ]) {
      expect(() => assertSessionlessAuthMockResult(result)).toThrow(
        /session or token/i,
      );
    }
    expect(() =>
      assertDevelopmentAuthMockGuard({
        ...guard,
        profileFlowUntouched: false,
      } as unknown as DevelopmentAuthMockGuard),
    ).toThrow(/profile-isolated/i);
  });
});
