// Seeded random inputs for tests/robustness.test.ts. Every target has a fixed
// seed, so a failing iteration is the same on every run and machine.

export const ITERATIONS = 2000;

/** mulberry32: small, fast, and good enough to spread test inputs. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const chance = (p: number) => next() < p;
  const string = (alphabet: readonly string[], maxLength: number) =>
    Array.from({ length: int(0, maxLength) }, () => pick(alphabet)).join("");
  return { next, int, pick, chance, string };
}

export type Rng = ReturnType<typeof rng>;

/** Characters that have broken text formats before, plus plain letters. */
export const TEXT_ALPHABET = [
  "a", "b", "Å", "ö", " ", " ", "\n", "\n\n", "\t", "\r", "#", "*", "_", "-", "+", "=", ">", "<", "&", "|",
  "[", "]", "`", "\\", "/", ":", ".", ")", "1", "9", '"', "'", "-->", "😀", "\u0000", "\u001f", "\u007f",
  "\u0085", " ", "​", "<b>", "&amp;", "Åsa \"Q\" <b>&",
];

/** Seconds that are awkward for timestamps: rounding edges, huge, negative, not numbers. */
export const AWKWARD_SECONDS = [
  0, 0.0004, 0.0005, 0.9995, 0.9996, 59.9995, 59.9999, 3599.9996, 359999.9996, 1e7, -1, -0.0001, NaN, Infinity, -Infinity,
];
