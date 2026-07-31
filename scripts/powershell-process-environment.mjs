import process from "node:process";

export function powerShellProcessEnvironment(
  executable,
  { platform = process.platform, environment = process.env } = {},
) {
  const childEnvironment = { ...environment };
  if (platform !== "win32" || executable.toLowerCase() !== "powershell") {
    return childEnvironment;
  }

  for (const key of Object.keys(childEnvironment)) {
    if (key.toLowerCase() === "psmodulepath") {
      delete childEnvironment[key];
    }
  }
  return childEnvironment;
}
