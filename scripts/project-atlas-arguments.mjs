const CLI_COMMANDS = new Set([
  "setup",
  "scan",
  "capabilities",
  "evaluation",
  "search",
  "context",
  "show",
  "similar",
  "impact",
  "decision",
  "memory",
  "figma",
  "storage",
  "mcp",
]);

export function normalizeProjectAtlasArguments(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized[0] === "open") return normalized;
  if (normalized.length === 0 || normalized[0]?.startsWith("-")) {
    return ["open", ...normalized];
  }
  return CLI_COMMANDS.has(normalized[0])
    ? normalized
    : ["open", ...normalized];
}
