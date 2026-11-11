// The robustness contract: rules that must hold for every input, checked on the
// hand-written cases in tests/fuzz/cases.ts and on seeded random inputs
// (tests/fuzz/random.ts). This file and tests/fuzz/ are the exam of the fix loop
// (.claude/hooks/loop.mjs): while it runs they are locked, and fixes go in src/
// or functions/. The transcription model itself is out of scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LOCAL_SPEAKERS,
  assignSpeakers,
  decodeActivity,
  planWindows,
  smoothSpeakers,
  stitchWindows,
  type DiarizationWindow,
} from "../src/lib/diarize.ts";
import { render, safeFileName, toTxt, type ExportFormat, type SpeakerNames } from "../src/lib/exporters.ts";
import { createZip } from "../src/lib/zip.ts";
import { jobFromSaved } from "../src/lib/jobs.ts";
import { decodeFeed, parseDuration } from "../src/lib/feed.ts";
import { onRequestGet } from "../functions/proxy.php.ts";
import type { SpeakerActivity, TranscriptChunk, TranscriptResult } from "../src/lib/protocol.ts";
import type { SavedTranscript } from "../src/lib/storage.ts";
import { AWKWARD_SECONDS, ITERATIONS, TEXT_ALPHABET, rng, type Rng } from "./fuzz/random.ts";
import { TIME_LIMIT_MS, runIsolated } from "./fuzz/isolated.ts";
import {
  ALLOWED_TARGETS,
  BAD_DURATIONS,
  BLOCKED_TARGETS,
  DAMAGED_RESULTS,
  DURATIONS,
  FEEDS,
  FINITE_DURATIONS,
  ODD_DURATIONS,
  UPSTREAM_TYPES,
} from "./fuzz/cases.ts";

const EPS = 1e-6;
const FORMATS: ExportFormat[] = ["txt", "md", "srt", "vtt", "json"];
const DIARIZE = new URL("../src/lib/diarize.ts", import.meta.url);
const fmt = (v: unknown) => (typeof v === "number" ? String(v) : JSON.stringify(v));

// ── 1. File loading: recording length, podcast feeds, restored transcripts ──

function assertCoveringPlan(d: number, windows: DiarizationWindow[]) {
  assert.ok(windows.length >= 1, `no windows for ${d}`);
  assert.equal(windows[0].startSec, 0);
  assert.equal(windows.at(-1)!.endSec, d);
  windows.forEach((w, i) => {
    assert.equal(w.index, i);
    assert.ok(Number.isFinite(w.startSec) && Number.isFinite(w.endSec), `window ${i} not finite`);
    assert.ok(0 <= w.startSec && w.startSec <= w.endSec && w.endSec <= d, `window ${i} out of range`);
    if (i > 0) {
      const prev = windows[i - 1];
      assert.ok(w.startSec > prev.startSec && w.endSec > prev.endSec, `window ${i} goes backwards`);
      assert.ok(w.startSec < prev.endSec, `gap before window ${i}`);
    }
  });
}

for (const d of FINITE_DURATIONS) {
  test(`planWindows(${fmt(d)}) covers the recording within ${TIME_LIMIT_MS} ms`, async () => {
    const outcome = await runIsolated(DIARIZE, "planWindows", [d]);
    assert.ok("value" in outcome, `did not return: ${JSON.stringify(outcome)}`);
    assertCoveringPlan(d, outcome.value as DiarizationWindow[]);
  });
}

for (const d of BAD_DURATIONS) {
  test(`planWindows(${fmt(d)}) returns finite windows within ${TIME_LIMIT_MS} ms`, async () => {
    const outcome = await runIsolated(DIARIZE, "planWindows", [d]);
    assert.ok("value" in outcome, `did not return: ${JSON.stringify(outcome)}`);
    const windows = outcome.value as DiarizationWindow[];
    assert.ok(Array.isArray(windows));
    for (const w of windows) assert.ok(Number.isFinite(w.startSec) && Number.isFinite(w.endSec) && w.startSec <= w.endSec);
  });
}

