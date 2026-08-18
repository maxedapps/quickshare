import { Limits } from "@quickshare/contracts";

export interface SessionClaims {
  readonly v: 1;
  readonly shareId: string;
  readonly accessPolicyId: string;
  readonly exp: number;
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(claims))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  const signature = await hmac(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(
  token: string,
  secret: string,
  shareId: string,
  accessPolicyId: string,
  now: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) return false;
  const expected = await hmac(secret, parts[0]);
  const provided = new TextEncoder().encode(parts[1]);
  const wanted = new TextEncoder().encode(expected);
  if (!equal(provided, wanted)) return false;
  let claims: SessionClaims;
  try {
    const json = atob(parts[0].replaceAll("-", "+").replaceAll("_", "/"));
    claims = JSON.parse(json);
  } catch {
    return false;
  }
  return (
    claims.v === 1 &&
    claims.shareId === shareId &&
    claims.accessPolicyId === accessPolicyId &&
    claims.exp > now
  );
}

export function cookieName(shareId: string): string {
  return `qs_${shareId}`;
}

export function cookieExpiry(now: number, shareExpiresAt: number | null): number {
  const cap = now + Limits.cookieMaxMs;
  if (shareExpiresAt === null) return cap;
  return Math.min(cap, shareExpiresAt);
}

export function setCookieHeader(
  shareId: string,
  token: string,
  path: string,
  expiresAt: number,
): string {
  return `${cookieName(shareId)}=${token}; Path=${path}; Expires=${new Date(expiresAt).toUTCString()}; Secure; HttpOnly; SameSite=Lax`;
}

export function readCookie(header: string | null, shareId: string): string | undefined {
  if (header === null) return undefined;
  const prefix = `${cookieName(shareId)}=`;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return undefined;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
