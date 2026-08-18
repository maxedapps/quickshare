import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { Limits } from "./limits.ts";

export const Password = Schema.String.check(
  Schema.isMinLength(Limits.passwordMinBytes),
  Schema.isMaxLength(Limits.passwordMaxBytes),
);
export type Password = typeof Password.Type;

const NormalizedEmail = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      const at = value.indexOf("@");
      if (at <= 0 || at !== value.lastIndexOf("@") || at === value.length - 1) return false;
      return new TextEncoder().encode(value).byteLength <= Limits.emailMaxBytes;
    },
    { message: "invalid email" },
  ),
);

export const Email = Schema.String.pipe(
  Schema.decodeTo(NormalizedEmail, {
    decode: SchemaGetter.transform((value: string) => value.trim().toLowerCase()),
    encode: SchemaGetter.passthrough(),
  }),
);
export type Email = typeof Email.Type;

export const EmailList = Schema.Array(Email).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(Limits.maxEmails),
  Schema.makeFilter((emails: ReadonlyArray<string>) => new Set(emails).size === emails.length, {
    message: "emails must be unique",
  }),
);

export const AccessPublic = Schema.Struct({
  kind: Schema.Literal("public"),
});

export const AccessSharedPassword = Schema.Struct({
  kind: Schema.Literal("shared_password"),
  password: Password,
});

export const AccessEmailShared = Schema.Struct({
  kind: Schema.Literal("email_shared"),
  emails: EmailList,
  password: Password,
});

export const AccessPerEmail = Schema.Struct({
  kind: Schema.Literal("per_email"),
  emails: EmailList,
  passwords: Schema.Array(Password).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(Limits.maxEmails),
  ),
}).check(
  Schema.makeFilter(
    (value: {
      readonly emails: ReadonlyArray<string>;
      readonly passwords: ReadonlyArray<string>;
    }) => value.emails.length === value.passwords.length,
    { message: "emails and passwords must have the same length" },
  ),
);

export const AccessPolicy = Schema.Union([
  AccessPublic,
  AccessSharedPassword,
  AccessEmailShared,
  AccessPerEmail,
]);
export type AccessPolicy = typeof AccessPolicy.Type;

export const AccessKind = Schema.Literals([
  "public",
  "shared_password",
  "email_shared",
  "per_email",
]);
export type AccessKind = typeof AccessKind.Type;