test(`planWindows: ${ITERATIONS} random lengths up to 4 h are covered`, () => {
  const r = rng(1);
  for (let i = 0; i < ITERATIONS; i++) {
    const d = r.chance(0.2) ? r.next() * 30 : r.next() * 4 * 3600;
    assertCoveringPlan(d, planWindows(d));
  }
});

for (const [raw, expected] of DURATIONS) {
  test(`parseDuration(${JSON.stringify(raw)}) is ${expected}`, () => assert.equal(parseDuration(raw), expected));
}

const isDurationOrNull = (v: number | null) => v === null || (Number.isFinite(v) && v >= 0);

for (const raw of ODD_DURATIONS) {
  test(`parseDuration(${JSON.stringify(raw.length > 20 ? raw.slice(0, 20) + "…" : raw)}) is null or a finite duration ≥ 0`, () => {
    const v = parseDuration(raw);
    assert.ok(isDurationOrNull(v), `got ${v}`);
  });
}

test(`parseDuration: ${ITERATIONS} random strings give null or a finite duration ≥ 0`, () => {
  const r = rng(2);
  for (let i = 0; i < ITERATIONS; i++) {
    const raw = r.string(["0", "1", "5", "9", "99999", ":", "-", " ", ".", "e", "x"], 12);
    const v = parseDuration(raw);
    assert.ok(isDurationOrNull(v), `${JSON.stringify(raw)} → ${v}`);
  }
});

const bufferOf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

for (const feed of FEEDS) {
  test(`decodeFeed: ${feed.name} decodes to text`, () => {
    const text = decodeFeed(bufferOf(feed.body), feed.contentType);
    assert.equal(typeof text, "string");
    if (feed.contains) assert.ok(text.includes(feed.contains), `${JSON.stringify(text)} lacks ${feed.contains}`);
  });
}

test(`decodeFeed: ${ITERATIONS} random byte strings never throw`, () => {
  const r = rng(3);
  const types = [null, "", "text/xml", "text/xml; charset=windows-1252", "text/xml; charset=utf-16", "text/xml; charset=nope", "charset="];
  const prologs = ["", "<?xml version='1.0' encoding='latin1'?>", "<?xml encoding=\"utf-16\"?>", "<?xml encoding='x'?>"];
  for (let i = 0; i < ITERATIONS; i++) {
    const head = new TextEncoder().encode(r.pick(prologs));
    const tail = Array.from({ length: r.int(0, 64) }, () => r.int(0, 255));
    const body = new Uint8Array([...(r.chance(0.2) ? [r.pick([0xff, 0xfe, 0xef]), r.pick([0xfe, 0xff, 0xbb])] : []), ...head, ...tail]);
    assert.equal(typeof decodeFeed(bufferOf(body), r.pick(types)), "string");
  }
});

// ── Export validators, shared by restored transcripts (above) and exports (below) ──

const TIMING = (sep: string) =>
  new RegExp(`^(\\d{2,}):([0-5]\\d):([0-5]\\d)${sep}(\\d{3}) --> (\\d{2,}):([0-5]\\d):([0-5]\\d)${sep}(\\d{3})$`);
const seconds = (m: RegExpExecArray, at: number) => +m[at] * 3600 + +m[at + 1] * 60 + +m[at + 2] + +m[at + 3] / 1000;

