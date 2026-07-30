import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import type { IncomingMessage } from "node:http";
import { parse } from "yaml";

const MAX_REMOTE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export interface PublicAddress {
  address: string;
  family: 4 | 6;
}

export type PublicAddressResolver = (
  hostname: string,
) => Promise<PublicAddress[]>;

export interface PublicDocument {
  requestedUrl: string;
  finalUrl: string;
  redirectChain: string[];
  contentType?: string;
  content: string;
}

export type PublicDocumentLoader = (
  reference: string,
  maximumBytes?: number,
) => Promise<PublicDocument>;

export interface CanonicalOpenApiDocument {
  content: string;
  finalUrl: string;
  operation: "http-get-confirmed-contract" | "canonicalize-swagger-ui-contract";
  derivation?: {
    kind:
      | "same-origin-redirect"
      | "swagger-ui-config"
      | "swagger-ui-config-url"
      | "swagger-ui-initializer";
    targetUrl: string;
    evidenceHash: string;
    redirectChain: string[];
  };
}

function normalizedRemoteUrl(value: string | URL): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function ipv4NetworkAddress(address: string): boolean {
  const octets = address.split(".").map(Number);
  return (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    ) ||
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 100 &&
      (octets[1] ?? 0) >= 64 &&
      (octets[1] ?? 0) <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 &&
      (octets[1] ?? 0) >= 16 &&
      (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 &&
      (octets[1] === 0 ||
        octets[1] === 168 ||
        (octets[1] === 88 && octets[2] === 99))) ||
    (octets[0] === 198 &&
      (octets[1] === 18 ||
        octets[1] === 19 ||
        (octets[1] === 51 && octets[2] === 100))) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
    (octets[0] ?? 0) >= 224
  );
}

function ipv6Words(address: string): number[] | undefined {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const parseHalf = (half: string): number[] | undefined => {
    if (!half) return [];
    const pieces = half.split(":");
    const parsed: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        if (piece !== pieces[pieces.length - 1] || isIP(piece) !== 4) {
          return undefined;
        }
        const octets = piece.split(".").map(Number);
        parsed.push(
          (octets[0]! << 8) | octets[1]!,
          (octets[2]! << 8) | octets[3]!,
        );
        continue;
      }
      if (!/^[a-f0-9]{1,4}$/u.test(piece)) return undefined;
      parsed.push(Number.parseInt(piece, 16));
    }
    return parsed;
  };
  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return undefined;
  const missing = 8 - left.length - right.length;
  if (
    missing < 0 ||
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return undefined;
  }
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

export function privateNetworkAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/gu, "").toLowerCase();
  if (isIP(normalized) === 4) return ipv4NetworkAddress(normalized);
  const words = ipv6Words(normalized);
  if (!words) return true;
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    const mapped = words[6]! * 65_536 + words[7]!;
    return ipv4NetworkAddress(
      [
        (mapped >>> 24) & 255,
        (mapped >>> 16) & 255,
        (mapped >>> 8) & 255,
        mapped & 255,
      ].join("."),
    );
  }
  const firstWord = words[0]!;
  const high32 = firstWord * 65_536 + words[1]!;
  const high28 = firstWord * 4_096 + (words[1]! >>> 4);
  const isGlobalUnicast = (firstWord & 0xe000) === 0x2000;
  const isTransitionOrDocumentation =
    high32 === 0x2001_0000 ||
    high32 === 0x2001_0db8 ||
    high28 === 0x2001_001 ||
    high28 === 0x2001_002 ||
    firstWord === 0x2002;
  return !isGlobalUnicast || isTransitionOrDocumentation;
}

const systemAddressResolver: PublicAddressResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((item) => ({
    address: item.address,
    family: item.family as 4 | 6,
  }));

export async function assertPublicRemoteUrl(
  input: string | URL,
  resolveAddresses: PublicAddressResolver = systemAddressResolver,
): Promise<PublicAddress[]> {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("OpenAPI URLs must use HTTP(S) without embedded credentials.");
  }
  if (
    (url.protocol === "http:" && url.port && url.port !== "80") ||
    (url.protocol === "https:" && url.port && url.port !== "443")
  ) {
    throw new Error("OpenAPI URLs may use only the standard HTTP(S) ports.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (isIP(hostname) > 0 && privateNetworkAddress(hostname))
  ) {
    throw new Error("Local or private network OpenAPI URLs are not allowed.");
  }
  const addresses = await resolveAddresses(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => privateNetworkAddress(address))
  ) {
    throw new Error("Private network OpenAPI URLs are not allowed.");
  }
  return addresses;
}

