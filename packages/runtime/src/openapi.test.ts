import { describe, expect, it } from "vitest";
import { extractOpenApiTaskContext } from "./openapi.js";

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
});