/** Read subtitle cues back the way a player would; `expected` is the cue count, when known. */
function assertSubtitles(out: string, kind: "srt" | "vtt", expected?: number) {
  let body = out.replace(/\r\n?/g, "\n");
  if (kind === "vtt") {
    assert.ok(body.startsWith("WEBVTT\n\n"), "VTT header");
    body = body.slice("WEBVTT\n\n".length);
  }
  body = body.replace(/^\n+|\n+$/g, "");
  const blocks = body === "" ? [] : body.split(/\n{2,}/);
  if (expected !== undefined) assert.equal(blocks.length, expected, `cue count in ${JSON.stringify(out)}`);
  const timing = TIMING(kind === "srt" ? "," : "\\.");
  blocks.forEach((block, i) => {
    const lines = block.split("\n");
    if (kind === "srt") assert.equal(lines.shift(), String(i + 1), `SRT cue number in ${JSON.stringify(block)}`);
    const m = timing.exec(lines[0] ?? "");
    assert.ok(m, `bad timing line ${JSON.stringify(lines[0])}`);
    assert.ok(seconds(m, 5) >= seconds(m, 1), `cue ends before it starts: ${lines[0]}`);
    assert.ok(lines.length >= 2 && lines.slice(1).join("").trim() !== "", `empty cue ${JSON.stringify(block)}`);
    if (kind === "vtt") for (const l of lines.slice(1)) assert.ok(!l.includes("-->"), `"-->" in VTT cue text: ${JSON.stringify(l)}`);
  });
}

/** Markdown that would turn transcript text into structure (heading, list, quote, rule, HTML). */
const MD_STRUCTURE = /^ {0,3}(#{1,6}([ \t]|$)|[-+*]([ \t]|$)|\d{1,9}[.)]([ \t]|$)|>|<|([-*_][ \t]*){3,}$|=+[ \t]*$)/;

function assertExport(result: TranscriptResult, format: ExportFormat, names: SpeakerNames = {}, expectedCues?: number) {
  let out = "";
  assert.doesNotThrow(() => {
    out = render(result, format, names, { title: "T", timestamps: true, date: new Date(2026, 0, 1) });
  }, `render ${format} threw`);
  assert.equal(typeof out, "string");
  if (format === "srt" || format === "vtt") assertSubtitles(out, format, expectedCues);
  if (format === "json") {
    const parsed = JSON.parse(out);
    assert.equal(parsed.text, toTxt(result, names).trim(), "JSON text equals toTxt");
    assert.ok(Array.isArray(parsed.chunks));
  }
  if (format === "md") {
    out
      .split("\n")
      .slice(4) // "# T", "", "*facts*", "": the header is structure on purpose
      .forEach((l) => assert.ok(!MD_STRUCTURE.test(l), `Markdown structure from text: ${JSON.stringify(l)}`));
  }
}

for (const { name, result } of DAMAGED_RESULTS) {
  test(`restored transcript (${name}) renders in every format`, () => {
    const saved = { id: "x", label: "L", source: "file", downloadName: "d", result, originalResult: null, speakerNames: {}, warning: null, savedAt: 0 };
    const job = jobFromSaved(saved as unknown as SavedTranscript);
    assert.ok(job.result, "restored job has a result");
    for (const format of FORMATS) assertExport(job.result, format);
  });
}

// ── 2. Speaker separation (diarize.ts) on random activity ──

function assertDisjointPerSpeaker(spans: SpeakerActivity[], what: string) {
  const bySpeaker = new Map<number, SpeakerActivity[]>();
  for (const s of spans) bySpeaker.set(s.speaker, [...(bySpeaker.get(s.speaker) ?? []), s]);
  for (const [speaker, list] of bySpeaker) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i].start >= list[i - 1].end - EPS, `${what}: speaker ${speaker} counted twice around ${list[i].start}`);
    }
  }
}

