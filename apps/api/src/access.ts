import type { AccessPolicy } from "@quickshare/contracts";
import { Limits } from "@quickshare/contracts";

export const PasswordAlgorithm = "pbkdf2-sha256";
export const PasswordRecordVersion = 1;

export interface CredentialRecord {
  readonly principal: string;
  readonly algorithm: string;
  readonly version: number;
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly digest: Uint8Array;
}

export function accessEmailCount(policy: AccessPolicy): number {
  if (policy.kind === "public" || policy.kind === "shared_password") return 0;
  return policy.emails.length;
}

export async function hashPassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: Limits.pbkdf2Iterations },
    key,
    Limits.pbkdf2DigestBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPolicy(
  policy: AccessPolicy,
  randomBytes: (size: number) => Uint8Array,
): Promise<ReadonlyArray<CredentialRecord>> {
  if (policy.kind === "public") return [];
  if (policy.kind === "shared_password") {
    return [await credential(Limits.sharedPrincipal, policy.password, randomBytes)];
  }
  if (policy.kind === "email_shared") {
    const shared = await credential(Limits.sharedPrincipal, policy.password, randomBytes);
    const listed = policy.emails.map((email) => ({
      principal: email,
      algorithm: "allowlist",
      version: PasswordRecordVersion,
      iterations: 1,
      salt: new Uint8Array(0),
      digest: new Uint8Array(0),
    }));
    return [shared, ...listed];
  }
  return Promise.all(
    policy.emails.map((email, index) =>
      credential(email, policy.passwords[index] ?? "", randomBytes),
    ),
  );
}

async function credential(
  principal: string,
  password: string,
  randomBytes: (size: number) => Uint8Array,
): Promise<CredentialRecord> {
  const salt = randomBytes(Limits.pbkdf2SaltBytes);
  return {
    principal,
    algorithm: PasswordAlgorithm,
    version: PasswordRecordVersion,
    iterations: Limits.pbkdf2Iterations,
    salt,
    digest: await hashPassword(password, salt),
  };
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
