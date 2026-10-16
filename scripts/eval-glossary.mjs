// Word-list suggestions (src/lib/glossary.ts) measured on text, no audio:
//   - false suggestions in ordinary Swedish prose: Selma Lagerlöf's "Valda
//     berättelser" (public domain, Project Gutenberg #51440, as in
//     make-bench-audio.sh) plus the app's own Swedish interface text;
//   - hits on hand-made mishearings of the terms (spellings Whisper could
//     plausibly produce, not measured Whisper output).
// Usage: node --experimental-strip-types scripts/eval-glossary.mjs
import { readFileSync } from "node:fs";
import { findSuggestions } from "../src/lib/glossary.ts";

const TERMS = [
  "Micke Quick", "Anders Bjarby", "Hetzner", "Plausible", "pyannote", "Vem sa vad?", "KB-Whisper",
  "Transformers.js", "Cloudflare", "Loopia", "Prompt Agency", "WebGPU", "kvantisering", "diarisering",
  "Anna Lindqvist", "Erik Johansson", "Göteborg", "Vite", "Klang", "Pianissimo", "Hugging Face", "jsDelivr",
];
// A crowded list: common Swedish names, many close to ordinary words.
const NAMES = [
  "Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson",
  "Gustafsson", "Pettersson", "Jonsson", "Jansson", "Hansson", "Bengtsson", "Lindberg", "Lindström",
  "Lindgren", "Axelsson", "Berg", "Jakobsson", "Magnusson", "Lundberg", "Lundgren", "Mattsson", "Berglund",
  "Fredriksson", "Sandberg", "Henriksson", "Forsberg", "Sjöberg", "Wallin", "Engström", "Eklund", "Danielsson",
  "Håkansson", "Lundin", "Björk", "Bergström", "Gunnarsson", "Holm", "Samuelsson", "Fransson", "Wikström",
  "Isaksson", "Bergman", "Nyström", "Holmberg", "Arvidsson", "Löfgren", "Söderberg", "Nyberg", "Blomqvist",
  "Claesson", "Nordström", "Mårtensson", "Lundqvist", "Ali", "Mohammed", "Björklund",
];
// [what Whisper might write, the term it should be]
const MISHEARD = [
  ["Micke Kvick", "Micke Quick"], ["Mikke Kvik", "Micke Quick"], ["Anders Bjärby", "Anders Bjarby"],
  ["Hedsner", "Hetzner"], ["Hetsner", "Hetzner"], ["Plausibel", "Plausible"], ["plausibel", "Plausible"],
  ["Pya Notte", "pyannote"], ["pianote", "pyannote"], ["Vemsavad", "Vem sa vad?"], ["Vemsa vad", "Vem sa vad?"],
  ["Kebe Whisper", "KB-Whisper"], ["Claudflare", "Cloudflare"], ["Cloud flare", "Cloudflare"], ["Lupia", "Loopia"],
  ["Prompt Ejensi", "Prompt Agency"], ["Webb GPU", "WebGPU"], ["kvantissering", "kvantisering"],
  ["diarisärning", "diarisering"], ["Hugging Fejs", "Hugging Face"], ["Pianisimo", "Pianissimo"],
  ["Anna Lindqivst", "Anna Lindqvist"], ["Prompt Agen Sy", "Prompt Agency"],
];

const lines = (text) =>
  text.split(/(?<=[.!?])\s+|\n{2,}/).map((l) => " " + l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 3);

const res = await fetch("https://www.gutenberg.org/cache/epub/51440/pg51440.txt");
if (!res.ok) throw new Error(`Couldn't download the prose sample: HTTP ${res.status}`);
const book = await res.text();
const [start, end] = [book.indexOf("*** START"), book.indexOf("*** END")];
// A page that isn't the book would leave a tiny sample and a reassuringly low count.
if (start < 0 || end < start) throw new Error("The download isn't the expected Gutenberg text.");
const body = book.slice(start, end);
const ui = [...readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8").split("const en")[0]
  .matchAll(/"([^"\\]{20,})"|`([^`]{20,})`/g)].map((m) => m[1] ?? m[2]).join("\n\n");
const prose = [...lines(body), ...lines(ui)].map((text, i) => ({ text, timestamp: [i, i + 1] }));
const words = prose.reduce((n, c) => n + c.text.split(/\s+/).length - 1, 0);
if (words < 30000) throw new Error(`The prose sample is only ${words} words; expected about 40,000.`);

const t0 = performance.now();
const falseHits = findSuggestions(prose, TERMS);
const ms = Math.round(performance.now() - t0);

const caught = MISHEARD.filter(([said, term]) => {
  const s = findSuggestions([{ text: ` Hon sa att ${said} skulle komma i morgon.`, timestamp: [0, 1] }], TERMS);
  const plain = (t) => t.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  return s.some((x) => x.term === term && plain(x.found) === plain(said));
});

console.log(`prose: ${words} words in ${prose.length} lines, ${TERMS.length} terms, ${ms} ms`);
console.log(`false suggestions: ${falseHits.length}`);
const crowded = findSuggestions(prose, [...TERMS, ...NAMES]);
console.log(`false suggestions with ${NAMES.length} common names added: ${crowded.length}`);
const seen = new Map();
for (const s of crowded) seen.set(`"${s.found}" → ${s.term}`, (seen.get(`"${s.found}" → ${s.term}`) ?? 0) + 1);
console.log("  " + [...seen].map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join(", "));
for (const s of falseHits.slice(0, 30)) console.log(`  "${s.found}" → ${s.term}   (${prose[s.index].text.slice(0, 70).trim()}…)`);
console.log(`mishearings caught: ${caught.length} of ${MISHEARD.length}`);
for (const [said, term] of MISHEARD.filter((m) => !caught.includes(m))) console.log(`  missed: "${said}" → ${term}`);