test(`decodeActivity: ${ITERATIONS} random logit tensors give clean spans`, () => {
  const r = rng(4);
  for (let i = 0; i < ITERATIONS; i++) {
    const numClasses = r.pick([7, 7, 7, 1, 3, 9]);
    const numFrames = r.int(0, 300);
    const length = r.chance(0.1) ? r.int(0, numFrames * numClasses) : numFrames * numClasses;
    const logits = Float32Array.from({ length }, () => (r.chance(0.02) ? NaN : r.next() * 4 - 2));
    const duration = r.chance(0.05) ? 0 : r.next() * 120;
    const windowStart = r.int(0, 3) * 1380;
    const windowIndex = r.int(0, 5);
    const spans = decodeActivity(logits, numFrames, numClasses, duration, windowStart, windowIndex);
    for (const s of spans) {
      assert.ok(Number.isInteger(s.speaker) && s.speaker >= windowIndex * MAX_LOCAL_SPEAKERS && s.speaker < (windowIndex + 1) * MAX_LOCAL_SPEAKERS, `speaker ${s.speaker}`);
      assert.ok(Number.isFinite(s.start) && Number.isFinite(s.end), "finite span");
      assert.ok(s.start >= windowStart - EPS && s.end <= windowStart + duration + EPS, "span inside the window");
      assert.ok(duration > 0 ? s.start < s.end : s.start <= s.end, `span ${s.start}–${s.end}`);
    }
    assertDisjointPerSpeaker(spans, `decode #${i}`);
  }
});

function randomWindowActivity(r: Rng, window: DiarizationWindow): SpeakerActivity[] {
  const spans: SpeakerActivity[] = [];
  for (let s = 0; s < MAX_LOCAL_SPEAKERS; s++) {
    if (!r.chance(0.7)) continue;
    let t = window.startSec;
    for (;;) {
      const start = t + r.next() * 8;
      if (start >= window.endSec) break;
      const end = Math.min(window.endSec, start + 0.01 + r.next() * 8);
      spans.push({ speaker: window.index * MAX_LOCAL_SPEAKERS + s, start, end });
      t = end;
    }
  }
  return spans;
}

test(`stitchWindows: ${ITERATIONS} random recordings stitch without double counting`, () => {
  const r = rng(5);
  for (let i = 0; i < ITERATIONS; i++) {
    const d = 1 + r.next() * 600;
    const parts = planWindows(d, 60, 10).map((window) => ({ window, activity: randomWindowActivity(r, window) }));
    const out = stitchWindows(parts);
    assert.deepEqual(stitchWindows(parts), out, "deterministic");
    if (parts.length === 1) assert.deepEqual(out, parts[0].activity, "one window passes through");
    const inputs = parts.flatMap((p) => p.activity);
    for (const s of out) {
      assert.ok(Number.isInteger(s.speaker) && s.speaker >= 0, `speaker ${s.speaker}`);
      assert.ok(Number.isFinite(s.start) && 0 <= s.start && s.start < s.end && s.end <= d + EPS, `span ${s.start}–${s.end}`);
      assert.ok(inputs.some((x) => x.start <= s.start + EPS && s.end <= x.end + EPS), "span comes from the input");
    }
    assertDisjointPerSpeaker(out, `stitch #${i}`);
  }
});

function assertNumberedByFirstAppearance(chunks: TranscriptChunk[], what: string) {
  let highest = 0;
  for (const c of chunks) {
    if (c.speaker == null) continue;
    assert.ok(Number.isInteger(c.speaker) && c.speaker >= 1 && c.speaker <= highest + 1, `${what}: speaker ${c.speaker} after ${highest}`);
    highest = Math.max(highest, c.speaker);
  }
}

function randomChunks(r: Rng): { chunks: TranscriptChunk[]; end: number } {
  const chunks: TranscriptChunk[] = [];
  let t = 0;
  for (let n = r.int(0, 40); n > 0; n--) {
    const start = t + r.next() * 3 + (r.chance(0.05) ? 1000 : 0); // now and then past the audio
    const kind = r.next();
    const end = kind < 0.1 ? null : kind < 0.2 ? start : start + r.next() * 6;
    chunks.push({ text: r.string(["hej", " ", "ja"], 3), timestamp: [start, end] });
    t = start;
  }
  return { chunks, end: t + 5 };
}

