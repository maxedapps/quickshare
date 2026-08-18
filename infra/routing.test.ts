import { describe, expect, it } from "@effect/vitest";

import { parseContentRequest } from "../apps/web/src/routing.ts";
import { visitorUrl } from "../apps/api/src/urls.ts";

const shareId = "AAAAAAAAAAAAAAAAAAAAAA";

describe("routing", () => {
  it("parses workers.dev project paths and custom first-level hosts", () => {
    const path = parseContentRequest("content.workers.dev", `/default/${shareId}/`, "");
    expect(path).toMatchObject({ project: "default", shareId, assetPath: "index.html" });
    const custom = parseContentRequest(`docs.example.com`, `/${shareId}/style.css`, "example.com");
    expect(custom).toMatchObject({ project: "docs", shareId, assetPath: "style.css" });
    expect(parseContentRequest("example.com", `/${shareId}/`, "example.com")).toBeUndefined();
    expect(parseContentRequest(`a.b.example.com`, `/${shareId}/`, "example.com")).toBeUndefined();
  });

  it("derives urls from current routing and never requires a stored url", () => {
    expect(visitorUrl("https://content.workers.dev", "", "default", shareId)).toBe(
      `https://content.workers.dev/default/${shareId}/`,
    );
    expect(visitorUrl("https://content.workers.dev", "example.com", "docs", shareId)).toBe(
      `https://docs.example.com/${shareId}/`,
    );
  });
});
