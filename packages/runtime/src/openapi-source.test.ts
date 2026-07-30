import { describe, expect, it, vi } from "vitest";
import {
  assertPublicRemoteUrl,
  assertSameOriginTransition,
  canonicalizePublicOpenApiReference,
  pinnedAddressLookup,
  privateNetworkAddress,
  readPublicDocument,
  type PublicDocumentLoader,
} from "./openapi-source.js";

const specification = JSON.stringify({
  openapi: "3.1.0",
  paths: {
    "/login/challenge": {
      post: {
        operationId: "createLoginChallenge",
        responses: { 204: {} },
      },
    },
  },
});

function loader(
  documents: Record<string, string>,
): PublicDocumentLoader & ReturnType<typeof vi.fn> {
  return vi.fn(async (reference: string) => {
    const url = new URL(reference).toString();
    const content = documents[url];
    if (content === undefined) throw new Error(`Unexpected URL: ${url}`);
    return {
      requestedUrl: url,
      finalUrl: url,
      redirectChain: [url],
      content,
    };
  }) as PublicDocumentLoader & ReturnType<typeof vi.fn>;
}

describe("secure Swagger UI canonicalization", () => {
  it("derives one same-origin specification without executing the UI", async () => {
    const load = loader({
      "https://api.example.com/docs": `
        <html><script>
          window.ui = SwaggerUIBundle({
            url: "/openapi.json",
            dom_id: "#swagger-ui"
          })
        </script></html>
      `,
      "https://api.example.com/openapi.json": specification,
    });

    const result = await canonicalizePublicOpenApiReference(
      "https://api.example.com/docs",
      load,
    );

    expect(result).toMatchObject({
      finalUrl: "https://api.example.com/openapi.json",
      operation: "canonicalize-swagger-ui-contract",
      derivation: {
        kind: "swagger-ui-config",
        targetUrl: "https://api.example.com/openapi.json",
        evidenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      },
    });
    expect(result.content).toBe(specification);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("supports a bounded same-origin configUrl hop", async () => {
    const load = loader({
      "https://api.example.com/swagger": `
        <script>SwaggerUIBundle({ configUrl: "/swagger-config" })</script>
      `,
      "https://api.example.com/swagger-config": JSON.stringify({
        url: "/v1/openapi.yaml",
      }),
      "https://api.example.com/v1/openapi.yaml": specification,
    });

    const result = await canonicalizePublicOpenApiReference(
      "https://api.example.com/swagger",
      load,
    );
    expect(result.derivation).toMatchObject({
      kind: "swagger-ui-config-url",
      targetUrl: "https://api.example.com/v1/openapi.yaml",
    });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("fails closed for cross-origin derivation, redirects, and ambiguous specs", async () => {
    const crossOrigin = loader({
      "https://api.example.com/docs":
        "<script>SwaggerUIBundle({url:\"https://other.example/openapi.json\"})</script>",
    });
    await expect(
      canonicalizePublicOpenApiReference(
        "https://api.example.com/docs",
        crossOrigin,
      ),
    ).rejects.toThrow(/cross-origin/i);
    expect(crossOrigin).toHaveBeenCalledTimes(1);

    expect(() =>
      assertSameOriginTransition(
        "https://api.example.com/docs",
        "https://other.example/openapi.json",
      ),
    ).toThrow(/explicit source decision/i);

    const ambiguous = loader({
      "https://api.example.com/docs":
        "<script>SwaggerUIBundle({urls:[{url:\"/a.json\"},{url:\"/b.json\"}]})</script>",
    });
    await expect(
      canonicalizePublicOpenApiReference(
        "https://api.example.com/docs",
        ambiguous,
      ),
    ).rejects.toThrow(/multiple contracts/i);
  });

  it("rejects private DNS answers, private literals, credentials, and nonstandard ports", async () => {
    expect(privateNetworkAddress("127.0.0.1")).toBe(true);
    expect(privateNetworkAddress("169.254.169.254")).toBe(true);
    expect(privateNetworkAddress("203.0.113.10")).toBe(true);
    expect(privateNetworkAddress("::ffff:10.0.0.1")).toBe(true);
    expect(privateNetworkAddress("::1")).toBe(true);
    expect(privateNetworkAddress("fc00::1")).toBe(true);
    expect(privateNetworkAddress("fe80::1")).toBe(true);
    expect(privateNetworkAddress("2001::1")).toBe(true);
    expect(privateNetworkAddress("2001:db8::1")).toBe(true);
    expect(privateNetworkAddress("2001:10::1")).toBe(true);
    expect(privateNetworkAddress("2001:20::1")).toBe(true);
    expect(privateNetworkAddress("2002:c000:204::1")).toBe(true);
    expect(privateNetworkAddress("93.184.216.34")).toBe(false);
    expect(privateNetworkAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(
      false,
    );

    await expect(
      assertPublicRemoteUrl(
        "https://api.example.com/openapi.json",
        async () => [{ address: "127.0.0.1", family: 4 }],
      ),
    ).rejects.toThrow(/private network/i);
    await expect(
      assertPublicRemoteUrl(
        "https://127.0.0.1/openapi.json",
        async () => [{ address: "127.0.0.1", family: 4 }],
      ),
    ).rejects.toThrow(/private network/i);
    await expect(
      assertPublicRemoteUrl(
        "https://user:secret@api.example.com/openapi.json",
      ),
    ).rejects.toThrow(/credentials/i);
    await expect(
      assertPublicRemoteUrl("https://api.example.com:8443/openapi.json"),
    ).rejects.toThrow(/standard HTTP/i);
  });

  it("returns the pinned address in both Node lookup modes", async () => {
    const lookup = pinnedAddressLookup({
      address: "93.184.216.34",
      family: 4,
    });
    await expect(
      new Promise((resolve, reject) =>
        lookup("api.example.com", { all: true }, (error, addresses) =>
          error ? reject(error) : resolve(addresses),
        ),
      ),
    ).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
    await expect(
      new Promise((resolve, reject) =>
        lookup(
          "api.example.com",
          { all: false },
          (error, address, family) =>
            error ? reject(error) : resolve({ address, family }),
        ),
      ),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("keeps the failing OpenAPI target in safe retrieval diagnostics", async () => {
    await expect(
      readPublicDocument(
        "https://api.example.com/openapi.json",
        undefined,
        async () => [{ address: "127.0.0.1", family: 4 }],
      ),
    ).rejects.toThrow(
      /OpenAPI retrieval failed for https:\/\/api\.example\.com\/openapi\.json: Private network/u,
    );
  });
});