export function assertSameOriginTransition(
  source: string | URL,
  target: string | URL,
  label = "redirect",
): void {
  const from = new URL(source);
  const to = new URL(target, from);
  if (from.origin !== to.origin) {
    throw new Error(
      `A cross-origin OpenAPI ${label} requires an explicit source decision.`,
    );
  }
}

function responseBody(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maximumBytes) {
        response.destroy(
          new Error(
            "The confirmed OpenAPI document exceeds the 1.5 MB limit.",
          ),
        );
        return;
      }
      chunks.push(buffer);
    });
    response.once("end", () => resolve(Buffer.concat(chunks, total).toString("utf8")));
    response.once("error", reject);
  });
}

async function requestPinned(
  url: URL,
  address: PublicAddress,
  maximumBytes: number,
): Promise<{
  status: number;
  location?: string;
  contentType?: string;
  content: string;
}> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? requestHttps : requestHttp)(
      url,
      {
        method: "GET",
        headers: {
          accept:
            "application/json, application/yaml, text/yaml, text/html, application/javascript, text/javascript",
          "accept-encoding": "identity",
          "user-agent": "ProjectAtlas/0.1 OpenAPI canonicalizer",
        },
        signal: AbortSignal.timeout(8_000),
        lookup: pinnedAddressLookup(address),
      },
      async (response) => {
        try {
          const status = response.statusCode ?? 0;
          const length = Number(response.headers["content-length"] ?? 0);
          if (length > maximumBytes) {
            response.destroy();
            reject(
              new Error(
                "The confirmed OpenAPI document exceeds the 1.5 MB limit.",
              ),
            );
            return;
          }
          const content = await responseBody(response, maximumBytes);
          const location = Array.isArray(response.headers.location)
            ? response.headers.location[0]
            : response.headers.location;
          const contentType = Array.isArray(response.headers["content-type"])
            ? response.headers["content-type"][0]
            : response.headers["content-type"];
          resolve({
            status,
            ...(location ? { location } : {}),
            ...(contentType ? { contentType } : {}),
            content,
          });
        } catch (error) {
          reject(error);
        }
      },
    );
    request.once("error", reject);
    request.end();
  });
}

export function pinnedAddressLookup(address: PublicAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options.all) {
      callback(null, [{ address: address.address, family: address.family }]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

export async function readPublicDocument(
  reference: string,
  maximumBytes = MAX_REMOTE_BYTES,
  resolveAddresses: PublicAddressResolver = systemAddressResolver,
): Promise<PublicDocument> {
  const requestedUrl = normalizedRemoteUrl(reference);
  let url = new URL(requestedUrl);
  const redirectChain = [requestedUrl];
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Awaited<ReturnType<typeof requestPinned>>;
    try {
      const addresses = await assertPublicRemoteUrl(url, resolveAddresses);
      response = await requestPinned(url, addresses[0]!, maximumBytes);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `OpenAPI retrieval failed for ${url.origin}${url.pathname}: ${detail}`,
        { cause: error },
      );
    }
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirect === MAX_REDIRECTS) {
        throw new Error("The confirmed OpenAPI URL redirected too many times.");
      }
      const next = new URL(response.location, url);
      assertSameOriginTransition(url, next);
      url = next;
      redirectChain.push(normalizedRemoteUrl(url));
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `The confirmed OpenAPI URL returned HTTP ${response.status}.`,
      );
    }
    return {
      requestedUrl,
      finalUrl: normalizedRemoteUrl(url),
      redirectChain,
      ...(response.contentType ? { contentType: response.contentType } : {}),
      content: response.content,
    };
  }
  throw new Error("The confirmed OpenAPI URL could not be loaded.");
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isOpenApiDocument(content: string): boolean {
  try {
    const document = object(parse(content, { maxAliasCount: 20 }));
    return Boolean(document?.openapi || document?.swagger);
  } catch {
    return false;
  }
}

