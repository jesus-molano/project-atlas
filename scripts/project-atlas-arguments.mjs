export function normalizeProjectAtlasArguments(args, commandNames) {
  const cliCommands = new Set(commandNames);
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized[0] === "open") return normalized;
  if (normalized.length === 0 || normalized[0]?.startsWith("-")) {
    return ["open", ...normalized];
  }
  return cliCommands.has(normalized[0])
    ? normalized
    : ["open", ...normalized];
}
