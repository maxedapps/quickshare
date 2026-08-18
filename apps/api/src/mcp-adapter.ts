import {
  bytesToHex,
  formatContentDigest,
  hexToBytes,
  Limits,
  RootIndexPath,
} from "@quickshare/contracts";
import type { InlineFile, ShareInput, ShareOperations } from "@quickshare/mcp/operations";

import type { ApiEnv } from "./env.ts";
import {
  abort,
  commit,
  inspect,
  listShares,
  putFile,
  revoke,
  startCreate,
  startUpdate,
} from "./share.ts";
import { ContentManifest, decodeListCursor } from "@quickshare/contracts";
import * as Schema from "effect/Schema";

export function mcpOperations(env: ApiEnv): ShareOperations {
  return {
    share: (input) => share(env, input),
    list: async (input) => {
      const cursor = input.cursor === undefined ? undefined : decodeListCursor(input.cursor);
      return listShares(env, input.project, input.limit ?? Limits.listDefaultLimit, cursor);
    },
    inspect: (shareId) => inspect(env, shareId),
    revoke: async (shareId) => {
      await revoke(env, shareId);
      return { ok: true as const };
    },
  };
}

async function share(env: ApiEnv, input: ShareInput) {
  const files = input.files === undefined ? undefined : await decodeFiles(input.files);
  if (input.shareId === undefined) {
    if (files === undefined) throw new Error("files are required to create a share");
    const start = await startCreate(env, {
      files: files.manifest,
      ...(input.project === undefined ? {} : { project: input.project }),
      ...(input.ttlSeconds === undefined || input.ttlSeconds === null
        ? {}
        : { ttlSeconds: input.ttlSeconds }),
      ...(input.access === undefined ? {} : { access: input.access }),
    });
    try {
      await uploadAll(env, start.revisionId, files.bodies);
      return (await commit(env, start.revisionId)).body;
    } catch (cause) {
      await abort(env, start.revisionId);
      throw cause;
    }
  }
  const current = await inspect(env, input.shareId);
  const start = await startUpdate(env, input.shareId, current.revisionId, {
    ...(files === undefined ? {} : { files: files.manifest }),
    ...(input.ttlSeconds === undefined ? {} : { ttlSeconds: input.ttlSeconds }),
    ...(input.access === undefined ? {} : { access: input.access }),
  });
  try {
    if (files !== undefined) await uploadAll(env, start.revisionId, files.bodies);
    return (await commit(env, start.revisionId)).body;
  } catch (cause) {
    await abort(env, start.revisionId);
    throw cause;
  }
}

async function decodeFiles(files: ReadonlyArray<InlineFile>) {
  if (files.length === 0 || files.length > Limits.mcpMaxFiles)
    throw new Error("invalid file count");
  const bodies: Array<{
    path: string;
    bytes: Uint8Array;
    mediaType: string;
    sha256: string;
    size: number;
  }> = [];
  let total = 0;
  const paths = new Set<string>();
  for (const file of files) {
    const bytes =
      file.encoding === "base64"
        ? decodeBase64(file.content)
        : new TextEncoder().encode(file.content);
    if (bytes.byteLength > Limits.mcpMaxFileBytes) throw new Error("file too large");
    total += bytes.byteLength;
    if (paths.has(file.path)) throw new Error("duplicate path");
    paths.add(file.path);
    const sha256 = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    bodies.push({
      path: file.path,
      bytes,
      mediaType: file.mediaType ?? "application/octet-stream",
      sha256,
      size: bytes.byteLength,
    });
  }
  if (total > Limits.mcpMaxTotalBytes) throw new Error("payload too large");
  if (!paths.has(RootIndexPath)) throw new Error("index.html is required");
  const manifest = Schema.decodeUnknownSync(ContentManifest)(
    bodies.map((file, ordinal) => ({
      ordinal,
      path: file.path,
      size: file.size,
      mediaType: file.mediaType,
      sha256: file.sha256,
    })),
  );
  return { bodies, manifest };
}

async function uploadAll(
  env: ApiEnv,
  revisionId: string,
  files: ReadonlyArray<{
    path: string;
    bytes: Uint8Array;
    mediaType: string;
    sha256: string;
    size: number;
  }>,
): Promise<void> {
  for (const [ordinal, file] of files.entries()) {
    if (file === undefined) continue;
    await putFile(
      env,
      revisionId,
      ordinal,
      new Request("https://api.invalid", {
        method: "PUT",
        headers: {
          "Content-Length": String(file.size),
          "Content-Digest": formatContentDigest(hexToBytes(file.sha256)),
          "Content-Type": file.mediaType,
        },
        body: file.bytes,
      }),
    );
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
