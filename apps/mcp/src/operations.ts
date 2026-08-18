import type { AccessPolicy, ShareDetail, ShareListResponse } from "@quickshare/contracts";

export interface InlineFile {
  readonly path: string;
  readonly content: string;
  readonly encoding?: "utf8" | "base64";
  readonly mediaType?: string;
}

export interface ShareInput {
  readonly shareId?: string;
  readonly project?: string;
  readonly files?: ReadonlyArray<InlineFile>;
  readonly ttlSeconds?: number | null;
  readonly access?: AccessPolicy;
}

export interface ShareOperations {
  readonly share: (input: ShareInput) => Promise<ShareDetail>;
  readonly list: (input: {
    readonly project?: string;
    readonly limit?: number;
    readonly cursor?: string;
  }) => Promise<ShareListResponse>;
  readonly inspect: (shareId: string) => Promise<ShareDetail>;
  readonly revoke: (shareId: string) => Promise<{ readonly ok: true }>;
}
