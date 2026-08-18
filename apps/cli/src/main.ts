#!/usr/bin/env node
/** @effect-diagnostics strictEffectProvide:skip-file */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { ApiClient } from "./client.ts";
import type { ShareDetail, ShareListResponse } from "@quickshare/contracts";
import {
  configPathFrom,
  loadConfig,
  normalizeApiUrl,
  resolveSetting,
  writeConfig,
} from "./config.ts";
import { prepareInput } from "./input.ts";
import { accessFromFlags, parseEmails, parseTtl, stripStdinSecret } from "./options.ts";

const urlFlag = Flag.string("url").pipe(Flag.optional, Flag.withDescription("Management API URL"));
const keyFlag = Flag.string("key").pipe(Flag.optional, Flag.withDescription("API key"));
const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("JSON output"),
);
const configFileFlag = Flag.string("config-file").pipe(
  Flag.optional,
  Flag.withDescription("Config file path"),
);

const root = Command.make(
  "quickshare",
  {
    path: Argument.string("path").pipe(
      Argument.optional,
      Argument.withDescription("File or directory to publish"),
    ),
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
    project: Flag.string("project").pipe(Flag.optional),
    password: Flag.string("password").pipe(Flag.optional),
    emails: Flag.string("emails").pipe(Flag.optional),
    passwords: Flag.string("passwords").pipe(Flag.optional),
    passwordStdin: Flag.boolean("password-stdin").pipe(Flag.withDefault(false)),
    passwordsStdin: Flag.boolean("passwords-stdin").pipe(Flag.withDefault(false)),
    ttl: Flag.string("ttl").pipe(Flag.optional),
  },
  Effect.fn(function* (opts) {
    if (Option.isNone(opts.path)) {
      yield* Console.error("path is required");
      return yield* Effect.fail(new Error("usage"));
    }
    return yield* publish(opts, undefined);
  }),
).pipe(Command.withDescription("Publish a file, directory, or Markdown document"));

const update = Command.make(
  "update",
  {
    id: Argument.string("id"),
    path: Argument.string("path").pipe(Argument.optional),
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
    password: Flag.string("password").pipe(Flag.optional),
    emails: Flag.string("emails").pipe(Flag.optional),
    passwords: Flag.string("passwords").pipe(Flag.optional),
    passwordStdin: Flag.boolean("password-stdin").pipe(Flag.withDefault(false)),
    passwordsStdin: Flag.boolean("passwords-stdin").pipe(Flag.withDefault(false)),
    ttl: Flag.string("ttl").pipe(Flag.optional),
    publicReset: Flag.boolean("public").pipe(Flag.withDefault(false)),
  },
  Effect.fn(function* (opts) {
    yield* publish(opts, opts.id);
  }),
).pipe(Command.withDescription("Update an existing share"));

const list = Command.make(
  "list",
  {
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
  },
  Effect.fn(function* (opts) {
    const client = yield* clientFrom(opts);
    const result = yield* Effect.tryPromise(() => client.list());
    yield* output(opts.json, result, () =>
      result.items
        .map((item) => `${item.id}  ${item.project}  ${item.status}  ${item.url}`)
        .join("\n"),
    );
  }),
).pipe(Command.withDescription("List shares"));

const inspectCmd = Command.make(
  "inspect",
  {
    id: Argument.string("id"),
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
  },
  Effect.fn(function* (opts) {
    const client = yield* clientFrom(opts);
    const result = yield* Effect.tryPromise(() => client.inspect(opts.id));
    yield* output(
      opts.json,
      result,
      () => `${result.id}\n${result.project}\n${result.status}\n${result.url}`,
    );
  }),
).pipe(Command.withDescription("Inspect a share"));

const revokeCmd = Command.make(
  "revoke",
  {
    id: Argument.string("id"),
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
  },
  Effect.fn(function* (opts) {
    const client = yield* clientFrom(opts);
    yield* Effect.tryPromise(() => client.revoke(opts.id));
    yield* output(opts.json, { ok: true }, () => `revoked ${opts.id}`);
  }),
).pipe(Command.withDescription("Revoke a share"));

const configCmd = Command.make(
  "config",
  {
    url: urlFlag,
    key: keyFlag,
    json: jsonFlag,
    configFile: configFileFlag,
  },
  Effect.fn(function* (opts) {
    const path = configPathFrom(process.env, option(opts.configFile));
    const patch = {
      ...(Option.isSome(opts.url) ? { url: normalizeApiUrl(opts.url.value) } : {}),
      ...(Option.isSome(opts.key) ? { key: opts.key.value } : {}),
    };
    yield* Effect.tryPromise(() => writeConfig(path, patch));
    if (opts.json) yield* Console.log(JSON.stringify({ ok: true }));
  }),
).pipe(Command.withDescription("Write local CLI config"));

