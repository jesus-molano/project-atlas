import { describe, expect, it } from "vitest";
import { taskSourceId } from "@component-atlas/core";
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
});
