// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import mod from "../src/fileAssembler.js";

const { createAssembler, safeName, MAX_BASE64 } = mod;

test("pieces in any order come back as one file", () => {
  const a = createAssembler();
  a.start(1);
  assert.equal(a.chunk({ id: 1, i: 1, n: 2, data: "CD" }), true);
  assert.equal(a.chunk({ id: 1, i: 0, n: 2, data: "AB" }), true);
  assert.deepEqual(a.end({ id: 1, name: "orders.csv", mime: "text/csv", chunks: 2 }), {
    name: "orders.csv",
    mime: "text/csv",
    base64: "ABCD",
  });
  assert.equal(a.pending, 0);
});

test("a missing piece, a wrong count or an unknown id gives nothing", () => {
  const a = createAssembler();
  a.start(2);
  a.chunk({ id: 2, i: 0, n: 2, data: "AB" });
  assert.equal(a.end({ id: 2, name: "x.pdf", mime: "application/pdf", chunks: 2 }), null);
  a.start(3);
  a.chunk({ id: 3, i: 0, n: 1, data: "AB" });
  assert.equal(a.end({ id: 3, name: "x.pdf", mime: "application/pdf", chunks: 2 }), null);
  assert.equal(a.chunk({ id: 99, i: 0, n: 1, data: "AB" }), false);
  assert.equal(a.end({ id: 99, chunks: 1 }), null);
  assert.equal(a.pending, 0);
});

test("bad pieces and oversized files are refused and dropped", () => {
  const a = createAssembler();
  a.start(4);
  assert.equal(a.chunk({ id: 4, i: 5, n: 2, data: "AB" }), false);
  assert.equal(a.pending, 0);
  a.start(5);
  assert.equal(a.chunk({ id: 5, i: 0, n: 1, data: "x".repeat(MAX_BASE64 + 1) }), false);
  assert.equal(a.pending, 0);
});

test("names can't climb out of the downloads folder; odd mime types are neutralised", () => {
  assert.equal(safeName("../../etc/passwd"), "_.._etc_passwd");
  assert.equal(safeName("..hidden"), "hidden");
  assert.equal(safeName(""), "download");
  assert.equal(safeName('a:b*c?"d<e>f|g.pdf'), "a_b_c__d_e_f_g.pdf");
  const a = createAssembler();
  a.start(6);
  a.chunk({ id: 6, i: 0, n: 1, data: "AB" });
  assert.equal(a.end({ id: 6, name: "x", mime: "text/html; <script>", chunks: 1 })?.mime, "application/octet-stream");
});