test(`assignSpeakers + smoothSpeakers: ${ITERATIONS} random transcripts keep their lines and number speakers 1…n`, () => {
  const r = rng(6);
  for (let i = 0; i < ITERATIONS; i++) {
    const { chunks, end } = randomChunks(r);
    const speakers = r.int(0, 5);
    const activity: SpeakerActivity[] = [];
    for (let n = speakers ? r.int(0, 30) : 0; n > 0; n--) {
      const start = r.next() * end;
      activity.push({ speaker: r.int(0, speakers - 1), start, end: start + 0.01 + r.next() * 10 });
    }
    const before = structuredClone(chunks);
    const assigned = assignSpeakers(chunks, activity);
    assert.deepEqual(chunks, before, "input not mutated");
    assert.deepEqual(assignSpeakers(chunks, activity), assigned, "deterministic");
    assert.equal(assigned.length, chunks.length);
    if (activity.length === 0) assert.deepEqual(assigned, chunks, "no activity, no change");
    assigned.forEach((c, k) => {
      assert.equal(c.text, chunks[k].text);
      assert.deepEqual(c.timestamp, chunks[k].timestamp);
      if (activity.length && c.speaker == null) assert.equal(c.speaker_conf, 0);
      if (c.speaker != null) assert.ok(Number.isFinite(c.speaker_conf) && c.speaker_conf! >= 0 && c.speaker_conf! <= 1, `conf ${c.speaker_conf}`);
    });
    assertNumberedByFirstAppearance(assigned, `assign #${i}`);

    const smoothed = smoothSpeakers(assigned);
    assert.equal(smoothed.length, assigned.length);
    smoothed.forEach((c, k) => {
      assert.equal(c.text, assigned[k].text);
      assert.equal(c.speaker_conf, assigned[k].speaker_conf);
      if (assigned[k].speaker == null) assert.equal(c.speaker, assigned[k].speaker, "no speech stays no speech");
    });
    assertNumberedByFirstAppearance(smoothed, `smooth #${i}`);
  }
});

// ── 3. Exports and ZIP ──

function randomResult(r: Rng): TranscriptResult {
  const chunks: TranscriptChunk[] = [];
  for (let n = r.int(0, 12); n > 0; n--) {
    const start = r.chance(0.3) ? r.pick(AWKWARD_SECONDS) : r.next() * 7200;
    const end = r.chance(0.15) ? null : r.chance(0.2) ? r.pick(AWKWARD_SECONDS) : start + r.next() * 10;
    const chunk: TranscriptChunk = { text: r.string(TEXT_ALPHABET, 6), timestamp: [start, end] };
    const speaker = r.pick([undefined, null, 1, 2, 3, 7]);
    if (speaker !== undefined) chunk.speaker = speaker;
    chunks.push(chunk);
  }
  return { text: r.string(TEXT_ALPHABET, 10), chunks, ...(r.chance(0.3) && { language: "sv" }) };
}

const cueCount = (result: TranscriptResult) =>
  result.chunks.filter((c) => c.text.trim()).length || (result.text.trim() ? 1 : 0);

for (const format of FORMATS) {
  test(`${format}: ${ITERATIONS} random transcripts export to a valid file`, () => {
    const r = rng(7);
    for (let i = 0; i < ITERATIONS; i++) {
      const result = randomResult(r);
      const names: SpeakerNames = r.chance(0.3) ? { 1: r.string(TEXT_ALPHABET, 4), 2: r.string(TEXT_ALPHABET, 4) } : {};
      assertExport(result, format, names, format === "srt" || format === "vtt" ? cueCount(result) : undefined);
    }
  });
}

for (const t of AWKWARD_SECONDS) {
  test(`srt/vtt: a line at ${t} s gets valid timestamps`, () => {
    for (const end of [null, t, t + 1]) {
      const result = { text: "x", chunks: [{ text: "hej", timestamp: [t, end] as [number, number | null] }] };
      assertSubtitles(render(result, "srt"), "srt", 1);
      assertSubtitles(render(result, "vtt"), "vtt", 1);
    }
  });
}

