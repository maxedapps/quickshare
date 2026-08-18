import type { AccessPolicy } from "@quickshare/contracts";
import { Limits } from "@quickshare/contracts";

const TtlPattern = /^([1-9][0-9]*)([smhdw])$/;

export function parseTtl(value: string, allowNone: boolean): number | null {
  if (allowNone && value === "none") return null;
  const match = TtlPattern.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined)
    throw new Error("invalid TTL");
  const amount = Number(match[1]);
  const unit = match[2];
  const seconds =
    unit === "s"
      ? amount
      : unit === "m"
        ? amount * 60
        : unit === "h"
          ? amount * 3600
          : unit === "d"
            ? amount * 86400
            : amount * 604800;
  if (seconds < Limits.ttlMinSeconds || seconds > Limits.ttlMaxSeconds)
    throw new Error("TTL out of range");
  return seconds;
}

export function parseEmails(value: string): ReadonlyArray<string> {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function accessFromFlags(
  password: string | undefined,
  emails: ReadonlyArray<string> | undefined,
  passwords: ReadonlyArray<string> | undefined,
  publicReset: boolean,
): AccessPolicy | undefined {
  if (publicReset) {
    if (password !== undefined || emails !== undefined || passwords !== undefined)
      throw new Error("conflicting access flags");
    return { kind: "public" };
  }
  if (password !== undefined && emails !== undefined && passwords !== undefined)
    throw new Error("conflicting access flags");
  if (password !== undefined && emails !== undefined) {
    return { kind: "email_shared", emails: [...emails], password };
  }
  if (emails !== undefined && passwords !== undefined) {
    if (emails.length !== passwords.length) throw new Error("emails and passwords must match");
    return { kind: "per_email", emails: [...emails], passwords: [...passwords] };
  }
  if (password !== undefined) return { kind: "shared_password", password };
  if (emails !== undefined || passwords !== undefined) throw new Error("incomplete access flags");
  return undefined;
}

export function stripStdinSecret(value: string): string {
  return value.replace(/\r?\n$/u, "");
}
