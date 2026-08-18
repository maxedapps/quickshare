import * as Encoding from "effect/Encoding";
import * as Schema from "effect/Schema";

import { Limits } from "./limits.ts";

export const IdPattern = /^[A-Za-z0-9_-]{22}$/;

export const Id = Schema.String.check(Schema.isPattern(IdPattern));
export type Id = typeof Id.Type;

export const ProjectSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const ProjectSlug = Schema.String.check(Schema.isPattern(ProjectSlugPattern));
export type ProjectSlug = typeof ProjectSlug.Type;

export function encodeId(bytes: Uint8Array): string {
  return Encoding.encodeBase64Url(bytes);
}

export function generateId(randomBytes: (size: number) => Uint8Array): string {
  return encodeId(randomBytes(Limits.idBytes));
}

export function isId(value: string): value is Id {
  return IdPattern.test(value);
}

export function isProjectSlug(value: string): value is ProjectSlug {
  return ProjectSlugPattern.test(value);
}
