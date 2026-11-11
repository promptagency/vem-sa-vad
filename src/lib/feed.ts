// Pure feed helpers, kept apart from podcasts.ts so the Node tests can load them
// (they may only have type imports — see CLAUDE.md).

export function parseDuration(raw: string): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10); // plain seconds
  const parts = raw.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0); // HH:MM:SS or MM:SS
}

/**
 * A feed's bytes as text. Strict UTF-8 first: nearly all feeds are UTF-8, a
 * Latin-1 "å" can't pass for it, and a feed that reads today keeps reading the
 * same. Otherwise a byte-order mark, or a charset other than UTF-8 that the feed
 * declares (its XML declaration, then the Content-Type), decides; failing that
 * it stays UTF-8, with only the broken bytes replaced, as before.
 */
export function decodeFeed(bytes: ArrayBuffer, contentType: string | null): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    /* not (entirely) UTF-8 */
  }
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const prolog = new TextDecoder("windows-1252").decode(bytes.slice(0, 200));
  const declared =
    /^[^<]*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i.exec(prolog)?.[1] ??
    /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1];
  // UTF-16 without a byte-order mark would have to be ASCII-incompatible to
  // reach here, and isn't; a UTF-8 label means UTF-8 with a few bad bytes.
  if (declared && !/^utf-?(8|16)/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(bytes);
    } catch {
      /* a label the browser doesn't know */
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}