root.pipe(
  Command.withSubcommands([update, list, inspectCmd, revokeCmd, configCmd]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain,
);

function option(value: Option.Option<string> | undefined): string | undefined {
  return value === undefined ? undefined : Option.getOrUndefined(value);
}

function clientFrom(opts: {
  url: Option.Option<string>;
  key: Option.Option<string>;
  configFile: Option.Option<string>;
}) {
  return Effect.tryPromise(async () => {
    const path = configPathFrom(process.env, option(opts.configFile));
    const file = await loadConfig(path);
    const url = resolveSetting(option(opts.url), process.env.QUICKSHARE_URL, file.url);
    const key = resolveSetting(option(opts.key), process.env.QUICKSHARE_KEY, file.key);
    if (url === undefined || key === undefined) throw new Error("url and key are required");
    return new ApiClient(normalizeApiUrl(url), key);
  });
}

function output(
  json: boolean,
  value: { readonly ok?: boolean } | ShareDetail | ShareListResponse,
  human: () => string,
) {
  return json ? Console.log(JSON.stringify(value)) : Console.log(human());
}

function publish(
  opts: {
    path?: Option.Option<string>;
    url: Option.Option<string>;
    key: Option.Option<string>;
    json: boolean;
    configFile: Option.Option<string>;
    project?: Option.Option<string>;
    password?: Option.Option<string>;
    emails?: Option.Option<string>;
    passwords?: Option.Option<string>;
    passwordStdin?: boolean;
    passwordsStdin?: boolean;
    ttl?: Option.Option<string>;
    publicReset?: boolean;
  },
  shareId: string | undefined,
) {
  return Effect.tryPromise(async () => {
    const client = await Effect.runPromise(clientFrom(opts));
    const files =
      option(opts.path) === undefined ? undefined : await prepareInput(option(opts.path) ?? "");
    const password =
      opts.passwordStdin === true ? stripStdinSecret(await readStdin()) : option(opts.password);
    const emails =
      option(opts.emails) === undefined ? undefined : parseEmails(option(opts.emails) ?? "");
    const passwords =
      opts.passwordsStdin === true
        ? (await readStdin())
            .split("\n")
            .map(stripStdinSecret)
            .filter((line) => line.length > 0)
        : option(opts.passwords) === undefined
          ? undefined
          : (option(opts.passwords) ?? "").split(",");
    const access = accessFromFlags(password, emails, passwords, opts.publicReset === true);
    const ttl = option(opts.ttl);
    const ttlSeconds = ttl === undefined ? undefined : parseTtl(ttl, shareId !== undefined);
    if (shareId === undefined) {
      if (files === undefined) throw new Error("path is required");
      const project = option(opts.project);
      const start = await client.startCreate({
        files: files.map((file, ordinal) => ({
          ordinal,
          path: file.path,
          size: file.size,
          mediaType: file.mediaType,
          sha256: file.sha256,
        })),
        ...(project === undefined ? {} : { project }),
        ...(ttlSeconds === undefined || ttlSeconds === null ? {} : { ttlSeconds }),
        ...(access === undefined ? {} : { access }),
      });
      try {
        for (const [ordinal, file] of files.entries()) {
          if (file === undefined) continue;
          await client.putFile(start.revisionId, file, ordinal);
        }
        const committed = await client.commit(start.revisionId);
        if (opts.json) console.log(JSON.stringify(committed));
        else console.log(committed.url);
      } catch (cause) {
        await client.abort(start.revisionId);
        throw cause;
      }
      return;
    }
    if (files === undefined && ttlSeconds === undefined && access === undefined)
      throw new Error("update requires content or a patch");
    const etag = await client.currentEtag(shareId);
    const start = await client.startUpdate(shareId, etag, {
      ...(files === undefined
        ? {}
        : {
            files: files.map((file, ordinal) => ({
              ordinal,
              path: file.path,
              size: file.size,
              mediaType: file.mediaType,
              sha256: file.sha256,
            })),
          }),
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      ...(access === undefined ? {} : { access }),
    });
    try {
      if (files !== undefined) {
        for (const [ordinal, file] of files.entries()) {
          if (file === undefined) continue;
          await client.putFile(start.revisionId, file, ordinal);
        }
      }
      const committed = await client.commit(start.revisionId);
      if (opts.json) console.log(JSON.stringify(committed));
      else console.log(committed.url);
    } catch (cause) {
      await client.abort(start.revisionId);
      throw cause;
    }
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export const cliName = "quickshare";
