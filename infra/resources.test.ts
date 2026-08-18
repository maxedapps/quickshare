import { describe, expect, it } from "@effect/vitest";

import { RESOURCE_IDS } from "./resources.ts";

describe("resource graph", () => {
  it("keeps stable ids for the two workers, one D1, one R2, and two randoms", () => {
    expect(RESOURCE_IDS).toEqual({
      database: "Database",
      files: "Files",
      api: "Api",
      content: "Content",
      apiKey: "ApiKey",
      cookieSigningKey: "CookieSigningKey",
    });
  });
});
