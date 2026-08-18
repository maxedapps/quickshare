import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, posix, relative, sep } from "node:path";
import { Limits, RootIndexPath } from "@quickshare/contracts";
import { Marked } from "marked";
import mime from "mime";

import type { PreparedFile } from "./client.ts";

const Markdown = new Marked({ gfm: true, breaks: false, pedantic: false, silent: false });

export async function prepareInput(path: string): Promise<ReadonlyArray<PreparedFile>> {
  const stat = await lstat(path);
  if (
    stat.isSymbolicLink() ||
    stat.isSocket() ||
    stat.isFIFO() ||
    stat.isBlockDevice() ||
    stat.isCharacterDevice()
  ) {
    throw new Error("unsupported filesystem object");
  }
  if (stat.isFile()) return [await prepareSingle(path)];
  if (!stat.isDirectory()) throw new Error("unsupported filesystem object");
  return prepareDirectory(path);
}

async function prepareSingle(path: string): Promise<PreparedFile> {
  const ext = extname(path).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    const raw = await readFile(path);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    const html = wrapHtml(basename(path, ext), Markdown.parse(text, { async: false }));
    return file(RootIndexPath, Buffer.from(html), "text/html;charset=utf-8");
  }
  const bytes = await readFile(path);
  return file(RootIndexPath, bytes, mediaType(path));
}

async function prepareDirectory(root: string): Promise<ReadonlyArray<PreparedFile>> {
  const files: PreparedFile[] = [];
  await walk(root, root, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (!files.some((entry) => entry.path === RootIndexPath))
    throw new Error("directory must contain index.html");
  if (files.length > Limits.maxFiles) throw new Error("too many files");
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  if (total > Limits.maxTotalBytes) throw new Error("payload too large");
  const paths = new Set(files.map((entry) => entry.path));
  if (paths.size !== files.length) throw new Error("path collision after NFC normalization");
  return files;
}

async function walk(root: string, current: string, out: PreparedFile[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (
      entry.isSymbolicLink() ||
      entry.isSocket() ||
      entry.isFIFO() ||
      entry.isBlockDevice() ||
      entry.isCharacterDevice()
    ) {
      throw new Error("unsupported filesystem object");
    }
    if (entry.isDirectory()) {
      await walk(root, full, out);
      continue;
    }
    if (!entry.isFile()) throw new Error("unsupported filesystem object");
    const rel = relative(root, full).split(sep).join(posix.sep).normalize("NFC");
    const bytes = await readFile(full);
    out.push(file(rel, bytes, mediaType(full)));
  }
}

function file(path: string, bytes: Uint8Array, mediaTypeValue: string): PreparedFile {
  if (bytes.byteLength > Limits.maxFileBytes) throw new Error("file too large");
  return {
    path,
    size: bytes.byteLength,
    mediaType: mediaTypeValue,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

function mediaType(path: string): string {
  return mime.getType(path) ?? "application/octet-stream";
}

function wrapHtml(title: string, body: string): string {
  const safe = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe}</title><style>body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.5}</style></head><body>${body}</body></html>`;
}
