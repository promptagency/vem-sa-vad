import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip } from "../src/lib/zip.ts";

test("createZip writes stored entries with CRCs, UTF-8 names and a central directory", async () => {
  const bytes = new Uint8Array(await createZip([{ name: "Åsa & Öl.txt", text: "hello" }, { name: "b.md", text: "" }], new Date(2026, 9, 16, 12, 30, 10)).arrayBuffer());
  const v = new DataView(bytes.buffer);
  const name = new TextEncoder().encode("Åsa & Öl.txt");
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint16(6, true), 0x0800, "UTF-8 name flag");
  assert.equal(v.getUint32(14, true), 0x3610a686, "CRC-32 of 'hello'");
  assert.equal(v.getUint32(18, true), 5);
  assert.deepEqual(bytes.slice(30, 30 + name.length), name);
  assert.equal(new TextDecoder().decode(bytes.slice(30 + name.length, 35 + name.length)), "hello");
  // End of central directory: two entries, and its offset points at the first central header.
  const end = bytes.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);
  assert.equal(v.getUint32(v.getUint32(end + 16, true), true), 0x02014b50);
  // DOS date and time: 2026-10-16 12:30:10.
  assert.equal(v.getUint16(12, true), ((2026 - 1980) << 9) | (10 << 5) | 16);
  assert.equal(v.getUint16(10, true), (12 << 11) | (30 << 5) | 5);
});
