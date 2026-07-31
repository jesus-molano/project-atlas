import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSourceReceipt,
  sourceIdentityFromReference,
  taskSourceId,
} from "@component-atlas/core";
import {
  extractOpenApiTaskContext,
  loadConfirmedOpenApiContext,
} from "./openapi.js";

const specification = `
openapi: 3.1.0
paths:
  /orders/{orderId}:
    get:
      operationId: getOrder
      summary: Fetch one order
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
      security:
        - bearerAuth: []
  /admin/users:
    delete:
      operationId: deleteAdminUser
      responses:
        "204": {}
components:
  schemas:
    Order:
      type: object
      required: [id, status]
      properties:
        id:
          type: string
        status:
          type: string
          enum: [pending, paid]
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
`;

function receiptBackedSpecification(
  reference: string,
  operationPath: string,
  operationId: string,
  observedAt: string,
) {
  const content = JSON.stringify({
    openapi: "3.1.0",
    info: { title: operationId, version: "1" },
    paths: {
      [operationPath]: {
        get: { operationId, responses: { 200: { description: "ok" } } },
      },
    },
  });
  const identity = sourceIdentityFromReference("openapi", reference);
  const documentReceipt = createSourceReceipt({
    sourceDecisionId: taskSourceId("openapi", reference),
    provider: "openapi",
    requested: identity,
    resolved: identity,
    adapter: "openapi-pasted",
    route: `caller:${operationId}`,
    operation: "read_pasted_openapi",
    scope: { kind: "document", id: identity.canonicalId },
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    observedAt,
    coverage: "exact",
    freshness: "current",
  });
  return extractOpenApiTaskContext(content, operationId, documentReceipt);
}

