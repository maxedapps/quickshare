import { canonicalizePath, isId, isProjectSlug, RootIndexPath } from "@quickshare/contracts";

export interface ContentRoute {
  readonly project: string;
  readonly shareId: string;
  readonly assetPath: string;
  readonly shareRoot: string;
  readonly wantsIndex: boolean;
}

export function parseContentRequest(
  host: string,
  pathname: string,
  contentDomain: string,
): ContentRoute | undefined {
  const hostname = stripPort(host);
  if (contentDomain.length > 0) {
    const suffix = `.${contentDomain}`;
    if (hostname === contentDomain) return undefined;
    if (hostname.endsWith(suffix)) {
      const project = hostname.slice(0, hostname.length - suffix.length);
      if (!isProjectSlug(project) || project.includes(".")) return undefined;
      return parseAfterProject(pathname, project);
    }
    if (
      !hostname.endsWith(".workers.dev") &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost")
    ) {
      return undefined;
    }
  }
  return parseWorkersDev(pathname);
}

function parseWorkersDev(pathname: string): ContentRoute | undefined {
  const segments = decodeSegments(pathname);
  if (segments === undefined) return undefined;
  const project = segments[0];
  const shareId = segments[1];
  if (project === undefined || shareId === undefined || !isProjectSlug(project) || !isId(shareId)) {
    return undefined;
  }
  return finish(
    project,
    shareId,
    segments.slice(2),
    pathname.endsWith("/"),
    `/${project}/${shareId}/`,
  );
}

function parseAfterProject(pathname: string, project: string): ContentRoute | undefined {
  const segments = decodeSegments(pathname);
  if (segments === undefined) return undefined;
  const shareId = segments[0];
  if (shareId === undefined || !isId(shareId)) return undefined;
  return finish(project, shareId, segments.slice(1), pathname.endsWith("/"), `/${shareId}/`);
}

function finish(
  project: string,
  shareId: string,
  rest: ReadonlyArray<string>,
  trailingSlash: boolean,
  shareRoot: string,
): ContentRoute | undefined {
  if (rest[0] === ".quickshare") {
    if (rest.length === 2 && rest[1] === "login") {
      return { project, shareId, assetPath: ".quickshare/login", shareRoot, wantsIndex: false };
    }
    return undefined;
  }
  if (rest.length === 0 || trailingSlash) {
    const joined =
      rest.length === 0
        ? { ok: true as const, path: RootIndexPath }
        : canonicalizePath([...rest, RootIndexPath].join("/"));
    if (!joined.ok) return undefined;
    return { project, shareId, assetPath: joined.path, shareRoot, wantsIndex: true };
  }
  const canonical = canonicalizePath(rest.join("/"));
  if (!canonical.ok) return undefined;
  return { project, shareId, assetPath: canonical.path, shareRoot, wantsIndex: false };
}

function decodeSegments(pathname: string): string[] | undefined {
  const raw = pathname.split("/").filter((segment) => segment.length > 0);
  const decoded: string[] = [];
  for (const segment of raw) {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    if (value.includes("/") || value.includes("\\")) return undefined;
    decoded.push(value);
  }
  return decoded;
}

function stripPort(host: string): string {
  const index = host.lastIndexOf(":");
  if (index === -1) return host.toLowerCase();
  return host.slice(0, index).toLowerCase();
}

export function isLoginPath(assetPath: string): boolean {
  return assetPath === ".quickshare/login";
}
