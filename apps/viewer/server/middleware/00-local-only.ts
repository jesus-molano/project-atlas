import {
  isAllowedMutationOrigin,
  isLocalRequestHost,
} from "../utils/local-request";

export default defineEventHandler((event) => {
  const host = getHeader(event, "host");
  if (!isLocalRequestHost(host)) {
    throw createError({
      statusCode: 403,
      statusMessage: "Project Atlas GUI accepts loopback requests only.",
    });
  }
  const method = event.method.toUpperCase();
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !isAllowedMutationOrigin(getHeader(event, "origin"))
  ) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Project Atlas rejected a cross-origin state-changing request.",
    });
  }
});
