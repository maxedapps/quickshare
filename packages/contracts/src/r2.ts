export function contentObjectKey(
  shareId: string,
  contentVersionId: string,
  canonicalPath: string,
): string {
  return `shares/${shareId}/content/${contentVersionId}/${canonicalPath}`;
}
