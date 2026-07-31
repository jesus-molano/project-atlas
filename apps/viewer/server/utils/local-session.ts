import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createError,
  getHeader,
  getRequestURL,
  type H3Event,
} from "h3";

const generatedSessionToken = randomBytes(32).toString("base64url");

export function localSessionToken(): string {
  return process.env.ATLAS_GUI_SESSION_TOKEN || generatedSessionToken;
}

export function assertLocalSession(event: H3Event): void {
  const supplied = getHeader(event, "x-atlas-session");
  const expected = localSessionToken();
  if (!supplied) {
    throw createError({
      statusCode: 401,
      statusMessage: "Project Atlas local session token is required.",
    });
  }
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "Project Atlas rejected the local session token.",
    });
  }
}

export function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, "origin");
  if (!origin) return;
  let supplied: URL;
  try {
    supplied = new URL(origin);
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: "Project Atlas rejected an invalid request origin.",
    });
  }
  const request = getRequestURL(event);
  if (supplied.origin !== request.origin) {
    throw createError({
      statusCode: 403,
      statusMessage: "Project Atlas only accepts local same-origin changes.",
    });
  }
}