describe("OpenAPI task context", () => {
  it("keeps only bounded, task-relevant API contract details", () => {
    const context = extractOpenApiTaskContext(
      specification,
      "Show the order details for an orderId",
    );
    expect(context).toMatchObject({
      available: true,
      format: "openapi",
      operations: [
        {
          method: "GET",
          path: "/orders/{orderId}",
          operationId: "getOrder",
          parameters: [
            {
              name: "orderId",
              in: "path",
              required: true,
            },
          ],
          security: [{ scheme: "bearerAuth", scopes: [] }],
        },
      ],
      authentication: [{ scheme: "bearerAuth", type: "http" }],
    });
    expect(JSON.stringify(context)).not.toContain("/admin/users");
    expect(JSON.stringify(context)).not.toContain("openapi: 3.1.0");
    const operationReceipt = context.receipts.find(
      (receipt) => receipt.scope.kind === "operation",
    );
    expect(operationReceipt).toMatchObject({
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      resolved: {
        method: "GET",
        path: "/orders/{orderId}",
        operationId: "getOrder",
      },
    });
    expect(context.operations[0]?.sourceReceiptIds).toEqual([
      operationReceipt?.id,
    ]);
  });

  it("blocks conflicting operations instead of silently picking a contract", async () => {
    const changed = specification.replace(
      "required: [id, status]",
      "required: [id]",
    );
    const context = await loadConfirmedOpenApiContext(
      "/repo",
      "Fetch one order",
      [
        {
          sourceDecisionId: taskSourceId("openapi", "contract-a"),
          reference: "contract-a",
          content: specification,
          adapter: "openapi-pasted",
        },
        {
          sourceDecisionId: taskSourceId("openapi", "contract-b"),
          reference: "contract-b",
          content: changed,
          adapter: "openapi-internal-connector",
          route: "swagger-connector:contract-b",
        },
      ],
    );
    expect(context?.conflicts).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/orders/{orderId}",
        receiptIds: expect.any(Array),
      }),
    ]);
    expect(context?.operations).toEqual([]);
  });

  it("keeps a valid contract when another confirmed source fails safely", async () => {
    const context = await loadConfirmedOpenApiContext(
      "/repo",
      "Fetch one order",
      [
        {
          sourceDecisionId: taskSourceId("openapi", "contract-valid"),
          reference: "contract-valid",
          content: specification,
          adapter: "openapi-pasted",
        },
        {
          sourceDecisionId: taskSourceId(
            "openapi",
            "https://internal.example/openapi",
          ),
          reference: "https://internal.example/openapi",
          content: "not a contract",
          adapter: "openapi-internal-connector",
          route: "swagger-connector:internal",
        },
      ],
    );
    expect(context).toMatchObject({
      available: true,
      contracts: 1,
      errors: [
        expect.objectContaining({
          recoverableWithConnector: true,
          receiptId: expect.stringMatching(/^receipt-/),
        }),
      ],
    });
    expect(context?.operations[0]?.sourceReceiptIds).toHaveLength(1);
  });

  it("preserves optionality and HTTP status for bounded fallback decisions", async () => {
    const reference = "https://api.example.com/openapi.json";
    const context = await loadConfirmedOpenApiContext(
      "/repo",
      "Update the checkout client",
      [
        {
          sourceDecisionId: taskSourceId("openapi", reference),
          reference,
          required: false,
        },
      ],
      async () => {
        throw new Error("The confirmed OpenAPI URL returned HTTP 502.");
      },
    );
    expect(context).toMatchObject({
      available: false,
      errors: [
        expect.objectContaining({
          reference,
          required: false,
          httpStatus: 502,
          recoverableWithConnector: true,
        }),
      ],
    });
  });

  it("denies an unauthorized automatic adapter before private-source I/O", async () => {
    const reference = "https://swagger.internal.example.test/openapi.json";
    const context = await loadConfirmedOpenApiContext(
      "/repo",
      "Use the private contract",
      [
        {
          sourceDecisionId: taskSourceId("openapi", reference),
          reference,
          required: true,
          routePolicy: {
            primaryAdapter: "openapi-internal-connector",
            fallback: "deny",
          },
        },
      ],
    );
    expect(context).toMatchObject({
      available: false,
      errors: [
        expect.objectContaining({
          required: true,
          message: expect.stringMatching(
            /automatic openapi-public-http refetch is not authorized/iu,
          ),
        }),
      ],
    });
    expect(JSON.stringify(context)).not.toContain("ENOTFOUND");
  });

  it("keeps Swagger UI identity while recording a verified derived spec", async () => {
    const reference = "https://api.example.com/swagger";
    const context = await loadConfirmedOpenApiContext(
      "/repo",
      "Create a login challenge",
      [
        {
          sourceDecisionId: taskSourceId("openapi", reference),
          reference,
          routePolicy: {
            primaryAdapter: "openapi-public-http",
            fallback: "deny",
          },
        },
      ],
      async () => ({
        content: specification,
        adapter: "openapi-public-http",
        route: "https://api.example.com/openapi.json",
        operation: "canonicalize-swagger-ui-contract",
        observedAt: "2026-07-29T12:00:00.000Z",
        derivation: {
          kind: "swagger-ui-config",
          targetUrl: "https://api.example.com/openapi.json",
          evidenceHash: `sha256:${"a".repeat(64)}`,
          redirectChain: [
            "https://api.example.com/swagger",
            "https://api.example.com/openapi.json",
          ],
        },
      }),
    );

    expect(context?.receipts[0]).toMatchObject({
      requested: { canonicalId: reference },
      resolved: { canonicalId: reference },
      adapter: "openapi-public-http",
      route: "https://api.example.com/openapi.json",
      derivation: {
        kind: "swagger-ui-config",
        sourceId: reference,
        targetId: "https://api.example.com/openapi.json",
      },
      coverage: "exact",
    });
  });

  it("reuses only latest content-addressed operation receipts across sources without I/O", async () => {
    const referenceA = "pasted:private-orders";
    const referenceB = "pasted:private-catalog";
    const oldA = receiptBackedSpecification(
      referenceA,
      "/v1/orders",
      "getOldOrders",
      "2026-07-29T12:00:00.000Z",
    );
    const currentA = receiptBackedSpecification(
      referenceA,
      "/v2/orders",
      "getCurrentOrders",
      "2026-07-31T12:00:00.000Z",
    );
    const currentB = receiptBackedSpecification(
      referenceB,
      "/v1/catalog",
      "getCatalog",
      "2026-07-30T12:00:00.000Z",
    );
    const identityA = sourceIdentityFromReference("openapi", referenceA);
    const hashlessHistory = createSourceReceipt({
      sourceDecisionId: taskSourceId("openapi", referenceA),
      provider: "openapi",
      requested: identityA,
      resolved: {
        ...identityA,
        method: "GET",
        path: "/manual/hashless",
        operationId: "getHashlessHistory",
      },
      adapter: "openapi-pasted",
      route: "caller:manual-history",
      operation: "resolve-operation",
      scope: { kind: "operation", id: "GET /manual/hashless" },
      observedAt: "2026-08-01T12:00:00.000Z",
      coverage: "exact",
      freshness: "current",
    });

    const context = await loadConfirmedOpenApiContext(
      "/path-that-must-not-be-read",
      "Use current orders and catalog",
      [referenceA, referenceB].map((reference) => ({
        sourceDecisionId: taskSourceId("openapi", reference),
        reference,
        required: true,
        routePolicy: {
          primaryAdapter: "openapi-pasted",
          fallback: "deny" as const,
        },
      })),
      undefined,
      [
        ...oldA.receipts,
        hashlessHistory,
        ...currentA.receipts,
        ...currentB.receipts,
      ],
    );

    expect(context).toMatchObject({
      available: true,
      format: "mixed",
      contracts: 2,
      errors: [],
      operations: expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/v2/orders" }),
        expect.objectContaining({ method: "GET", path: "/v1/catalog" }),
      ]),
    });
    expect(context?.operations).toHaveLength(2);
    expect(JSON.stringify(context)).not.toMatch(
      /\/v1\/orders|\/manual\/hashless/u,
    );

    const freshReference = "pasted:fresh-orders-copy";
    const matchingFreshContent = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Current orders copy", version: "1" },
      paths: {
        "/v2/orders": {
          get: {
            operationId: "getCurrentOrders",
            responses: { 200: { description: "ok" } },
          },
        },
      },
    });
    const mixedFreshAndReceipt = await loadConfirmedOpenApiContext(
      "/path-that-must-not-be-read",
      "Use current orders",
      [
        {
          sourceDecisionId: taskSourceId("openapi", referenceA),
          reference: referenceA,
          required: true,
          routePolicy: {
            primaryAdapter: "openapi-pasted",
            fallback: "deny",
          },
        },
        {
          sourceDecisionId: taskSourceId("openapi", freshReference),
          reference: freshReference,
          required: true,
          content: matchingFreshContent,
          adapter: "openapi-pasted",
          route: "caller:fresh-orders-copy",
        },
      ],
      undefined,
      currentA.receipts,
    );
    expect(mixedFreshAndReceipt).toMatchObject({
      contracts: 2,
      conflicts: [],
      operations: [
        expect.objectContaining({
          method: "GET",
          path: "/v2/orders",
          operationId: "getCurrentOrders",
          sourceReceiptIds: expect.arrayContaining([
            currentA.operations[0]!.sourceReceiptIds[0]!,
          ]),
        }),
      ],
    });
    expect(
      mixedFreshAndReceipt?.operations[0]?.sourceReceiptIds,
    ).toHaveLength(2);
  });
});
