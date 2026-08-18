import { describe, expect, it } from "vitest";

import { parseContentRequest } from "./routing.ts";
import { isSafeReturn } from "./serve.ts";

const id = "0123456789abcdefghijkl";

describe("content routing", () => {
  it("rejects traversal and encoded separators", () => {
    expect(parseContentRequest("x.workers.dev", `/default/${id}/../secret`, "")).toBeUndefined();
    expect(parseContentRequest("x.workers.dev", `/default/${id}/a%2F..%2F`, "")).toBeUndefined();
    expect(
      parseContentRequest("x.workers.dev", `/default/${id}/.quickshare/other`, ""),
    ).toBeUndefined();
  });

  it("resolves index and login paths", () => {
    expect(parseContentRequest("x.workers.dev", `/docs/${id}/`, "")).toMatchObject({
      project: "docs",
      assetPath: "index.html",
    });
    expect(parseContentRequest("x.workers.dev", `/docs/${id}/.quickshare/login`, "")).toMatchObject(
      {
        assetPath: ".quickshare/login",
      },
    );
  });
});

describe("login return targets", () => {
  const root = `/docs/${id}/`;

  it("accepts the share root and a same-share relative file", () => {
    expect(isSafeReturn(root, root)).toBe(true);
    expect(isSafeReturn(`${root}notes.html`, root)).toBe(true);
  });

  it("rejects traversal, encoded separators, and cross-share paths", () => {
    expect(isSafeReturn(`${root}../../other`, root)).toBe(false);
    expect(isSafeReturn(`${root}%2e%2e/other`, root)).toBe(false);
    expect(isSafeReturn(`${root}a%2F../b`, root)).toBe(false);
    expect(isSafeReturn(`/other/${id}/`, root)).toBe(false);
    expect(isSafeReturn("https://evil.example/", root)).toBe(false);
  });
});