test(`safeFileName: ${ITERATIONS} random names give a safe, non-empty file name`, () => {
  const r = rng(8);
  const alphabet = [...TEXT_ALPHABET, ".", "..", "/", "\\", "?", "*", " ", "‮", "\u009f"];
  for (let i = 0; i < ITERATIONS; i++) {
    const raw = r.string(alphabet, 10);
    const name = safeFileName(raw);
    assert.ok(name.length > 0, `empty for ${JSON.stringify(raw)}`);
    assert.ok(!/[/\\:*?"<>|]/.test(name), `separator in ${JSON.stringify(name)}`);
    assert.ok(!/\p{Cc}/u.test(name), `control character in ${JSON.stringify(name)}`);
    assert.ok(!/^[.\s]|[.\s]$/.test(name), `leading/trailing dot or space in ${JSON.stringify(name)}`);
  }
});

/** CRC-32, bit by bit — independent of zip.ts's table. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A strict reader for store-only archives: every offset, size and checksum must agree. */
function readZip(bytes: Uint8Array): { name: string; text: string }[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  const end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50, "end of central directory");
  const count = v.getUint16(end + 10, true);
  assert.equal(v.getUint16(end + 8, true), count, "entries on this disk");
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  assert.equal(cdOffset + cdSize, end, "central directory ends where the end record starts");
  const out: { name: string; text: string }[] = [];
  let p = cdOffset;
  let expectedLocal = 0;
  for (let k = 0; k < count; k++) {
    assert.equal(v.getUint32(p, true), 0x02014b50, `central header ${k}`);
    assert.equal(v.getUint16(p + 8, true) & 0x0800, 0x0800, "UTF-8 flag (central)");
    assert.equal(v.getUint16(p + 10, true), 0, "stored");
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    assert.equal(v.getUint32(p + 24, true), size, "stored size = original size");
    const nameLength = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = bytes.slice(p + 46, p + 46 + nameLength);
    assert.equal(local, expectedLocal, `local header ${k} offset`);
    assert.equal(v.getUint32(local, true), 0x04034b50, `local header ${k}`);
    assert.equal(v.getUint16(local + 6, true) & 0x0800, 0x0800, "UTF-8 flag (local)");
    assert.equal(v.getUint32(local + 14, true), crc, "local CRC");
    assert.equal(v.getUint32(local + 18, true), size, "local size");
    const localNameLength = v.getUint16(local + 26, true);
    assert.deepEqual(bytes.slice(local + 30, local + 30 + localNameLength), name, "local name");
    const dataStart = local + 30 + localNameLength + v.getUint16(local + 28, true);
    const data = bytes.slice(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, `CRC of entry ${k}`);
    out.push({ name: utf8.decode(name), text: utf8.decode(data) });
    expectedLocal = dataStart + size;
    p += 46 + nameLength + extra;
  }
  assert.equal(expectedLocal, cdOffset, "entries end where the central directory starts");
  assert.equal(p, end, "central directory size");
  return out;
}

test(`createZip: ${ITERATIONS} random archives read back exactly`, async () => {
  const r = rng(9);
  for (let i = 0; i < ITERATIONS; i++) {
    const entries = Array.from({ length: r.int(0, 6) }, () => ({
      name: r.chance(0.1) ? "same.txt" : r.string([...TEXT_ALPHABET, "a.txt"], 8),
      text: r.chance(0.01) ? "x".repeat(200_000) : r.string(TEXT_ALPHABET, 40),
    }));
    const date = r.pick([new Date(2026, 0, 1), new Date(1970, 0, 1), new Date(2120, 11, 31, 23, 59, 59), new Date(NaN)]);
    const bytes = new Uint8Array(await createZip(entries, date).arrayBuffer());
    assert.deepEqual(readZip(bytes), entries);
  }
});

// ── 4. Podcast proxy (functions/proxy.php.ts), fetch replaced by a stub ──

type Upstream = { status?: number; body?: Uint8Array | string | null; headers?: Record<string, string> } | Error;
const WAV = "RIFF\0\0\0\0WAVE";
const FEED = '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>';
const START = "https://pod.example.com/start.mp3";
let fetched: string[] = [];
let upstream: (url: string) => Upstream = () => ({ body: WAV });

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  const u = upstream(url);
  if (u instanceof Error) throw u;
  return new Response((u.body ?? null) as BodyInit | null, { status: u.status ?? 200, headers: u.headers });
}) as typeof fetch;

