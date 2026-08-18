import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";

import { defaultConfigPath, normalizeApiUrl, resolveSetting, writeConfig } from "./config.ts";
import { accessFromFlags, parseTtl } from "./options.ts";

describe("cli config", () => {
  it("resolves XDG and override paths", () => {
    expect(defaultConfigPath({ QUICKSHARE_CONFIG: "/tmp/qs.toml" }, "/home/u")).toBe(
      "/tmp/qs.toml",
    );
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/u")).toBe(
      "/xdg/quickshare/config.toml",
    );
    expect(defaultConfigPath({}, "/home/u")).toBe("/home/u/.config/quickshare/config.toml");
  });

  it("prefers flags over env over file", () => {
    expect(resolveSetting("flag", "env", "file")).toBe("flag");
    expect(resolveSetting(undefined, "env", "file")).toBe("env");
    expect(resolveSetting(undefined, "", "file")).toBe("file");
  });

  it("writes only supplied fields and never prints the key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qs-"));
    const path = join(dir, "config.toml");
    await writeConfig(path, { url: "https://api.example.com", key: "secret-key" });
    const text = await readFile(path, "utf8");
    expect(text).toContain("secret-key");
    expect(normalizeApiUrl("https://api.example.com/")).toBe("https://api.example.com");
  });
});

describe("cli options", () => {
  it("maps access flags and TTL", () => {
    expect(accessFromFlags("p", undefined, undefined, false)).toEqual({
      kind: "shared_password",
      password: "p",
    });
    expect(accessFromFlags(undefined, undefined, undefined, true)).toEqual({ kind: "public" });
    expect(parseTtl("24h", false)).toBe(86400);
    expect(parseTtl("none", true)).toBeNull();
    expect(() => parseTtl("none", false)).toThrow();
  });
});
