import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as Schema from "effect/Schema";
import * as Toml from "smol-toml";

export const ConfigFile = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  key: Schema.optionalKey(Schema.String),
});
export type ConfigFile = typeof ConfigFile.Type;

export function defaultConfigPath(env: NodeJS.ProcessEnv, home: string): string {
  if (env.QUICKSHARE_CONFIG !== undefined && env.QUICKSHARE_CONFIG.length > 0) {
    return env.QUICKSHARE_CONFIG;
  }
  if (env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0) {
    return join(env.XDG_CONFIG_HOME, "quickshare", "config.toml");
  }
  return join(home, ".config", "quickshare", "config.toml");
}

export async function loadConfig(path: string): Promise<ConfigFile> {
  try {
    const text = await readFile(path, "utf8");
    return Schema.decodeUnknownSync(ConfigFile)(Toml.parse(text));
  } catch {
    return {};
  }
}

export async function writeConfig(path: string, patch: ConfigFile): Promise<void> {
  const current = await loadConfig(path);
  const next = { ...current, ...patch };
  if (next.url === undefined && next.key === undefined) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, Toml.stringify(next), { mode: 0o600 });
  await rename(tmp, path);
}

export function resolveSetting(
  flag: string | undefined,
  envValue: string | undefined,
  fileValue: string | undefined,
): string | undefined {
  if (flag !== undefined) return flag;
  if (envValue !== undefined && envValue.length > 0) return envValue;
  return fileValue;
}

export function normalizeApiUrl(url: string): string {
  const trimmed = url.replace(/\/+$/u, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("invalid API URL");
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol === "http:" && !loopback) throw new Error("API URL must be HTTPS");
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new Error("invalid API URL");
  return trimmed;
}

export function configPathFrom(env: NodeJS.ProcessEnv, configFile: string | undefined): string {
  if (configFile !== undefined) return configFile;
  return defaultConfigPath(env, env.HOME ?? homedir());
}
