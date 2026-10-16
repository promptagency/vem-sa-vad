// Speaker separation without the model: windowing, stitching, decoding and
// assignment on hand-made speaker activity.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIARIZE_OVERLAP_SECONDS,
  DIARIZE_WINDOW_SECONDS,
  assignSpeakers,
  decodeActivity,
  planWindows,
  smoothSpeakers,
  stitchWindows,
} from "../src/lib/diarize.ts";
import type { SpeakerActivity, TranscriptChunk } from "../src/lib/protocol.ts";

const line = (start: number, end: number | null, text = " ord"): TranscriptChunk => ({ text, timestamp: [start, end] });
const speechIn = (spans: SpeakerActivity[]) => spans.reduce((n, s) => n + (s.end - s.start), 0);

test("planWindows covers the whole recording, overlapping by the set amount", () => {
  assert.deepEqual(planWindows(600), [{ index: 0, startSec: 0, endSec: 600 }]);
  assert.equal(planWindows(DIARIZE_WINDOW_SECONDS).length, 1);
  for (const duration of [DIARIZE_WINDOW_SECONDS + 0.01, 3 * 3600, 240 * 60]) {
    const windows = planWindows(duration);
    assert.ok(windows.length > 1);
    assert.equal(windows[0].startSec, 0);
    assert.equal(windows.at(-1)!.endSec, duration);
    for (let i = 1; i < windows.length; i++) {
      const overlap = windows[i - 1].endSec - windows[i].startSec;
      assert.ok(Math.abs(overlap - DIARIZE_OVERLAP_SECONDS) < 1e-9, `seam ${i} of ${duration}: ${overlap}`);
      assert.ok(windows[i].endSec > windows[i - 1].endSec);
    }
  }
});

test("stitchWindows keeps a speaker's id across a seam and counts no second twice", () => {
  const [w0, w1] = planWindows(1800, 1000, 200); // windows 0–1000 and 800–1800
  assert.deepEqual([w0.startSec, w0.endSec, w1.startSec, w1.endSec], [0, 1000, 800, 1800]);
  // A talks 0–850 and 950–1800; B talks 850–950. Window 1 names them 4 and 3.
  const stitched = stitchWindows([
    { window: w0, activity: [{ speaker: 0, start: 0, end: 850 }, { speaker: 1, start: 850, end: 950 }, { speaker: 0, start: 950, end: 1000 }] },
    { window: w1, activity: [{ speaker: 4, start: 800, end: 850 }, { speaker: 3, start: 850, end: 950 }, { speaker: 4, start: 950, end: 1800 }] },
  ]);
  const ids = (from: number, to: number) => new Set(stitched.filter((s) => s.start < to && s.end > from).map((s) => s.speaker));
  assert.deepEqual(ids(0, 100), ids(1700, 1800), "A has one id on both sides");
  assert.equal(new Set(stitched.map((s) => s.speaker)).size, 2);
  assert.equal(speechIn(stitched), 1800, "the 200 s overlap is owned once, split at its middle");
});

test("stitchWindows gives someone silent through the overlap a new id rather than a guess", () => {
  const [w0, w1] = planWindows(1800, 1000, 200);
  const stitched = stitchWindows([
    { window: w0, activity: [{ speaker: 0, start: 0, end: 1000 }] },
    { window: w1, activity: [{ speaker: 3, start: 800, end: 1000 }, { speaker: 4, start: 1200, end: 1800 }] },
  ]);
  assert.equal(new Set(stitched.map((s) => s.speaker)).size, 2);
});

test("decodeActivity reads the powerset: silence is nobody, overlap is two people", () => {
  // 7 classes per frame; one-hot logits. Frames: silence, A, A+B, B, silence.
  const classes = [0, 1, 4, 2, 0];
  const logits = new Float32Array(classes.length * 7);
  classes.forEach((c, f) => (logits[f * 7 + c] = 1));
  const spans = decodeActivity(logits, classes.length, 7, 5, 100, 2);
  assert.deepEqual(
    spans.map((s) => [s.speaker, s.start, s.end]).sort((a, b) => a[0] - b[0]),
    [[6, 101, 103], [7, 102, 104]], // window 2 → ids 6 and 7, offset by the window start
  );
  assert.deepEqual(decodeActivity(new Float32Array(0), 0, 7, 0, 0, 0), []);
});

test("assignSpeakers gives a line to whoever talks longest across it", () => {
  const out = assignSpeakers(
    [line(0, 4), line(4, 8), line(20, 22)],
    [{ speaker: 7, start: 0, end: 3.5 }, { speaker: 2, start: 3, end: 8 }],
  );
  assert.deepEqual(out.map((c) => c.speaker), [1, 2, null], "renumbered by first appearance; silence is null");
  assert.ok(out[0].speaker_conf! > 0.5);
  assert.equal(out[2].speaker_conf, 0);
});

test("assignSpeakers: a short line with a second voice goes to the one contained in it", () => {
  // Speaker 0 talks straight through 0–10; speaker 1 says "ja" at 5.0–5.8.
  const out = assignSpeakers(
    [line(0, 5), line(5, 6, " Ja."), line(6, 10)],
    [{ speaker: 0, start: 0, end: 10 }, { speaker: 1, start: 5, end: 5.8 }],
  );
  assert.deepEqual(out.map((c) => c.speaker), [1, 2, 1]);
});

test("assignSpeakers bounds a final line whose end Whisper left open", () => {
  // Without a bound the open line would run to 300 s and go to speaker 1.
  const out = assignSpeakers(
    [line(0, 2), line(2, 4), line(10, null)],
    [{ speaker: 0, start: 0, end: 12 }, { speaker: 1, start: 13, end: 300 }],
  );
  assert.equal(out[2].speaker, 1, "speaker 0 (renumbered 1) owns 10–12");
});

test("smoothSpeakers folds a short unsure run into the speaker around it, not a sure one", () => {
  const chunks = (conf: number): TranscriptChunk[] => [
    { ...line(0, 5), speaker: 1, speaker_conf: 0.9 },
    { ...line(5, 6), speaker: 2, speaker_conf: conf },
    { ...line(6, 10), speaker: 1, speaker_conf: 0.9 },
    { ...line(10, 14), speaker: 3, speaker_conf: 0.9 },
  ];
  assert.deepEqual(smoothSpeakers(chunks(0.2)).map((c) => c.speaker), [1, 1, 1, 2], "folded, then renumbered without a gap");
  assert.deepEqual(smoothSpeakers(chunks(0.9)).map((c) => c.speaker), [1, 2, 1, 3]);
});
