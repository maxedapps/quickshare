export function visitorUrl(
  contentBaseUrl: string,
  contentDomain: string,
  project: string,
  shareId: string,
): string {
  if (contentDomain.length > 0) {
    return `https://${project}.${contentDomain}/${shareId}/`;
  }
  return `${contentBaseUrl.replace(/\/$/u, "")}/${project}/${shareId}/`;
}

export function shareRootPath(project: string, shareId: string, customDomain: boolean): string {
  return customDomain ? `/${shareId}/` : `/${project}/${shareId}/`;
}
