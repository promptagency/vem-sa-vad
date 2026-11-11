// Hand-written cases for tests/robustness.test.ts. Add a line when a new edge
// case turns up; the test file only states the rules every case must follow.

const W = 25 * 60; // DIARIZE_WINDOW_SECONDS
const SAMPLE = 1 / 16000;

/** Recording lengths planWindows must handle: finite ones get a covering plan. */
export const FINITE_DURATIONS = [0, SAMPLE, 1, 600, W, W + SAMPLE, 3 * 3600, 240 * 60, 240 * 60 + SAMPLE];
/** Lengths that can't come from real audio; planWindows must still return promptly with finite windows. */
export const BAD_DURATIONS = [NaN, Infinity, -Infinity, -5];

/** [input, expected] — expected null means "not a duration". */
export const DURATIONS: [string, number | null][] = [
  ["", null],
  ["0", 0],
  ["59", 59],
  ["02:03", 123],
  ["1:02:03", 3723],
  ["abc", null],
  ["1::2", null],
];
/** Feed durations with no single right answer: the result must be null or a finite number ≥ 0. */
export const ODD_DURATIONS = [
  "-5", "1:-2", "-1:00", "1.5", " 12 ", "1e3", "Infinity", "NaN", "١٢٣", "1:2:3:4", "9".repeat(400),
  `${"9".repeat(400)}:00`, "99999999999999999999999", ":", "::", "0x10",
];

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return new Uint8Array(out);
};
/** Feed bodies, the Content-Type they came with, and a substring the text must contain (if known). */
export const FEEDS: { name: string; body: Uint8Array; contentType: string | null; contains?: string }[] = [
  { name: "empty", body: new Uint8Array(), contentType: null },
  { name: "utf-8", body: enc('<?xml version="1.0"?><rss><title>Åsa</title></rss>'), contentType: "application/rss+xml", contains: "Åsa" },
  { name: "utf-8 with BOM", body: bytes([0xef, 0xbb, 0xbf], enc("<rss>Å</rss>")), contentType: null, contains: "Å" },
  { name: "utf-16le BOM", body: bytes([0xff, 0xfe], [0x3c, 0, 0x72, 0, 0xc5, 0]), contentType: null, contains: "<rÅ" },
  { name: "utf-16be BOM", body: bytes([0xfe, 0xff], [0, 0x3c, 0, 0x72, 0, 0xc5]), contentType: null, contains: "<rÅ" },
  { name: "windows-1252 declared in XML", body: bytes(enc('<?xml version="1.0" encoding="windows-1252"?><rss>'), [0xe5], enc("</rss>")), contentType: null, contains: "å" },
  { name: "latin1 declared in Content-Type", body: bytes(enc("<rss>"), [0xe5], enc("</rss>")), contentType: "text/xml; charset=ISO-8859-1", contains: "å" },
  { name: "unknown charset in XML", body: bytes(enc('<?xml encoding="no-such-charset"?><rss>'), [0xe5]), contentType: null },
  { name: "unknown charset in Content-Type", body: bytes(enc("<rss>"), [0xff]), contentType: 'text/xml; charset="x-bogus' },
  { name: "lone 0xff", body: new Uint8Array([0xff]), contentType: null },
  { name: "lone 0xfe 0xff (BOM, no text)", body: new Uint8Array([0xfe, 0xff]), contentType: null },
  { name: "odd-length utf-16", body: bytes([0xff, 0xfe], [0x3c, 0, 0x72]), contentType: null },
];

/**
 * Saved transcripts as a damaged or older IndexedDB record could hold them. Every
 * format must still render; the cast is the point — storage isn't type-checked.
 */