async function proxy(target: string | null, headers: Record<string, string> = {}, env: { LIMITER?: Fetcher } = {}) {
  fetched = [];
  const query = target === null ? "" : `?url=${encodeURIComponent(target)}`;
  return onRequestGet({ request: new Request(`https://vemsavad.app/proxy.php${query}`, { headers }), env });
}

const proxyTest = (name: string, fn: () => Promise<void>) => test(name, { timeout: TIME_LIMIT_MS }, fn);

for (const target of BLOCKED_TARGETS) {
  proxyTest(`proxy refuses ${target}`, async () => {
    upstream = () => ({ body: WAV });
    const res = await proxy(target);
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    assert.deepEqual(fetched, [], "nothing fetched");
  });
  proxyTest(`proxy refuses a redirect to ${target}`, async () => {
    upstream = (url) => (url === START ? { status: 302, headers: { Location: target } } : { body: WAV });
    const res = await proxy(START);
    assert.ok(!res.ok, `status ${res.status}`);
    assert.deepEqual(fetched, [START], "only the first hop fetched");
  });
}

for (const target of ALLOWED_TARGETS) {
  proxyTest(`proxy fetches ${target}`, async () => {
    upstream = () => ({ body: WAV });
    const res = await proxy(target);
    assert.equal(res.status, 200);
    assert.equal(fetched.length, 1);
    assert.equal(new URL(fetched[0]).hostname, new URL(target).hostname);
  });
}

proxyTest("proxy follows a relative redirect", async () => {
  upstream = (url) => (url === START ? { status: 301, headers: { Location: "/b.mp3" } } : { body: WAV });
  const res = await proxy(START);
  assert.equal(res.status, 200);
  assert.deepEqual(fetched, [START, "https://pod.example.com/b.mp3"]);
});

proxyTest("proxy follows 5 redirects and refuses a 6th", async () => {
  const chain = (hops: number) => (url: string) => {
    const n = Number(new URL(url).searchParams.get("n") ?? 0);
    return n < hops ? { status: 302, headers: { Location: `https://pod.example.com/?n=${n + 1}` } } : { body: WAV };
  };
  upstream = chain(5);
  assert.equal((await proxy("https://pod.example.com/?n=0")).status, 200);
  upstream = chain(6);
  assert.equal((await proxy("https://pod.example.com/?n=0")).status, 508);
});

for (const site of ["cross-site", "same-site", "none"]) {
  proxyTest(`proxy refuses Sec-Fetch-Site: ${site}`, async () => {
    const res = await proxy(START, { "Sec-Fetch-Site": site });
    assert.equal(res.status, 403);
    assert.deepEqual(fetched, []);
  });
}

proxyTest("proxy serves same-origin and header-less requests", async () => {
  upstream = () => ({ body: WAV });
  assert.equal((await proxy(START, { "Sec-Fetch-Site": "same-origin" })).status, 200);
  assert.equal((await proxy(START)).status, 200);
});

proxyTest("proxy answers 400 for a missing or unreadable url", async () => {
  assert.equal((await proxy(null)).status, 400);
  assert.equal((await proxy("not a url")).status, 400);
  assert.deepEqual(fetched, []);
});

