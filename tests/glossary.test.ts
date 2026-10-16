import { test } from "node:test";
import assert from "node:assert/strict";
import { addTerms, applySuggestions, findSuggestions, glossaryTerms, newTermsIn, removeTerm } from "../src/lib/glossary.ts";
import type { TranscriptChunk } from "../src/lib/protocol.ts";

const lines = (...texts: string[]): TranscriptChunk[] => texts.map((text, i) => ({ text, timestamp: [i, i + 1] }));
const found = (texts: string[], terms: string[]) => findSuggestions(lines(...texts), terms).map((s) => [s.index, s.found, s.term]);

test("the word list: one term per line, trimmed, no duplicates, a size limit", () => {
  assert.deepEqual(glossaryTerms("  Micke   Quick \n\nmicke quick\n---\nHetzner\r\n"), ["Micke Quick", "Hetzner"]);
  assert.deepEqual(addTerms("Hetzner", ["hetzner", "Plausible"]), { text: "Hetzner\nPlausible", added: ["Plausible"], full: false });
  assert.equal(addTerms(Array.from({ length: 300 }, (_, i) => `T${i}`).join("\n"), ["New"]).full, true);
  assert.equal(removeTerm("Hetzner\nPlausible", "Hetzner"), "Plausible");
});

test("misheard names that sound like a term are suggested (the examples in glossary.ts)", () => {
  assert.deepEqual(found([" Jag heter Micke Kvick.", " Vi kör på Hedsner.", " Pya Notte delar upp talare."], ["Micke Quick", "Hetzner", "pyannote"]), [
    [0, "Micke Kvick", "Micke Quick"],
    [1, "Hedsner", "Hetzner"],
    [2, "Pya Notte", "pyannote"],
  ]);
});

test("no suggestion for a term already spelled right, or for ordinary words", () => {
  assert.deepEqual(found([" Micke Quick och micke quick."], ["Micke Quick"]), []);
  assert.deepEqual(found([" Han ville ha en vit bil men visste inte."], ["Vite"]), []);
});

test("a word at the edge has to earn its place in the match", () => {
  // "på Hedsner" sounds no closer to Hetzner than "Hedsner" does, so "på" stays out.
  assert.deepEqual(found([" Vi kör på Hedsner nu."], ["Hetzner"]).map((s) => s[1]), ["Hedsner"]);
  assert.deepEqual(found([" Det heter Micke Kvick."], ["Micke Quick"]).map((s) => s[1]), ["Micke Kvick"]);
});

test("the same suggestions with the line cache, a fresh list, and after an edit", () => {
  const terms = ["Micke Quick"];
  const texts = [" Micke Kvick här.", " Inget här."];
  const first = findSuggestions(lines(...texts), terms);
  assert.deepEqual(findSuggestions(lines(...texts), terms), first);
  assert.deepEqual(findSuggestions(lines(...texts), [...terms]), first);
  assert.deepEqual(findSuggestions(lines(" Inget här.", " Micke Kvick här."), terms).map((s) => s.index), [1]);
});

test("accepting a suggestion edits the line, without doubling punctuation", () => {
  const chunks = lines(" Det heter Vemsavad. Bra.");
  const start = chunks[0].text.indexOf("Vemsavad");
  const changes = applySuggestions(chunks, [{ index: 0, start, end: start + 8, found: "Vemsavad", term: "Vem sa vad?" }]);
  assert.deepEqual(changes.get(0), { text: " Det heter Vem sa vad. Bra.", timestamp: [0, 1], edited: true });
  // The line changed since: the suggestion no longer fits and is skipped.
  assert.equal(applySuggestions(lines(" Annat."), [{ index: 0, start: 1, end: 9, found: "Vemsavad", term: "X" }]).size, 0);
});

test("a hand edit offers the new name for the word list, whole", () => {
  assert.deepEqual(newTermsIn(" Micke Kvick sa det.", " Micke Quick sa det.", []), ["Micke Quick"]);
  assert.deepEqual(newTermsIn(" vi ses.", " Vi ses i morgon.", []), []);
  assert.deepEqual(newTermsIn(" kör whisper", " kör KB-Whisper", ["kb-whisper"]), []);
});
