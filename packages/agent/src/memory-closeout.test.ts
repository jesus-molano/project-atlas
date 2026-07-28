import { describe, expect, it } from "vitest";
import {
  memoryCloseoutActionMessage,
  parseMemoryCloseout,
} from "./memory-closeout.js";

describe("shared memory closeout contract", () => {
  it("represents a completed task with no durable candidate", () => {
    expect(
      parseMemoryCloseout({
        status: "none",
        summary: "No durable project knowledge was detected.",
        candidates: [],
        confirmationRequired: false,
        confirmationPrompt: "",
      }),
    ).toMatchObject({
      status: "none",
      candidates: [],
      confirmationRequired: false,
    });
  });

  it("requires exact confirmation for a canonical candidate", () => {
    const candidate = {
      status: "canonical-candidate",
      summary: "A reusable route-state convention was detected.",
      candidates: [
        {
          type: "convention",
          title: "Persist catalogue filters in the URL",
          summary: "Catalogue filters use query parameters for shareable state.",
          evidence: ["The route reads and writes query state."],
          scope: "canonical",
          confidence: 0.9,
        },
      ],
      confirmationRequired: true,
      confirmationPrompt:
        "Save this convention as canonical Project Memory?",
    };
    const parsed = parseMemoryCloseout(candidate);
    expect(parsed).toMatchObject({
      status: "canonical-candidate",
      confirmationRequired: true,
    });
    expect(memoryCloseoutActionMessage(parsed, "confirm-canonical")).toMatch(
      /explicitly authorize the canonical Project Memory write/i,
    );
    expect(memoryCloseoutActionMessage(parsed, "decline")).toMatch(
      /do not store it[\s\S]*declined/i,
    );
    expect(
      parseMemoryCloseout({
        ...candidate,
        status: "canonical-stored",
        summary: "The confirmed convention was stored.",
        confirmationRequired: false,
        confirmationPrompt: "",
      }),
    ).toMatchObject({
      status: "canonical-stored",
      confirmationRequired: false,
    });
    expect(() =>
      parseMemoryCloseout({
        ...candidate,
        confirmationRequired: false,
        confirmationPrompt: "",
      }),
    ).toThrow(/explicit confirmation/i);
  });

  it("keeps an episodic result local without a promotion question", () => {
    expect(
      parseMemoryCloseout({
        status: "local-only",
        summary: "This validation result belongs only to the checkout.",
        candidates: [],
        localOutcome: {
          summary: "The focused tests passed in this checkout.",
          evidence: ["pnpm test -- catalogue-filter"],
        },
        confirmationRequired: false,
        confirmationPrompt: "",
      }),
    ).toMatchObject({
      status: "local-only",
      confirmationRequired: false,
      localOutcome: {
        summary: "The focused tests passed in this checkout.",
      },
    });
  });

  it("records rejection or omission without storing or asking again", () => {
    const declined = parseMemoryCloseout({
        status: "declined",
        summary: "The candidate was declined; nothing was stored.",
        candidates: [],
        confirmationRequired: false,
        confirmationPrompt: "",
      });
    expect(declined).toMatchObject({
      status: "declined",
      candidates: [],
      confirmationRequired: false,
      confirmationPrompt: "",
    });
    expect(() =>
      memoryCloseoutActionMessage(declined, "confirm-canonical"),
    ).toThrow(/no pending canonical candidate/i);
  });
});
