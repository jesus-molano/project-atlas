const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function hostname(value: string, base?: string): string | undefined {
  try {
    return new URL(value, base).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return undefined;
  }
}

export function isLocalRequestHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(hostname(`http://${host}`) ?? "");
}

export function isAllowedMutationOrigin(
  origin: string | undefined,
): boolean {
  if (!origin) return true;
  const originHost = hostname(origin);
  return Boolean(originHost && LOCAL_HOSTS.has(originHost));
}
