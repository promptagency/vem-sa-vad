import { test } from "node:test";
import assert from "node:assert/strict";
import { changingMatches, findPattern, matchRanges, replaceInChunks, replaceInText } from "../src/lib/replace.ts";

const words = (q: string, matchCase = false) => findPattern(q, { matchCase, wholeWords: true })!;

test("findPattern is literal, and whole words respect å/ä/ö", () => {
  assert.equal(findPattern("  ", { matchCase: false, wholeWords: true }), null);
  assert.deepEqual(matchRanges("1+1 (a.b)", findPattern("(a.b)", { matchCase: true, wholeWords: false })!), [[4, 9]]);
  assert.deepEqual(matchRanges("Kåsa och Åsa", words("Åsa")), [[9, 12]]);
  assert.deepEqual(matchRanges("åsa ÅSA Åsa", words("Åsa")).length, 3);
  assert.deepEqual(matchRanges("åsa ÅSA Åsa", words("Åsa", true)), [[8, 11]]);
});

test("replaceInText takes the replacement literally and keeps the line's leading space", () => {
  assert.equal(replaceInText(" Hej Anna.", words("Anna"), "$& och $1"), " Hej $& och $1.");
  assert.equal(replaceInText(" vem sa vad", words("vem sa vad"), "Vem sa vad?"), " Vem sa vad?");
});

test("deleting a word tidies only where it was (the examples in replace.ts)", () => {
  assert.equal(replaceInText("Ja, eh, det", words("eh"), ""), "Ja, det");
  assert.equal(replaceInText("Ja, eh.", words("eh"), ""), "Ja.");
  assert.equal(replaceInText("Eh, det", words("eh"), ""), "Det");
  assert.equal(replaceInText('"Eh", sa hon', words("eh"), ""), "sa hon");
  assert.equal(replaceInText("Eh, iPhone", words("eh"), ""), "iPhone");
  assert.equal(replaceInText(" Eh.", words("eh"), ""), "", "nothing but punctuation left");
});

test("only matches that change count, and changed lines are marked edited", () => {
  assert.equal(changingMatches("anna och Anna", words("anna"), "Anna"), 1);
  const { changes, matches } = replaceInChunks(
    [{ text: " Anna", timestamp: [0, 1] }, { text: " anna", timestamp: [1, 2] }, { text: " Bo", timestamp: [2, 3] }],
    words("anna"),
    "Anna",
  );
  assert.equal(matches, 1);
  assert.deepEqual([...changes], [[1, { text: " Anna", timestamp: [1, 2], edited: true }]]);
});
