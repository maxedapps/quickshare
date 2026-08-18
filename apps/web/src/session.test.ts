import { describe, expect, it } from "vitest";

import { cookieExpiry, signSession, verifySession } from "./session.ts";

const shareId = "AAAAAAAAAAAAAAAAAAAAAA";

describe("visitor session", () => {
  it("rejects tampered cookies and expired claims", async () => {
    const token = await signSession(
      { v: 1, shareId, accessPolicyId: "policy", exp: Date.now() + 60_000 },
      "secret",
    );
    expect(await verifySession(token, "secret", shareId, "policy", Date.now())).toBe(true);
    expect(await verifySession(`${token}x`, "secret", shareId, "policy", Date.now())).toBe(false);
    expect(await verifySession(token, "other", shareId, "policy", Date.now())).toBe(false);
    expect(
      await verifySession(token, "secret", "BBBBBBBBBBBBBBBBBBBBBB", "policy", Date.now()),
    ).toBe(false);
    const expired = await signSession(
      { v: 1, shareId, accessPolicyId: "policy", exp: 1 },
      "secret",
    );
    expect(await verifySession(expired, "secret", shareId, "policy", 2)).toBe(false);
    expect(cookieExpiry(0, 1000)).toBe(1000);
  });
});
