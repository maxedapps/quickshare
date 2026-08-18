import {
  CreateShareRequest,
  parseIfMatch,
  quotedEtag,
  ShareDetail,
  ShareListResponse,
  StartResponse,
  UpdateShareRequest,
} from "@quickshare/contracts";
import * as Schema from "effect/Schema";

export interface PreparedFile {
  readonly path: string;
  readonly size: number;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export class ApiClient {
  readonly url: string;
  readonly key: string;
  readonly fetchImpl: typeof fetch;

  constructor(url: string, key: string, fetchImpl: typeof fetch = fetch) {
    this.url = url;
    this.key = key;
    this.fetchImpl = fetchImpl;
  }

  async startCreate(body: typeof CreateShareRequest.Type): Promise<typeof StartResponse.Type> {
    return this.json("/v1/shares", "POST", body, StartResponse, 202);
  }

  async startUpdate(
    shareId: string,
    etag: string,
    body: typeof UpdateShareRequest.Type,
  ): Promise<typeof StartResponse.Type> {
    return this.json(`/v1/shares/${shareId}/revisions`, "POST", body, StartResponse, 202, {
      "If-Match": etag,
    });
  }

  async inspect(shareId: string): Promise<typeof ShareDetail.Type> {
    return this.json(`/v1/shares/${shareId}`, "GET", undefined, ShareDetail, 200);
  }

  async list(query = ""): Promise<typeof ShareListResponse.Type> {
    return this.json(`/v1/shares${query}`, "GET", undefined, ShareListResponse, 200);
  }

  async revoke(shareId: string): Promise<void> {
    const response = await this.fetchImpl(`${this.url}/v1/shares/${shareId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (response.status !== 204) await this.fail(response);
  }

  async putFile(revisionId: string, file: PreparedFile, ordinal: number): Promise<void> {
    const response = await this.fetchImpl(`${this.url}/v1/uploads/${revisionId}/files/${ordinal}`, {
      method: "PUT",
      headers: {
        ...this.headers(),
        "Content-Length": String(file.size),
        "Content-Digest": digestHeader(file.sha256),
        "Content-Type": file.mediaType,
      },
      body: file.bytes,
    });
    if (response.status !== 204) await this.fail(response);
  }

  async commit(revisionId: string): Promise<typeof ShareDetail.Type> {
    const response = await this.fetchImpl(`${this.url}/v1/uploads/${revisionId}/commit`, {
      method: "POST",
      headers: this.headers(),
    });
    if (response.status !== 200 && response.status !== 201) await this.fail(response);
    return Schema.decodeUnknownSync(ShareDetail)(await response.json());
  }

  async abort(revisionId: string): Promise<void> {
    await this.fetchImpl(`${this.url}/v1/uploads/${revisionId}`, {
      method: "DELETE",
      headers: this.headers(),
    });
  }

  async currentEtag(shareId: string): Promise<string> {
    const detail = await this.inspect(shareId);
    return quotedEtag(detail.revisionId);
  }

  private headers(extra: { readonly "If-Match"?: string } = {}) {
    return { authorization: `Bearer ${this.key}`, accept: "application/json", ...extra };
  }

  private async json<A>(
    path: string,
    method: string,
    body: typeof CreateShareRequest.Type | typeof UpdateShareRequest.Type | undefined,
    schema: Schema.Codec<A>,
    expected: number,
    extra: { readonly "If-Match"?: string } = {},
  ): Promise<A> {
    const init: RequestInit = {
      method,
      headers: {
        ...this.headers(extra),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.fetchImpl(`${this.url}${path}`, init);
    if (response.status !== expected) await this.fail(response);
    return Schema.decodeUnknownSync(schema)(await response.json());
  }

  private async fail(response: Response): Promise<never> {
    const text = await response.text();
    throw new Error(text);
  }
}

function digestHeader(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha-256=:${btoa(binary)}:`;
}

export { parseIfMatch };