export const DAMAGED_RESULTS: { name: string; result: unknown }[] = [
  { name: "no chunks", result: { text: "Hej" } },
  { name: "chunks null", result: { text: "Hej", chunks: null } },
  { name: "no text, no chunks", result: {} },
  { name: "text null", result: { text: null, chunks: [] } },
  { name: "chunk without text", result: { text: "x", chunks: [{ timestamp: [0, 1] }] } },
  { name: "chunk text null", result: { text: "x", chunks: [{ text: null, timestamp: [0, 1] }] } },
  { name: "chunk without timestamp", result: { text: "x", chunks: [{ text: "a" }] } },
  { name: "timestamp null", result: { text: "x", chunks: [{ text: "a", timestamp: null }] } },
  { name: "timestamp [null, null]", result: { text: "x", chunks: [{ text: "a", timestamp: [null, null] }] } },
  { name: "timestamp as strings", result: { text: "x", chunks: [{ text: "a", timestamp: ["1", "2"] }] } },
  { name: "timestamp []", result: { text: "x", chunks: [{ text: "a", timestamp: [] }] } },
  { name: "timestamp [\"abc\", 3]", result: { text: "x", chunks: [{ text: "a", timestamp: ["abc", 3] }] } },
  { name: "timestamp [NaN, Infinity]", result: { text: "x", chunks: [{ text: "a", timestamp: [NaN, Infinity] }] } },
  { name: "null chunk", result: { text: "x", chunks: [null, { text: "b", timestamp: [1, 2] }] } },
  { name: "speaker as string", result: { text: "x", chunks: [{ text: "a", timestamp: [0, 1], speaker: "2" }] } },
];

/** Hosts and URLs the proxy must never fetch, given directly or reached by a redirect. */
export const BLOCKED_TARGETS = [
  "http://localhost/",
  "http://LOCALHOST/",
  "http://localhost./",
  "http://foo.localhost/",
  "http://foo.localhost./",
  "http://127.0.0.1/",
  "http://127.1/",
  "http://2130706433/",
  "http://0x7f000001/",
  "http://0177.0.0.1/",
  "http://１２７.0.0.1/",
  "http://0.0.0.0/",
  "http://0.1.2.3/",
  "http://10.0.0.1/",
  "http://100.64.0.1/",
  "http://100.127.255.255/",
  "http://169.254.169.254/latest/meta-data/",
  "http://172.16.0.1/",
  "http://172.31.255.255/",
  "http://192.168.1.1/",
  "http://198.18.0.1/",
  "http://198.19.255.255/",
  "http://224.0.0.1/",
  "http://239.255.255.250/",
  "http://240.0.0.1/",
  "http://255.255.255.255/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[fd00::1]/",
  "http://printer.local/",
  "http://db.internal/",
  "http://metadata.google.internal/",
  "http://user:pw@example.com/a.mp3",
  "http://user@example.com/a.mp3",
  "http://example.com:22/a.mp3",
  "http://example.com:8080/a.mp3",
  "https://example.com:8443/a.mp3",
  "ftp://example.com/a.mp3",
  "file:///etc/passwd",
  "data:audio/mpeg;base64,SUQz",
  "javascript:alert(1)",
];

/** Public addresses next to the blocked ranges, and names that merely contain a blocked word. */
export const ALLOWED_TARGETS = [
  "http://example.com/a.mp3",
  "https://example.com/feed.xml",
  "http://example.com:80/a.mp3",
  "https://example.com:443/a.mp3",
  "http://11.0.0.1/",
  "http://100.63.255.255/",
  "http://100.128.0.1/",
  "http://172.15.255.255/",
  "http://172.32.0.1/",
  "http://192.169.0.1/",
  "http://198.17.255.255/",
  "http://198.20.0.1/",
  "http://223.255.255.254/",
  "http://localhost.example.com/",
  "http://mylocalhost.com/",
  "http://internal.example.com/",
];

/** Upstream Content-Type values a 200 must never pass through as anything active. */
export const UPSTREAM_TYPES = [
  null, "", "text/html", "text/html; charset=utf-8", "audio/mpeg", "audio/mpeg; codecs=mp3", "video/mp4", "AUDIO/MP4",
  'audio/x"><script>', "application/rss+xml; charset=utf-8", "application/xml",
  "image/svg+xml", "application/javascript", "text/xml; charset=windows-1252", 'text/xml; charset="utf-8', "multipart/x-mixed-replace",
];