function configuredUrl(
  content: string,
):
  | {
      kind:
        | "swagger-ui-config"
        | "swagger-ui-config-url"
        | "swagger-ui-initializer";
      reference: string;
    }
  | undefined {
  try {
    const parsed = object(JSON.parse(content));
    const direct =
      typeof parsed?.url === "string" ? parsed.url.trim() : undefined;
    if (direct) return { kind: "swagger-ui-config", reference: direct };
  } catch {
    // Swagger UI is usually HTML or JavaScript rather than standalone JSON.
  }
  if (!/(?:SwaggerUIBundle|swagger-ui|configUrl)/iu.test(content)) {
    return undefined;
  }
  const configUrl = content.match(
    /(?:^|[,{]\s*)(?:"?configUrl"?)\s*:\s*["']([^"'<>]{1,1000})["']/mu,
  )?.[1];
  if (configUrl) {
    return { kind: "swagger-ui-config-url", reference: configUrl };
  }
  const directUrls = [
    ...content.matchAll(
      /(?:^|[,{]\s*)(?:"?url"?)\s*:\s*["']([^"'<>]{1,1000})["']/gmu,
    ),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const uniqueDirectUrls = [...new Set(directUrls)];
  if (uniqueDirectUrls.length > 1) {
    throw new Error(
      "Swagger UI exposes multiple contracts. Confirm the governing specification URL explicitly.",
    );
  }
  if (uniqueDirectUrls[0]) {
    return {
      kind: "swagger-ui-config",
      reference: uniqueDirectUrls[0],
    };
  }
  const initializer = content.match(
    /<script[^>]+\bsrc\s*=\s*["']([^"']*(?:swagger-initializer|swagger-ui-init)[^"']*)["'][^>]*>/iu,
  )?.[1];
  return initializer
    ? { kind: "swagger-ui-initializer", reference: initializer }
    : undefined;
}

function evidenceHash(parts: string[]): string {
  return `sha256:${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

export async function canonicalizePublicOpenApiReference(
  reference: string,
  load: PublicDocumentLoader = readPublicDocument,
): Promise<CanonicalOpenApiDocument> {
  const confirmed = await load(reference, MAX_REMOTE_BYTES);
  for (const redirect of confirmed.redirectChain) {
    assertSameOriginTransition(confirmed.requestedUrl, redirect);
  }
  if (isOpenApiDocument(confirmed.content)) {
    const redirected = confirmed.finalUrl !== confirmed.requestedUrl;
    return {
      content: confirmed.content,
      finalUrl: confirmed.finalUrl,
      operation: "http-get-confirmed-contract",
      ...(redirected
        ? {
            derivation: {
              kind: "same-origin-redirect" as const,
              targetUrl: confirmed.finalUrl,
              evidenceHash: evidenceHash(confirmed.redirectChain),
              redirectChain: confirmed.redirectChain,
            },
          }
        : {}),
    };
  }

  let discovery = configuredUrl(confirmed.content);
  if (!discovery) {
    throw new Error(
      "The confirmed Swagger UI did not expose one static specification or config URL.",
    );
  }
  const evidence = [confirmed.content];
  const derivationKind = discovery.kind;
  let target = new URL(discovery.reference, confirmed.finalUrl);
  assertSameOriginTransition(confirmed.finalUrl, target, "derived source");

  if (
    discovery.kind === "swagger-ui-initializer" ||
    discovery.kind === "swagger-ui-config-url"
  ) {
    const configuration = await load(normalizedRemoteUrl(target), 512_000);
    for (const redirect of configuration.redirectChain) {
      assertSameOriginTransition(target, redirect);
    }
    evidence.push(configuration.content);
    if (isOpenApiDocument(configuration.content)) {
      return {
        content: configuration.content,
        finalUrl: configuration.finalUrl,
        operation: "canonicalize-swagger-ui-contract",
        derivation: {
          kind: derivationKind,
          targetUrl: configuration.finalUrl,
          evidenceHash: evidenceHash(evidence),
          redirectChain: [
            ...confirmed.redirectChain,
            ...configuration.redirectChain,
          ].slice(0, 4),
        },
      };
    }
    discovery = configuredUrl(configuration.content);
    if (!discovery) {
      throw new Error(
        "Swagger UI configuration did not expose one specification URL.",
      );
    }
    target = new URL(discovery.reference, configuration.finalUrl);
    assertSameOriginTransition(confirmed.finalUrl, target, "derived source");
  }

  const specification = await load(normalizedRemoteUrl(target), MAX_REMOTE_BYTES);
  for (const redirect of specification.redirectChain) {
    assertSameOriginTransition(target, redirect);
  }
  if (!isOpenApiDocument(specification.content)) {
    throw new Error(
      "The URL derived from Swagger UI is not an OpenAPI or Swagger specification.",
    );
  }
  return {
    content: specification.content,
    finalUrl: specification.finalUrl,
    operation: "canonicalize-swagger-ui-contract",
    derivation: {
      kind: derivationKind,
      targetUrl: specification.finalUrl,
      evidenceHash: evidenceHash(evidence),
      redirectChain: [
        ...confirmed.redirectChain,
        ...specification.redirectChain,
      ].slice(0, 4),
    },
  };
}
