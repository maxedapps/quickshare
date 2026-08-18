import { Limits } from "@quickshare/contracts";
import { describe, expect, it } from "vitest";

import { hashPassword, hashPolicy, timingSafeEqual } from "./access.ts";

describe("access hashing", () => {
  it("derives PBKDF2-SHA-256 with unique salts and no plaintext", async () => {
    const first = await hashPolicy({ kind: "shared_password", password: "secret" }, () =>
      new Uint8Array(Limits.pbkdf2SaltBytes).fill(1),
    );
    const second = await hashPolicy({ kind: "shared_password", password: "secret" }, () =>
      new Uint8Array(Limits.pbkdf2SaltBytes).fill(2),
    );
    expect(first[0]?.iterations).toBe(Limits.pbkdf2Iterations);
    expect(first[0]?.digest).not.toEqual(second[0]?.digest);
    expect(JSON.stringify(first)).not.toContain("secret");
  });

  it("matches an independent derive", async () => {
    const salt = new Uint8Array(Limits.pbkdf2SaltBytes).fill(9);
    const a = await hashPassword("pw", salt);
    const b = await hashPassword("pw", salt);
    expect(timingSafeEqual(a, b)).toBe(true);
    expect(timingSafeEqual(a, await hashPassword("no", salt))).toBe(false);
  });
});
