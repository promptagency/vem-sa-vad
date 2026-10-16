import { test } from "node:test";
import assert from "node:assert/strict";
import { render, safeFileName, toDocument, toJson, toSrt, toTxt, toVtt } from "../src/lib/exporters.ts";
import type { TranscriptResult } from "../src/lib/protocol.ts";

const result: TranscriptResult = {
  text: " Hej. Hallå. Ja.",
  chunks: [
    { text: " Hej.", timestamp: [0, 1.5], speaker: 1 },
    { text: " Hallå.", timestamp: [1.5, 3.25], speaker: 2 },
    { text: "  ", timestamp: [3.25, 4], speaker: 3 },
    { text: " Ja.", timestamp: [3661.5, 3662], speaker: 2 },
  ],
};

test("safeFileName: no path separators, hidden files or dots before the extension", () => {
  assert.equal(safeFileName("3/12 recap: del 2?"), "3-12 recap- del 2-");
  assert.equal(safeFileName(" .profile"), "profile");
  assert.equal(safeFileName("Show - Del 3."), "Show - Del 3");
  assert.equal(safeFileName("..."), "transcript");
});

test("subtitles: timestamps, speaker names, and blank lines dropped", () => {
  const srt = toSrt(result, { 2: 'Åsa "Q" <b>&' });
  assert.equal(
    srt,
    "1\n00:00:00,000 --> 00:00:01,500\nSpeaker 1: Hej.\n\n" +
      '2\n00:00:01,500 --> 00:00:03,250\nÅsa "Q" <b>&: Hallå.\n\n' +
      '3\n01:01:01,500 --> 01:01:02,000\nÅsa "Q" <b>&: Ja.\n\n',
  );
  assert.match(toVtt(result), /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.500\nSpeaker 1: Hej\.\n/);
});

test("labels come from the interface language the app passes in", () => {
  const sv = { speaker: (n: number) => `Talare ${n}`, speakers: "Talare", untitled: "Transkription" };
  assert.equal(toTxt(result, { 1: "Anna" }, sv), "Anna: Hej.\nTalare 2: Hallå.\nTalare 2: Ja.\n");
  assert.match(render(result, "txt", {}, undefined, sv), /^Transkription\n.* · Talare: Talare 1, Talare 2\n/);
});

test("JSON keeps every chunk and agrees with the text export", () => {
  const json = JSON.parse(toJson(result, { 1: "Anna" }));
  assert.equal(json.text, toTxt(result, { 1: "Anna" }).trim());
  assert.deepEqual(json.speakers, { 1: "Anna", 2: "Speaker 2", 3: "Speaker 3" });
  assert.equal(json.chunks.length, 4);
});

test("documents merge a speaker's lines into paragraphs, split at long pauses", () => {
  const doc = toDocument(
    {
      text: "",
      chunks: [
        { text: " Ett.", timestamp: [0, 1], speaker: 1 },
        { text: " Två.", timestamp: [2, 3], speaker: 1 },
        { text: " Tre.", timestamp: [8, 9], speaker: 1 },
        { text: " Fyra.", timestamp: [9, 10], speaker: 2 },
      ],
    },
    {},
    { title: "Möte", timestamps: true, date: new Date(2026, 9, 16) },
    false,
  );
  assert.equal(doc, "Möte\n2026-10-16 · 00:10 · Speakers: Speaker 1, Speaker 2\n\n[00:00] Speaker 1: Ett. Två.\n\n[00:08] Speaker 1: Tre.\n\n[00:09] Speaker 2: Fyra.\n");
});

test("Markdown shows the text literally", () => {
  const md = render(
    { text: "", chunks: [{ text: " 1994. *Ja* # <b>", timestamp: [0, 1] }, { text: " - Hej.", timestamp: [9, 10] }] },
    "md",
    {},
    { title: "A_b", timestamps: false, date: new Date(2026, 0, 2) },
  );
  assert.equal(md, "# A\\_b\n\n*2026-01-02 · 00:10*\n\n1994\\. \\*Ja\\* \\# \\<b\\>\n\n\\- Hej.\n");
  // A paragraph of dashes isn't a horizontal rule, and an entity isn't decoded.
  const odd = render(
    { text: "", chunks: [{ text: " ---", timestamp: [0, 1] }, { text: " &copy; AT&T", timestamp: [9, 10] }] },
    "md",
    {},
    { title: "T", timestamps: false, date: new Date(2026, 0, 2) },
  );
  assert.equal(odd.split("\n\n").slice(2).join("|"), "\\---|\\&copy; AT\\&T\n");
});

test("a silent recording gives subtitle files with no empty cue", () => {
  const silent = { text: " ", chunks: [] };
  assert.equal(toSrt(silent).trim(), "");
  assert.equal(toVtt(silent).trim(), "WEBVTT");
  assert.equal(JSON.parse(toJson(silent)).chunks.length, 0);
});
