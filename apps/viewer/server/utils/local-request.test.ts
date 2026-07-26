import { describe, expect, it } from "vitest";
import {
  isAllowedMutationOrigin,
  isLocalRequestHost,
} from "./local-request.js";

describe("viewer local request policy", () => {
  it("accepts loopback hosts and origins", () => {
    expect(isLocalRequestHost("127.0.0.1:4173")).toBe(true);
    expect(isLocalRequestHost("localhost:4173")).toBe(true);
    expect(isLocalRequestHost("[::1]:4173")).toBe(true);
    expect(isAllowedMutationOrigin("http://127.0.0.1:4173")).toBe(true);
    expect(isAllowedMutationOrigin(undefined)).toBe(true);
  });

  it("rejects remote hosts and cross-origin mutations", () => {
    expect(isLocalRequestHost("atlas.example.test")).toBe(false);
    expect(isLocalRequestHost("192.168.1.10:4173")).toBe(false);
    expect(isAllowedMutationOrigin("https://example.test")).toBe(false);
    expect(isAllowedMutationOrigin("not a URL")).toBe(false);
  });
});