proxyTest("proxy passes upstream errors on and survives a failing fetch", async () => {
  upstream = () => ({ status: 404, body: "nope" });
  assert.equal((await proxy(START)).status, 404);
  upstream = () => new TypeError("connection reset");
  assert.equal((await proxy(START)).status, 502);
});

proxyTest("proxy fails open when the rate limiter breaks, and says 429 when it's full", async () => {
  upstream = () => ({ body: WAV });
  const ip = { "CF-Connecting-IP": "203.0.113.9" };
  const broken = { fetch: () => Promise.reject(new Error("down")) };
  assert.equal((await proxy(START, ip, { LIMITER: broken })).status, 200);
  const full = { fetch: () => Promise.resolve(new Response(null, { status: 429 })) };
  const res = await proxy(START, ip, { LIMITER: full });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("X-Vem-Sa-Vad-Proxy"), "1");
  assert.deepEqual(fetched, []);
});

const BODIES: { name: string; body: string | Uint8Array; ok: boolean }[] = [
  { name: "HTML", body: "<!doctype html><html><script>alert(1)</script>", ok: false },
  { name: "SVG", body: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', ok: false },
  { name: "ZIP", body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), ok: false },
  { name: "PDF", body: "%PDF-1.7", ok: false },
  { name: "empty", body: "", ok: false },
  { name: "MP3 with ID3", body: "ID3\u0004\0\0\0\0\0\0", ok: true },
  { name: "RSS", body: FEED, ok: true },
  { name: "Atom", body: '<?xml version="1.0"?><!-- c --><feed xmlns="http://www.w3.org/2005/Atom"></feed>', ok: true },
  { name: "WAV", body: WAV, ok: true },
  { name: "Ogg", body: "OggS\0\0\0\0", ok: true },
];
for (const { name, body, ok } of BODIES) {
  proxyTest(`proxy ${ok ? "passes" : "refuses"} a ${name} body`, async () => {
    upstream = () => ({ body, headers: { "Content-Type": "text/html" } });
    assert.equal((await proxy(START)).status, ok ? 200 : 415);
  });
}

const SAFE_TYPE = /^(application\/xml(; charset=[\w.:-]+)?|application\/octet-stream|(audio|video)\/[\w.+-]+)$/i;

test(`proxy: ${ITERATIONS} random upstream bodies and types are refused or served inert and intact`, { timeout: 60_000 }, async () => {
  const r = rng(10);
  const starts = ["", "ID3", "OggS", "RIFF\0\0\0\0WAVE", "fLaC", "\0\0\0\u0018ftypisom", "\0\0\0\u0018ftypavif", "ÿû\u0090", "<?xml version='1.0'?>", "﻿"];
  const pieces = ["<rss>", "<feed ", "<html>", "<svg>", "<!--", "-->", "<script>", "<!DOCTYPE x>", " ", "\n", "a", "\0"];
  for (let i = 0; i < ITERATIONS; i++) {
    const text = r.pick(starts) + r.string(pieces, 8);
    const body = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
    const type = r.pick(UPSTREAM_TYPES);
    upstream = () => ({ body, headers: type === null ? undefined : { "Content-Type": type } });
    const res = await proxy(START);
    if (res.status !== 200) {
      assert.equal(res.status, 415, `#${i}: status ${res.status}`);
      continue;
    }
    const h = res.headers;
    assert.equal(h.get("X-Content-Type-Options"), "nosniff", `#${i}`);
    assert.match(h.get("Content-Security-Policy") ?? "", /default-src 'none'/);
    assert.match(h.get("Content-Security-Policy") ?? "", /\bsandbox\b/);
    assert.equal(h.get("X-Vem-Sa-Vad-Proxy"), "1");
    assert.match(h.get("Content-Type") ?? "", SAFE_TYPE, `#${i}: ${JSON.stringify(type)} → ${h.get("Content-Type")}`);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), body, `#${i}: body changed`);
  }
});
